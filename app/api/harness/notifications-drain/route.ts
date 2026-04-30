import { NextResponse, after } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { runImprovementEngine } from '@/lib/harness/improvement-engine'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 20
const MAX_ATTEMPTS = 5

// ── Component 1 — Improvement Engine Trigger (Option A) ───────────────────────
// Scans for task_queue rows completed in the last 2 minutes that have not yet
// been processed by the improvement engine (no agent_events row with
// action='improvement_engine.triggered' and meta.task_id = row.id).
// Fires runImprovementEngine for each unprocessed row — async/fire-and-forget
// so it does not block the notification drain.

const IMPROVEMENT_ENGINE_LOOKBACK_MS = 2 * 60 * 1000 // 2 minutes

async function triggerImprovementEngineForRecentCompletions(): Promise<{
  triggered: number
  errors: number
}> {
  const db = createServiceClient()
  let triggered = 0
  const errors = 0

  const lookback = new Date(Date.now() - IMPROVEMENT_ENGINE_LOOKBACK_MS).toISOString()

  // Find recently-completed task_queue rows
  const { data: completedRows, error: rowErr } = await db
    .from('task_queue')
    .select('id, completed_at')
    .in('status', ['completed', 'grounded'])
    .gte('completed_at', lookback)
    .limit(10) // safety cap — should never be more than a few per run

  if (rowErr || !completedRows || completedRows.length === 0) {
    return { triggered: 0, errors: rowErr ? 1 : 0 }
  }

  for (const row of completedRows as { id: string; completed_at: string }[]) {
    // Check if the engine has already been triggered for this row
    const { data: existingEvent } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'improvement_engine.triggered')
      .filter('meta->>task_id', 'eq', row.id)
      .limit(1)
      .maybeSingle()

    if (existingEvent) continue // already processed

    // after() keeps the serverless function alive until the engine finishes,
    // even after the HTTP response is sent. void+catch pattern is not sufficient
    // in Vercel serverless — function is killed at response time without after().
    after(
      runImprovementEngine(row.id).catch((err: unknown) => {
        console.error('[improvement-engine] runImprovementEngine error:', err)
      })
    )

    triggered++
  }

  return { triggered, errors }
}

interface PendingRow {
  id: string
  channel: string
  chat_id: string | null
  payload: Record<string, unknown>
  attempts: number
  created_at: string
  correlation_id: string | null
}

async function sendTelegram(
  token: string,
  chatId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...payload }),
    })
  } catch {
    return { ok: false, error: 'network_error' }
  }

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, error: `Telegram ${res.status}: ${body.slice(0, 200)}` }
  }

  const data = (await res.json()) as { ok: boolean; result?: { message_id: number } }
  return { ok: true, messageId: data.result?.message_id }
}

async function drain(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const token = process.env.TELEGRAM_BOT_TOKEN
  const defaultChatId = process.env.TELEGRAM_CHAT_ID

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' },
      { status: 500 }
    )
  }

  const db = createServiceClient()

  // ── Component 1: trigger improvement engine for recently-completed chunks ─────
  // Fire-and-forget — errors are logged inside but do not block the drain.
  const engineResult = await triggerImprovementEngineForRecentCompletions().catch(() => ({
    triggered: 0,
    errors: 1,
  }))

  const { data: rows, error: fetchError } = await db
    .from('outbound_notifications')
    .select('id, channel, chat_id, payload, attempts, created_at, correlation_id')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })
  }

  const batchQueued = rows?.length ?? 0
  let drained = 0
  let failed = 0

  if (!rows || rows.length === 0) {
    // Log empty drain run — still a valid run for F18 observability
    await db
      .from('agent_events')
      .insert({
        action: 'drain_run',
        status: 'success',
        domain: 'coordinator',
        actor: 'notifications-drain',
        meta: { drained: 0, failed: 0, batch_queued: 0 },
        occurred_at: new Date().toISOString(),
      })
      .then(undefined, () => {})
    return NextResponse.json({
      ok: true,
      drained: 0,
      failed: 0,
      improvement_engine: engineResult,
    })
  }

  for (const row of rows as PendingRow[]) {
    if (row.channel !== 'telegram') continue

    const chatId = row.chat_id ?? defaultChatId
    if (!chatId) {
      const newAttempts = row.attempts + 1
      await db
        .from('outbound_notifications')
        .update({
          attempts: newAttempts,
          last_error: 'no chat_id and TELEGRAM_CHAT_ID not configured',
          ...(newAttempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
        })
        .eq('id', row.id)
      failed++
      continue
    }

    const result = await sendTelegram(token, chatId, row.payload)

    if (result.ok) {
      await db
        .from('outbound_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          // Merge Telegram's returned message_id into payload so the inbound
          // webhook can match reply_to_message.message_id (strategy B correlation).
          ...(result.messageId != null
            ? { payload: { ...row.payload, message_id: result.messageId } }
            : {}),
        })
        .eq('id', row.id)

      // Best-effort: log delivery latency to agent_events for F18 observability.
      // Failure here must NOT fail the drain.
      try {
        await db.from('agent_events').insert({
          action: 'notification_delivered',
          status: 'success',
          domain: 'coordinator',
          meta: {
            notification_id: row.id,
            correlation_id: row.correlation_id ?? null,
            delivery_latency_ms: Date.now() - new Date(row.created_at).getTime(),
            channel: row.channel,
          },
          occurred_at: new Date().toISOString(),
        })
      } catch (err) {
        console.error('[notifications-drain] agent_events insert failed (best-effort):', err)
      }

      drained++
    } else {
      const newAttempts = row.attempts + 1
      await db
        .from('outbound_notifications')
        .update({
          attempts: newAttempts,
          last_error: result.error,
          ...(newAttempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
        })
        .eq('id', row.id)
      failed++
    }
  }

  // F18: log drain run summary for morning_digest surfacing
  await db
    .from('agent_events')
    .insert({
      action: 'drain_run',
      status: 'success',
      domain: 'coordinator',
      actor: 'notifications-drain',
      meta: { drained, failed, batch_queued: batchQueued },
      occurred_at: new Date().toISOString(),
    })
    .then(undefined, () => {})

  return NextResponse.json({ ok: true, drained, failed, improvement_engine: engineResult })
}

export async function GET(request: Request): Promise<NextResponse> {
  return drain(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return drain(request)
}
