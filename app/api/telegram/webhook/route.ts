import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  isAllowedUser,
  parseCallbackData,
  parseGateCallbackData,
} from '@/lib/harness/telegram-buttons'
import {
  rollbackDeployment,
  mergeToMain,
  deleteBranch,
  sendPromotionNotification,
} from '@/lib/harness/deploy-gate'

export const dynamic = 'force-dynamic'

type CallbackQuery = {
  id: string
  from: { id: number; username?: string }
  message: { message_id: number; chat: { id: number }; text?: string }
  data?: string
}

type TelegramUpdate = {
  update_id: number
  callback_query?: CallbackQuery
}

function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  return request.headers.get('x-telegram-bot-api-secret-token') === secret
}

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

// Upsert: update if a tap already exists for this (agent_event_id, source) pair,
// insert otherwise. Latest tap wins — allows 👍 → 👎 correction.
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

// Removes the inline keyboard and appends "👍 recorded at HH:MM MT" to the message.
// Fire-and-forget; edit failure is non-fatal.
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

  // Find the promoted row matching the merge_sha prefix (last hour)
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

  // Double-tap guard
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
    // swallow — edit still proceeds
  }

  await editRollbackAck(chatId, messageId, originalText, result.ok, result.error).catch(() => {})
}

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

  const { callback_query: callbackQuery } = update

  if (!callbackQuery) {
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'success',
      output_summary: 'early return: no_callback_query',
      meta: { reason: 'not_a_button_tap', update_id: update.update_id },
    })
    return NextResponse.json({ ok: true })
  }

  if (!isAllowedUser(callbackQuery.from.id)) {
    await answerCallbackQuery(callbackQuery.id)
    await logEvent({
      task_type: 'telegram_webhook_early_return',
      status: 'error',
      output_summary: 'early return: forbidden_user',
      meta: { reason: 'user_not_allowed', from_user_id: callbackQuery.from.id },
    })
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const parsed = parseCallbackData(callbackQuery.data ?? '')
  const parsedGate = parseGateCallbackData(callbackQuery.data ?? '')

  await logWebhookEvent(
    parsed?.agentEventId ?? null,
    callbackQuery.from.id,
    callbackQuery.data ?? '',
    parsed || parsedGate ? 'success' : 'warning'
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

  // Dismiss spinner before the edit — answerCallbackQuery must fire first
  await answerCallbackQuery(callbackQuery.id)

  if (parsed) {
    try {
      await editMessageWithAck(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        callbackQuery.message.text ?? '',
        parsed.action
      )
    } catch (err) {
      // Don't throw — callback is already acked, feedback row is written.
      try {
        const db = createServiceClient()
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
        // logEvent itself failed — swallow, we already acked.
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
  }

  return NextResponse.json({ ok: true })
}
