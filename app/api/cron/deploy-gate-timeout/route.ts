import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const MAX_PER_TICK = 10
const OVERRIDE_WINDOW_MS = 10 * 60 * 1000 // 10-minute tap window
const LOOKBACK_MS = 2 * 60 * 60 * 1000   // look back 2h for notification rows

type Meta = Record<string, unknown>
type NotifRow = { id: string; meta: Meta; occurred_at: string }

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

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

  return { ok: true, processed: pending.length, results }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
