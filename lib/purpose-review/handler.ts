/**
 * lib/purpose-review/handler.ts
 *
 * Telegram callback and text-reply handler for the purpose_review gate.
 * Phase 0.5 — runs before Phase 1a in every Streamlit port chunk.
 *
 * Callback format:  purpose_review:<action>:<task_queue_id>
 * Actions:          approve | revise | skip
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAttribution } from '@/lib/attribution/writer'
import { createServiceClient } from '@/lib/supabase/service'
import { httpRequest } from '@/lib/harness/arms-legs/http'

// ── Telegram helpers (duplicated locally to avoid coupling to route.ts internals) ──

async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await httpRequest({
    url: `https://api.telegram.org/bot${token}/editMessageText`,
    method: 'POST',
    capability: 'net.outbound.telegram',
    agentId: 'purpose_review',
    body: { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } },
  }).catch(() => {})
}

// ── parsePurposeReviewCallback ────────────────────────────────────────────────

/**
 * Parses callback_data for purpose review button taps.
 * Format: purpose_review:<action>:<task_queue_id>
 * Returns null if the string is not a purpose_review callback.
 */
export function parsePurposeReviewCallback(
  data: string
): { action: 'approve' | 'revise' | 'skip'; taskQueueId: string } | null {
  const m = data.match(/^purpose_review:(approve|revise|skip):(.+)$/)
  if (!m) return null
  const action = m[1] as 'approve' | 'revise' | 'skip'
  const taskQueueId = m[2]
  // Validate UUID format
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuidRe.test(taskQueueId)) return null
  return { action, taskQueueId }
}

// ── handlePurposeReviewCallback ───────────────────────────────────────────────

export async function handlePurposeReviewCallback(params: {
  action: 'approve' | 'revise' | 'skip'
  taskQueueId: string
  chatId: number
  messageId: number
  originalText: string
  db?: SupabaseClient
}): Promise<void> {
  const { action, taskQueueId, chatId, messageId, originalText } = params
  const db = params.db ?? createServiceClient()

  // Fetch the task row to get module_path for attribution
  const { data: taskRow } = await db
    .from('task_queue')
    .select('id, metadata')
    .eq('id', taskQueueId)
    .maybeSingle()

  const meta = (taskRow?.metadata as Record<string, unknown>) ?? {}
  const modulePath = (meta.module_path as string) ?? 'unknown'
  const classification = (meta.classification as string) ?? null
  const suggestedTier = (meta.suggested_tier as string) ?? null

  if (action === 'approve') {
    // Update metadata only; status stays 'claimed'
    const { error } = await db
      .from('task_queue')
      .update({
        metadata: { ...meta, purpose_review: 'approved' },
      })
      .eq('id', taskQueueId)

    await db.from('agent_events').insert({
      domain: 'purpose_review',
      action: 'purpose_review.approved',
      actor: 'colin',
      status: error ? 'error' : 'success',
      task_type: 'purpose_review',
      output_summary: `purpose review approved for ${modulePath}`,
      meta: {
        task_queue_id: taskQueueId,
        module_path: modulePath,
        classification,
        suggested_tier: suggestedTier,
        error: error?.message ?? null,
      },
      tags: ['purpose_review', 'harness'],
    })

    void recordAttribution(
      { actor_type: 'colin', actor_id: 'telegram' },
      { type: 'task_queue', id: taskQueueId },
      'purpose_reviewed',
      { action: 'approve', module_path: modulePath }
    )

    await editMessage(chatId, messageId, `${originalText}\n\n✅ Approved — starting study`)
    return
  }

  // TODO(v2): single revision round only. If usage shows avg iterations > 1.5,
  // consider multi-round: re-generate summary with notes, ask again before Phase 1a.
  if (action === 'revise') {
    const { error } = await db
      .from('task_queue')
      .update({
        status: 'awaiting_review',
        metadata: { ...meta, purpose_review: 'pending_notes', review_message_id: messageId },
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', taskQueueId)

    await db.from('agent_events').insert({
      domain: 'purpose_review',
      action: 'purpose_review.revise_requested',
      actor: 'colin',
      status: error ? 'error' : 'success',
      task_type: 'purpose_review',
      output_summary: `purpose review revision requested for ${modulePath}`,
      meta: {
        task_queue_id: taskQueueId,
        module_path: modulePath,
        classification,
        suggested_tier: suggestedTier,
        error: error?.message ?? null,
      },
      tags: ['purpose_review', 'harness'],
    })

    await editMessage(chatId, messageId, `${originalText}\n\n✏️ Send your changes:`)
    return
  }

  if (action === 'skip') {
    const { error } = await db
      .from('task_queue')
      .update({
        status: 'cancelled',
        metadata: { ...meta, purpose_review: 'skipped' },
      })
      .eq('id', taskQueueId)

    await db.from('agent_events').insert({
      domain: 'purpose_review',
      action: 'purpose_review.skipped',
      actor: 'colin',
      status: error ? 'error' : 'success',
      task_type: 'purpose_review',
      output_summary: `purpose review skipped for ${modulePath}`,
      meta: {
        task_queue_id: taskQueueId,
        module_path: modulePath,
        classification,
        suggested_tier: suggestedTier,
        error: error?.message ?? null,
      },
      tags: ['purpose_review', 'harness'],
    })

    void recordAttribution(
      { actor_type: 'colin', actor_id: 'telegram' },
      { type: 'task_queue', id: taskQueueId },
      'purpose_reviewed',
      { action: 'skip', module_path: modulePath }
    )

    await editMessage(chatId, messageId, `${originalText}\n\n🗑️ Skipped`)
    return
  }
}

// ── handlePurposeReviewTextReply ──────────────────────────────────────────────

/**
 * Handles free-text reply after the ✏️ revise button was tapped.
 * Stores purpose_notes in task_queue.metadata, resumes pipeline (status=claimed).
 */
export async function handlePurposeReviewTextReply(params: {
  taskQueueId: string
  text: string
  chatId: number
  messageId: number
  originalText: string
  db?: SupabaseClient
}): Promise<void> {
  const { taskQueueId, text, chatId, messageId, originalText } = params
  const db = params.db ?? createServiceClient()

  // Fetch existing metadata
  const { data: taskRow } = await db
    .from('task_queue')
    .select('id, metadata')
    .eq('id', taskQueueId)
    .maybeSingle()

  const meta = (taskRow?.metadata as Record<string, unknown>) ?? {}
  const modulePath = (meta.module_path as string) ?? 'unknown'
  const classification = (meta.classification as string) ?? null
  const suggestedTier = (meta.suggested_tier as string) ?? null

  const { error } = await db
    .from('task_queue')
    .update({
      status: 'claimed',
      metadata: {
        ...meta,
        purpose_review: 'approved_with_notes',
        purpose_notes: text,
      },
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('id', taskQueueId)

  await db.from('agent_events').insert({
    domain: 'purpose_review',
    action: 'purpose_review.approved_with_notes',
    actor: 'colin',
    status: error ? 'error' : 'success',
    task_type: 'purpose_review',
    output_summary: `purpose review notes received for ${modulePath}`,
    meta: {
      task_queue_id: taskQueueId,
      module_path: modulePath,
      classification,
      suggested_tier: suggestedTier,
      purpose_notes: text,
      error: error?.message ?? null,
    },
    tags: ['purpose_review', 'harness', 'twin_corpus'],
  })

  void recordAttribution(
    { actor_type: 'colin', actor_id: 'telegram' },
    { type: 'task_queue', id: taskQueueId },
    'purpose_reviewed',
    { action: 'approved_with_notes', module_path: modulePath, purpose_notes: text }
  )

  await editMessage(
    chatId,
    messageId,
    `${originalText}\n\n✏️ Notes received — starting study with your input.`
  )
}
