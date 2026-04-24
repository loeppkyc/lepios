import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  isAllowedUser,
  parseCallbackData,
  parseGateCallbackData,
  parseImproveCallbackData,
} from '@/lib/harness/telegram-buttons'
import {
  rollbackDeployment,
  mergeToMain,
  deleteBranch,
  sendPromotionNotification,
} from '@/lib/harness/deploy-gate'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

type TgUser = { id: number; username?: string; first_name?: string }

type TgMessage = {
  message_id: number
  chat: { id: number }
  from?: TgUser
  text?: string
  reply_to_message?: { message_id: number }
}

type TgCallbackQuery = {
  id: string
  from: TgUser
  message: TgMessage
  data?: string
}

type TelegramUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  return request.headers.get('x-telegram-bot-api-secret-token') === secret
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }).catch(() => {})
}

async function logWebhookEvent(
  agentEventId: string | null,
  fromUserId: number,
  callbackData: string,
  status: 'success' | 'warning'
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'telegram_callback',
      actor: 'telegram_webhook',
      status,
      task_type: 'telegram_callback',
      output_summary: `callback from user ${fromUserId}: ${callbackData}`,
      meta: { agent_event_id: agentEventId, from_user_id: fromUserId, callback_data: callbackData },
      tags: ['telegram', 'webhook', 'component2'],
    })
  } catch {
    // Swallow — webhook still returns 200
  }
}

async function logEvent(fields: {
  task_type: string
  status: 'success' | 'error' | 'warning'
  output_summary: string
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'telegram_webhook',
      actor: 'telegram_webhook',
      tags: ['telegram', 'webhook', 'observe'],
      ...fields,
    })
  } catch {
    // swallow
  }
}

async function writeFeedback(params: {
  agentEventId: string
  feedbackType: 'thumbs_up' | 'thumbs_down'
  source: string
  fromUserId: number
  messageId: number
  callbackQueryId: string
}): Promise<void> {
  const { agentEventId, feedbackType, source, fromUserId, messageId, callbackQueryId } = params
  const meta = {
    telegram_user_id: fromUserId,
    message_id: messageId,
    callback_query_id: callbackQueryId,
  }

  try {
    const db = createServiceClient()

    const { data: existing } = await db
      .from('task_feedback')
      .select('id')
      .eq('agent_event_id', agentEventId)
      .eq('source', source)
      .maybeSingle()

    if (existing) {
      await db
        .from('task_feedback')
        .update({ feedback_type: feedbackType, created_at: new Date().toISOString(), meta })
        .eq('id', (existing as { id: string }).id)
    } else {
      await db
        .from('task_feedback')
        .insert({ agent_event_id: agentEventId, feedback_type: feedbackType, source, meta })
    }
  } catch {
    // Swallow — answerCallbackQuery and edit still proceed
  }
}

async function editMessageWithAck(
  chatId: number,
  messageId: number,
  originalText: string,
  action: 'up' | 'dn'
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  const emoji = action === 'up' ? '👍' : '👎'
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
      text: `${originalText}\n${emoji} recorded at ${timestamp} MT`,
      reply_markup: { inline_keyboard: [] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
  }
}

async function editRollbackAck(
  chatId: number,
  messageId: number,
  originalText: string,
  success: boolean,
  errorCode?: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const suffix = success
    ? `\n↩️ rolled back at ${timestamp} MT`
    : errorCode === 'already_rolled_back'
      ? `\n↩️ already rolled back`
      : `\n❌ rollback failed: ${errorCode ?? 'unknown'}`

  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `${originalText}${suffix}`,
      reply_markup: { inline_keyboard: [] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
  }
}

async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  keepButtons = false
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const payload: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text }
  if (!keepButtons) payload.reply_markup = { inline_keyboard: [] }
  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram editMessageText error ${res.status}: ${body}`)
  }
}

// ── Outbound notifications correlation ────────────────────────────────────────

// Three strategies tried in order; returns the matched outbound_notifications
// row id, or null if no requires_response row is pending a reply.
//
// Strategy B (reply-to match) requires the drain to store the Telegram
// message_id in payload->>'message_id' after a successful send.
async function findMatchingRow(
  db: ReturnType<typeof createServiceClient>,
  update: TelegramUpdate,
  chatId: number
): Promise<string | null> {
  // A: callback_query whose data is JSON containing {correlation_id: "..."}
  const rawCallbackData = update.callback_query?.data
  if (rawCallbackData) {
    try {
      const parsed = JSON.parse(rawCallbackData) as Record<string, unknown>
      if (typeof parsed.correlation_id === 'string') {
        const { data } = await db
          .from('outbound_notifications')
          .select('id')
          .eq('correlation_id', parsed.correlation_id)
          .eq('requires_response', true)
          .eq('status', 'sent')
          .maybeSingle()
        if (data) return (data as { id: string }).id
      }
    } catch {
      // Not JSON or no correlation_id — fall through to B/C
    }
  }

  // B: text reply with reply_to_message — match by Telegram message_id stored
  //    in payload->>'message_id' by the drain after a successful send
  const replyToId = update.message?.reply_to_message?.message_id
  if (replyToId != null) {
    const { data } = await db
      .from('outbound_notifications')
      .select('id')
      .eq('requires_response', true)
      .eq('status', 'sent')
      .eq('chat_id', String(chatId))
      .filter('payload->>message_id', 'eq', String(replyToId))
      .maybeSingle()
    if (data) return (data as { id: string }).id
  }

  // C: fallback — most recent sent+requires_response row for this chat in last 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('outbound_notifications')
    .select('id')
    .eq('requires_response', true)
    .eq('status', 'sent')
    .eq('chat_id', String(chatId))
    .is('response_received_at', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) return (data as { id: string }).id

  return null
}

// ── Deploy-gate handlers ──────────────────────────────────────────────────────

async function handleGatePromote(
  commitShaPrefix: string,
  chatId: number,
  messageId: number,
  originalText: string
): Promise<void> {
  const db = createServiceClient()
  const lookback = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

  const { data: reviewRows } = await db
    .from('agent_events')
    .select('id, meta')
    .eq('task_type', 'deploy_gate_migration_review_sent')
    .eq('status', 'success')
    .gte('occurred_at', lookback)
    .limit(20)

  const reviewRow = (reviewRows ?? []).find((r) => {
    const sha = (r.meta as Record<string, unknown>)?.commit_sha as string | undefined
    return sha?.startsWith(commitShaPrefix)
  })

  if (!reviewRow) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: migration review row not found',
      meta: { reason: 'not_found', commit_sha_prefix: commitShaPrefix },
    })
    await editTelegramMessage(
      chatId,
      messageId,
      `${originalText}\n❌ promote failed: not_found`
    ).catch(() => {})
    return
  }

  const meta = reviewRow.meta as Record<string, unknown>
  const commitSha = meta.commit_sha as string
  const taskId = meta.task_id as string
  const branch = meta.branch as string

  const { data: resolvedRows } = await db
    .from('agent_events')
    .select('id')
    .in('task_type', ['deploy_gate_promoted', 'deploy_gate_migration_aborted'])
    .filter('meta->>commit_sha', 'eq', commitSha)
    .limit(1)

  if (resolvedRows && resolvedRows.length > 0) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: migration review already resolved',
      meta: { reason: 'already_resolved', commit_sha: commitSha },
    })
    await editTelegramMessage(chatId, messageId, `${originalText}\n✅ already resolved`).catch(
      () => {}
    )
    return
  }

  let mergeResult: Awaited<ReturnType<typeof mergeToMain>>
  try {
    mergeResult = await mergeToMain(branch, taskId, commitSha)
  } catch {
    mergeResult = { ok: false, error: 'exception' }
  }

  if (!mergeResult.ok) {
    try {
      await db.from('agent_events').insert({
        domain: 'orchestrator',
        action: 'telegram_webhook',
        actor: 'telegram_webhook',
        status: 'error',
        task_type: 'deploy_gate_migration_promote_failed',
        output_summary: `migration promote failed for commit ${commitSha.slice(0, 8)}: ${mergeResult.error}`,
        meta: { commit_sha: commitSha, task_id: taskId, branch, error: mergeResult.error },
        tags: ['deploy_gate', 'harness', 'chunk_h'],
      })
    } catch {
      // swallow
    }
    await editTelegramMessage(
      chatId,
      messageId,
      `${originalText}\n❌ promote failed: ${mergeResult.error ?? 'unknown'} — tap to retry`,
      true
    ).catch(() => {})
    return
  }

  try {
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'telegram_webhook',
      actor: 'telegram_webhook',
      status: 'success',
      task_type: 'deploy_gate_promoted',
      output_summary: `promoted migration commit ${commitSha.slice(0, 8)} via manual review`,
      meta: {
        commit_sha: commitSha,
        task_id: taskId,
        branch,
        source: 'migration_review',
        ...(mergeResult.merge_sha ? { merge_sha: mergeResult.merge_sha } : {}),
      },
      tags: ['deploy_gate', 'harness', 'chunk_h'],
    })
  } catch {
    // swallow
  }

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  await editTelegramMessage(
    chatId,
    messageId,
    `${originalText}\n✅ promoted (migration approved) at ${timestamp} MT`
  ).catch(() => {})

  if (mergeResult.merge_sha) {
    try {
      const notif = await sendPromotionNotification({
        task_id: taskId,
        branch,
        merge_sha: mergeResult.merge_sha,
        commit_sha: commitSha,
      })
      if (notif.ok && notif.message_id != null) {
        await db.from('agent_events').insert({
          domain: 'orchestrator',
          action: 'telegram_webhook',
          actor: 'telegram_webhook',
          status: 'success',
          task_type: 'deploy_gate_notification_sent',
          output_summary: `promotion notification sent for migration task ${taskId}`,
          meta: {
            commit_sha: commitSha,
            branch,
            task_id: taskId,
            merge_sha: mergeResult.merge_sha,
            message_id: notif.message_id,
            source: 'migration_review',
          },
          tags: ['deploy_gate', 'harness', 'chunk_h'],
        })
      }
    } catch {
      // swallow
    }
  }

  try {
    await deleteBranch(branch)
  } catch {
    // swallow
  }
}

async function handleGateAbort(
  commitShaPrefix: string,
  chatId: number,
  messageId: number,
  originalText: string
): Promise<void> {
  const db = createServiceClient()
  const lookback = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

  const { data: reviewRows } = await db
    .from('agent_events')
    .select('id, meta')
    .eq('task_type', 'deploy_gate_migration_review_sent')
    .eq('status', 'success')
    .gte('occurred_at', lookback)
    .limit(20)

  const reviewRow = (reviewRows ?? []).find((r) => {
    const sha = (r.meta as Record<string, unknown>)?.commit_sha as string | undefined
    return sha?.startsWith(commitShaPrefix)
  })

  if (!reviewRow) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: migration review row not found for abort',
      meta: { reason: 'not_found', commit_sha_prefix: commitShaPrefix },
    })
    await editTelegramMessage(
      chatId,
      messageId,
      `${originalText}\n🛑 abort failed: not_found`
    ).catch(() => {})
    return
  }

  const meta = reviewRow.meta as Record<string, unknown>
  const commitSha = meta.commit_sha as string
  const taskId = meta.task_id as string
  const branch = meta.branch as string

  const { data: resolvedRows } = await db
    .from('agent_events')
    .select('id')
    .in('task_type', ['deploy_gate_promoted', 'deploy_gate_migration_aborted'])
    .filter('meta->>commit_sha', 'eq', commitSha)
    .limit(1)

  if (resolvedRows && resolvedRows.length > 0) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: migration review already resolved for abort',
      meta: { reason: 'already_resolved', commit_sha: commitSha },
    })
    await editTelegramMessage(chatId, messageId, `${originalText}\n🛑 already resolved`).catch(
      () => {}
    )
    return
  }

  try {
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'telegram_webhook',
      actor: 'telegram_webhook',
      status: 'success',
      task_type: 'deploy_gate_migration_aborted',
      output_summary: `migration aborted for commit ${commitSha.slice(0, 8)} — user tap`,
      meta: { commit_sha: commitSha, task_id: taskId, reason: 'user_abort' },
      tags: ['deploy_gate', 'harness', 'chunk_h'],
    })
  } catch {
    // swallow
  }

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  await editTelegramMessage(
    chatId,
    messageId,
    `${originalText}\n🛑 aborted at ${timestamp} MT — no promotion`
  ).catch(() => {})

  try {
    await deleteBranch(branch)
  } catch {
    // swallow
  }
}

async function handleGateRollback(
  mergeShaPrefix: string,
  chatId: number,
  messageId: number,
  originalText: string
): Promise<void> {
  const db = createServiceClient()

  const { data: promotedRows } = await db
    .from('agent_events')
    .select('id, meta')
    .eq('task_type', 'deploy_gate_promoted')
    .eq('status', 'success')
    .gte('occurred_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(20)

  const promotedRow = (promotedRows ?? []).find((r) => {
    const sha = (r.meta as Record<string, unknown>)?.merge_sha as string | undefined
    return sha?.startsWith(mergeShaPrefix)
  })

  if (!promotedRow) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: promoted row not found',
      meta: { reason: 'not_found', merge_sha_prefix: mergeShaPrefix },
    })
    await editRollbackAck(chatId, messageId, originalText, false, 'not_found').catch(() => {})
    return
  }

  const meta = promotedRow.meta as Record<string, unknown>
  const mergeSha = meta.merge_sha as string
  const taskId = (meta.task_id as string | undefined) ?? (meta.commit_sha as string)

  const { data: rolledBackRows } = await db
    .from('agent_events')
    .select('id')
    .eq('task_type', 'deploy_gate_rolled_back')
    .filter('meta->>merge_sha', 'eq', mergeSha)
    .limit(1)

  if (rolledBackRows && rolledBackRows.length > 0) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'warning',
      output_summary: 'early return: already rolled back',
      meta: { reason: 'already_rolled_back', merge_sha: mergeSha },
    })
    await editRollbackAck(chatId, messageId, originalText, false, 'already_rolled_back').catch(
      () => {}
    )
    return
  }

  let result: Awaited<ReturnType<typeof rollbackDeployment>>
  try {
    result = await rollbackDeployment(mergeSha, taskId)
  } catch {
    result = { ok: false, error: 'exception' }
  }

  try {
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'deploy_gate_runner',
      actor: 'deploy_gate',
      status: result.ok ? 'success' : 'error',
      task_type: result.ok ? 'deploy_gate_rolled_back' : 'deploy_gate_rollback_failed',
      output_summary: result.ok
        ? `rolled back merge ${mergeSha.slice(0, 8)} via revert commit ${result.revert_sha?.slice(0, 8)}`
        : `rollback failed: ${result.error}`,
      meta: {
        merge_sha: mergeSha,
        task_id: taskId,
        ...(result.revert_sha ? { revert_sha: result.revert_sha } : {}),
        ...(result.error ? { error: result.error } : {}),
      },
      tags: ['deploy_gate', 'harness', 'chunk_f'],
    })
  } catch {
    // swallow
  }

  await editRollbackAck(chatId, messageId, originalText, result.ok, result.error).catch(() => {})
}

// ── Improvement Engine handlers ───────────────────────────────────────────────

/**
 * Handles improve_approve_all:<chunk_id> callback.
 * Marks all queued improvement proposals for this chunk_id as status='approved'.
 */
async function handleImproveApproveAll(
  chunkId: string,
  chatId: number,
  messageId: number,
  originalText: string
): Promise<void> {
  const db = createServiceClient()

  const { error } = await db
    .from('task_queue')
    .update({ status: 'approved' })
    .eq('status', 'queued')
    .filter('metadata->>source_chunk_id', 'eq', chunkId)
    .filter('metadata->>task_type_label', 'eq', 'improvement_proposal')

  await logEvent({
    task_type: 'improvement_engine_approve_all',
    status: error ? 'error' : 'success',
    output_summary: error
      ? `approve_all failed for chunk ${chunkId}: ${error.message}`
      : `approved all proposals for chunk ${chunkId}`,
    meta: { chunk_id: chunkId, error: error?.message ?? null },
  })

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  await editTelegramMessage(
    chatId,
    messageId,
    error
      ? `${originalText}\nApprove failed: ${error.message.slice(0, 80)}`
      : `${originalText}\nAll approved at ${timestamp} MT`
  ).catch(() => {})
}

/**
 * Handles improve_dismiss:<chunk_id> callback.
 * Marks all queued improvement proposals for this chunk_id as status='dismissed'.
 */
async function handleImproveDismiss(
  chunkId: string,
  chatId: number,
  messageId: number,
  originalText: string
): Promise<void> {
  const db = createServiceClient()

  const { error } = await db
    .from('task_queue')
    .update({ status: 'dismissed' })
    .eq('status', 'queued')
    .filter('metadata->>source_chunk_id', 'eq', chunkId)
    .filter('metadata->>task_type_label', 'eq', 'improvement_proposal')

  await logEvent({
    task_type: 'improvement_engine_dismiss',
    status: error ? 'error' : 'success',
    output_summary: error
      ? `dismiss failed for chunk ${chunkId}: ${error.message}`
      : `dismissed all proposals for chunk ${chunkId}`,
    meta: { chunk_id: chunkId, error: error?.message ?? null },
  })

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  await editTelegramMessage(
    chatId,
    messageId,
    error
      ? `${originalText}\nDismiss failed: ${error.message.slice(0, 80)}`
      : `${originalText}\nAll dismissed at ${timestamp} MT`
  ).catch(() => {})
}

/**
 * Handles improve_review:<chunk_id> callback.
 * Sends individual proposal messages (one per proposal, approve/dismiss buttons).
 * Best-effort fire-and-forget — if it fails, log and return 200.
 */
async function handleImproveReview(chunkId: string, chatId: number): Promise<void> {
  const db = createServiceClient()
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  const { data: proposals } = await db
    .from('task_queue')
    .select('id, description, metadata')
    .eq('status', 'queued')
    .filter('metadata->>source_chunk_id', 'eq', chunkId)
    .filter('metadata->>task_type_label', 'eq', 'improvement_proposal')
    .order('created_at', { ascending: true })
    .limit(20)

  if (!proposals || proposals.length === 0) return

  for (const p of proposals as { id: string; description: string | null; metadata: Record<string, unknown> }[]) {
    const category = (p.metadata?.category as string) ?? 'unknown'
    const severity = (p.metadata?.severity as string) ?? 'unknown'
    const text = `[${category}] Severity: ${severity}\n${(p.description ?? '').slice(0, 200)}`

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [[
            { text: 'Approve', callback_data: `improve_approve_all:${chunkId}` },
            { text: 'Dismiss', callback_data: `improve_dismiss:${chunkId}` },
          ]],
        },
      }),
    }).catch(() => {})
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  console.log('[webhook] POST received', {
    hasSecret: request.headers.has('x-telegram-bot-api-secret-token'),
    ts: new Date().toISOString(),
  })
  await logEvent({
    task_type: 'telegram_webhook_entry',
    status: 'success',
    output_summary: 'webhook POST received',
    meta: {
      ts: new Date().toISOString(),
      has_secret_header: request.headers.has('x-telegram-bot-api-secret-token'),
    },
  })

  if (!verifyWebhookSecret(request)) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'error',
      output_summary: 'early return: auth_fail',
      meta: { reason: 'secret_mismatch_or_missing' },
    })
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'error',
      output_summary: 'early return: invalid_json',
      meta: { reason: 'json_parse_error' },
    })
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { message, callback_query: callbackQuery } = update

  // Ack callback immediately so Telegram's spinner clears — fires before any DB work
  if (callbackQuery) {
    void answerCallbackQuery(callbackQuery.id)
  }

  if (!message && !callbackQuery) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'success',
      output_summary: 'early return: no_callback_query_or_message',
      meta: { reason: 'unsupported_update_type', update_id: update.update_id },
    })
    return NextResponse.json({ ok: true })
  }

  // Allowlist applies to all update types — skip if no from field (channel posts, etc.)
  const fromUser = callbackQuery?.from ?? message?.from ?? null
  if (fromUser && !isAllowedUser(fromUser.id)) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'error',
      output_summary: 'early return: forbidden_user',
      meta: { reason: 'user_not_allowed', from_user_id: fromUser.id },
    })
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const chatId = callbackQuery?.message.chat.id ?? message?.chat?.id ?? null
  if (chatId == null) {
    return NextResponse.json({ ok: true })
  }

  // ── Dispatch i: outbound_notifications correlation (first match wins) ─────────

  const db = createServiceClient()
  let matchedId: string | null = null
  try {
    matchedId = await findMatchingRow(db, update, chatId)
  } catch {
    // DB error during correlation lookup — fall through to legacy handlers
  }

  if (matchedId) {
    const isCallback = Boolean(callbackQuery)
    const responsePayload = {
      type: isCallback ? 'callback' : 'message',
      text: message?.text ?? null,
      callback_data: callbackQuery?.data ?? null,
      from_user: fromUser
        ? `${fromUser.id}${fromUser.username ? ` (@${fromUser.username})` : ''}`
        : null,
      raw_update_id: String(update.update_id),
    }
    await db
      .from('outbound_notifications')
      .update({
        response: responsePayload,
        response_received_at: new Date().toISOString(),
        status: 'response_received',
      })
      .eq('id', matchedId)
    return NextResponse.json({ ok: true })
  }

  // ── Dispatch ii–iii: legacy thumbs + deploy-gate (callback_query only) ────────

  if (!callbackQuery) {
    // Plain message with no correlation match
    try {
      await db.from('agent_events').insert({
        domain: 'telegram',
        action: 'webhook_no_match',
        actor: 'harness',
        status: 'warning',
        task_type: 'webhook_no_match',
        output_summary: `inbound update ${update.update_id} — no outbound_notifications match`,
        meta: {
          update_id: update.update_id,
          chat_id: chatId,
          is_callback: false,
          has_reply_to: Boolean(message?.reply_to_message),
          text_preview: message?.text?.slice(0, 100) ?? null,
        },
      })
    } catch {
      // swallow
    }
    return NextResponse.json({ ok: true })
  }

  const parsed = parseCallbackData(callbackQuery.data ?? '')
  const parsedGate = parseGateCallbackData(callbackQuery.data ?? '')
  const parsedImprove = parseImproveCallbackData(callbackQuery.data ?? '')

  await logWebhookEvent(
    parsed?.agentEventId ?? null,
    callbackQuery.from.id,
    callbackQuery.data ?? '',
    parsed || parsedGate || parsedImprove ? 'success' : 'warning'
  )

  if (parsed) {
    await writeFeedback({
      agentEventId: parsed.agentEventId,
      feedbackType: parsed.action === 'up' ? 'thumbs_up' : 'thumbs_down',
      source: 'telegram_pickup_button',
      fromUserId: callbackQuery.from.id,
      messageId: callbackQuery.message.message_id,
      callbackQueryId: callbackQuery.id,
    })
  }

  if (parsed) {
    try {
      await editMessageWithAck(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        callbackQuery.message.text ?? '',
        parsed.action
      )
    } catch (err) {
      try {
        await db.from('agent_events').insert({
          domain: 'orchestrator',
          action: 'telegram_edit',
          actor: 'telegram_webhook',
          status: 'error',
          task_type: 'telegram_edit_fail',
          output_summary: `Failed to edit message ${callbackQuery.message.message_id} after ${parsed.action}`,
          meta: {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            action: parsed.action,
            error: String(err),
          },
          tags: ['telegram', 'webhook', 'component2'],
        })
      } catch {
        // logEvent itself failed — swallow
      }
    }
  } else if (parsedGate?.action === 'rollback') {
    await handleGateRollback(
      parsedGate.mergeShaPrefix,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      callbackQuery.message.text ?? ''
    )
  } else if (parsedGate?.action === 'promote') {
    await handleGatePromote(
      parsedGate.commitShaPrefix,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      callbackQuery.message.text ?? ''
    )
  } else if (parsedGate?.action === 'abort') {
    await handleGateAbort(
      parsedGate.commitShaPrefix,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      callbackQuery.message.text ?? ''
    )
  } else if (parsedImprove?.action === 'approve_all') {
    await handleImproveApproveAll(
      parsedImprove.chunkId,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      callbackQuery.message.text ?? ''
    )
  } else if (parsedImprove?.action === 'dismiss') {
    await handleImproveDismiss(
      parsedImprove.chunkId,
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      callbackQuery.message.text ?? ''
    )
  } else if (parsedImprove?.action === 'review') {
    // Best-effort fire-and-forget — log failure, return 200 regardless
    void handleImproveReview(parsedImprove.chunkId, callbackQuery.message.chat.id).catch(
      (err: unknown) => {
        void logEvent({
          task_type: 'improvement_engine_review_fail',
          status: 'error',
          output_summary: `handleImproveReview failed for chunk ${parsedImprove.chunkId}: ${String(err)}`,
          meta: { chunk_id: parsedImprove.chunkId, error: String(err) },
        })
      }
    )
  }

  return NextResponse.json({ ok: true })
}
