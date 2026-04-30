import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteBranch } from '@/lib/harness/deploy-gate'

export const dynamic = 'force-dynamic'

const MAX_PER_TICK = 10
const OVERRIDE_WINDOW_MS = 10 * 60 * 1000 // 10-minute rollback tap window
const MIGRATION_OVERRIDE_WINDOW_MS = 30 * 60 * 1000 // 30-minute migration review window
const LOOKBACK_MS = 2 * 60 * 60 * 1000 // look back 2h for notification rows

type Meta = Record<string, unknown>
type NotifRow = { id: string; meta: Meta; occurred_at: string }

async function editTimeoutMessage(messageId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: '✅ kept in production (override window closed)',
      reply_markup: { inline_keyboard: [] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
  }
}

async function editMigrationTimeoutMessage(messageId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `⏰ auto-aborted at ${timestamp} MT (30min no response) — no promotion`,
      reply_markup: { inline_keyboard: [] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
  }
}

async function runTimeoutCron(): Promise<object> {
  const db = createServiceClient()
  const now = Date.now()
  const cutoff = new Date(now - OVERRIDE_WINDOW_MS).toISOString()
  const lookbackStart = new Date(now - LOOKBACK_MS).toISOString()

  // Find notification_sent rows older than the 10-min tap window
  const { data: notifications, error: notifErr } = await db
    .from('agent_events')
    .select('id, meta, occurred_at')
    .eq('task_type', 'deploy_gate_notification_sent')
    .eq('status', 'success')
    .lt('occurred_at', cutoff)
    .gte('occurred_at', lookbackStart)
    .order('occurred_at', { ascending: true })
    .limit(MAX_PER_TICK)

  if (notifErr) throw notifErr
  if (!notifications || notifications.length === 0) {
    return { ok: true, processed: 0, reason: 'no-pending-timeouts' }
  }

  // Find already-resolved merge_shas (rolled back or previously timed out)
  const { data: resolvedRows } = await db
    .from('agent_events')
    .select('meta')
    .in('task_type', ['deploy_gate_rolled_back', 'deploy_gate_override_timeout'])
    .gte('occurred_at', lookbackStart)

  const resolvedShas = new Set(
    (resolvedRows ?? []).map((r) => (r.meta as Meta)?.merge_sha as string).filter(Boolean)
  )

  const pending = (notifications as NotifRow[]).filter((n) => {
    const sha = n.meta?.merge_sha as string
    return sha && !resolvedShas.has(sha)
  })

  if (pending.length === 0) {
    return { ok: true, processed: 0, reason: 'all-resolved' }
  }

  const results: string[] = []

  for (const notif of pending) {
    const mergeSha = notif.meta.merge_sha as string
    const taskId = notif.meta.task_id as string
    const messageId = notif.meta.message_id as number | undefined
    const shaPrefix = mergeSha.slice(0, 8)

    // Write timeout row first — acts as idempotency guard for concurrent ticks
    try {
      await db.from('agent_events').insert({
        id: crypto.randomUUID(),
        domain: 'orchestrator',
        action: 'deploy_gate_runner',
        actor: 'deploy_gate',
        status: 'success',
        task_type: 'deploy_gate_override_timeout',
        output_summary: `gate expired — defaulting to keep for merge ${shaPrefix}`,
        meta: {
          merge_sha: mergeSha,
          task_id: taskId,
          default_action: 'keep',
          notification_sent_at: notif.occurred_at,
          resolved_at: new Date().toISOString(),
          ...(messageId != null ? { message_id: messageId } : {}),
        },
        tags: ['deploy_gate', 'harness', 'chunk_g'],
      })
    } catch {
      results.push(`${shaPrefix}:timeout-write-failed`)
      continue
    }

    results.push(`${shaPrefix}:timed-out-keep`)

    if (messageId != null) {
      try {
        await editTimeoutMessage(messageId)
      } catch (err) {
        try {
          await db.from('agent_events').insert({
            domain: 'orchestrator',
            action: 'deploy_gate_runner',
            actor: 'deploy_gate',
            status: 'error',
            task_type: 'telegram_edit_fail',
            output_summary: `Failed to edit timeout message ${messageId} for merge ${shaPrefix}`,
            meta: { message_id: messageId, merge_sha: mergeSha, error: String(err) },
            tags: ['deploy_gate', 'harness', 'chunk_g'],
          })
        } catch {
          // swallow — timeout row already written
        }
      }
    }
  }

  // ── Migration review timeout (30 min → ABORT) ───────────────────────────────
  const migrationCutoff = new Date(now - MIGRATION_OVERRIDE_WINDOW_MS).toISOString()

  const { data: migrationReviews, error: migrationErr } = await db
    .from('agent_events')
    .select('id, meta, occurred_at')
    .eq('task_type', 'deploy_gate_migration_review_sent')
    .eq('status', 'success')
    .lt('occurred_at', migrationCutoff)
    .gte('occurred_at', lookbackStart)
    .order('occurred_at', { ascending: true })
    .limit(MAX_PER_TICK)

  if (migrationErr) throw migrationErr

  if (migrationReviews && migrationReviews.length > 0) {
    const { data: resolvedMigrationRows } = await db
      .from('agent_events')
      .select('meta')
      .in('task_type', [
        'deploy_gate_promoted',
        'deploy_gate_migration_aborted',
        'deploy_gate_migration_review_timeout',
      ])
      .gte('occurred_at', lookbackStart)

    const resolvedMigrationShas = new Set(
      (resolvedMigrationRows ?? [])
        .map((r) => (r.meta as Meta)?.commit_sha as string)
        .filter(Boolean)
    )

    const pendingMigrations = (migrationReviews as NotifRow[]).filter((n) => {
      const sha = n.meta?.commit_sha as string
      return sha && !resolvedMigrationShas.has(sha)
    })

    for (const review of pendingMigrations) {
      const commitSha = review.meta.commit_sha as string
      const taskId = review.meta.task_id as string
      const branch = review.meta.branch as string | undefined
      const messageId = review.meta.message_id as number | undefined
      const shaPrefix = commitSha.slice(0, 8)

      try {
        await db.from('agent_events').insert({
          id: crypto.randomUUID(),
          domain: 'orchestrator',
          action: 'deploy_gate_runner',
          actor: 'deploy_gate',
          status: 'success',
          task_type: 'deploy_gate_migration_review_timeout',
          output_summary: `migration gate expired — defaulting to abort for commit ${shaPrefix}`,
          meta: {
            commit_sha: commitSha,
            task_id: taskId,
            default_action: 'abort',
            review_sent_at: review.occurred_at,
            resolved_at: new Date().toISOString(),
            ...(messageId != null ? { message_id: messageId } : {}),
          },
          tags: ['deploy_gate', 'harness', 'chunk_h'],
        })
      } catch {
        results.push(`${shaPrefix}:migration-timeout-write-failed`)
        continue
      }

      results.push(`${shaPrefix}:migration-timed-out-abort`)

      if (messageId != null) {
        try {
          await editMigrationTimeoutMessage(messageId)
        } catch (err) {
          try {
            await db.from('agent_events').insert({
              domain: 'orchestrator',
              action: 'deploy_gate_runner',
              actor: 'deploy_gate',
              status: 'error',
              task_type: 'telegram_edit_fail',
              output_summary: `Failed to edit migration timeout message ${messageId} for commit ${shaPrefix}`,
              meta: { message_id: messageId, commit_sha: commitSha, error: String(err) },
              tags: ['deploy_gate', 'harness', 'chunk_h'],
            })
          } catch {
            // swallow
          }
        }
      }

      if (branch) {
        try {
          await deleteBranch(branch)
        } catch {
          // swallow
        }
      }
    }
  }

  return { ok: true, processed: pending.length, results }
}

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await runTimeoutCron()
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request)
}
