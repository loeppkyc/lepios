/**
 * Safety Agent — Phase 3: approval lifecycle.
 *
 * Spec: docs/specs/safety-agent.md.
 *
 * Pending → {Approved | Blocked | Deferred}. State lives in agent_events as
 * append-only rows (one per transition). The "approval id" returned by
 * requestApproval is the id of the original `safety.review.requested` row;
 * subsequent decisions reference it via meta.parent_id.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { Severity, StaticCheckInput, StaticCheckResult } from './static'
import type { LlmReviewResult } from './llm-review'

export type Decision = 'approve' | 'block' | 'defer'

export interface RequestApprovalInput {
  context: string
  proposedAction: StaticCheckInput
  staticResult: StaticCheckResult
  llmResult?: LlmReviewResult
  requestedBy: string
}

export interface ApprovalStatus {
  id: string
  state: 'pending' | 'approved' | 'blocked' | 'deferred'
  decided_by?: string
  decided_at?: string
  context: string
  worst_severity: Severity
}

export interface DecideInput {
  approvalId: string
  decision: Decision
  decidedBy: string
  rationale?: string
}

export interface DecideResult {
  ok: boolean
  status: ApprovalStatus
}

const ACTION_REQUEST = 'safety.review.requested'
const ACTION_DECISION: Record<Decision, string> = {
  approve: 'safety.review.approved',
  block: 'safety.review.blocked',
  defer: 'safety.review.deferred',
}

function worstSeverity(s: Severity, l?: Severity): Severity {
  const rank: Record<Severity, number> = { pass: 0, warn: 1, block: 2 }
  if (!l) return s
  return rank[s] >= rank[l] ? s : l
}

export async function requestApproval(input: RequestApprovalInput): Promise<{ id: string; worst: Severity }> {
  const db = createServiceClient()
  const worst = worstSeverity(input.staticResult.severity, input.llmResult?.severity)

  const { data, error } = await db
    .from('agent_events')
    .insert({
      domain: 'harness',
      action: ACTION_REQUEST,
      actor: input.requestedBy,
      status: 'pending',
      output_summary: `${worst.toUpperCase()}: ${input.context.slice(0, 100)}`,
      meta: {
        context: input.context,
        proposed_action: input.proposedAction,
        static: input.staticResult,
        llm: input.llmResult ?? null,
        worst_severity: worst,
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`requestApproval insert failed: ${error?.message ?? 'no row returned'}`)
  }
  return { id: data.id as string, worst }
}

export async function decideApproval(input: DecideInput): Promise<DecideResult> {
  const db = createServiceClient()

  // Verify the parent request exists + is still pending
  const { data: parent, error: parentErr } = await db
    .from('agent_events')
    .select('id, action, meta, output_summary')
    .eq('id', input.approvalId)
    .single()

  if (parentErr || !parent) {
    throw new Error(`approval ${input.approvalId} not found`)
  }
  if (parent.action !== ACTION_REQUEST) {
    throw new Error(`approval ${input.approvalId} is not a safety.review.requested row (got ${parent.action})`)
  }

  // Check whether already decided
  const { data: existingDecisions } = await db
    .from('agent_events')
    .select('id, action')
    .eq('domain', 'harness')
    .filter('meta->>parent_id', 'eq', input.approvalId)

  if (existingDecisions && existingDecisions.length > 0) {
    const existing = existingDecisions[0] as { action: string }
    throw new Error(`approval ${input.approvalId} already decided (${existing.action})`)
  }

  const { error: insertErr } = await db.from('agent_events').insert({
    domain: 'harness',
    action: ACTION_DECISION[input.decision],
    actor: input.decidedBy,
    status: input.decision === 'approve' ? 'success' : 'warning',
    output_summary: `${input.decision} — ${input.rationale ?? '(no rationale)'}`.slice(0, 240),
    meta: {
      parent_id: input.approvalId,
      decision: input.decision,
      rationale: input.rationale ?? null,
    },
  })

  if (insertErr) {
    throw new Error(`decide insert failed: ${insertErr.message}`)
  }

  const meta = (parent.meta ?? {}) as { context?: string; worst_severity?: Severity }
  return {
    ok: true,
    status: {
      id: input.approvalId,
      state: input.decision === 'approve' ? 'approved' : input.decision === 'block' ? 'blocked' : 'deferred',
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
      context: meta.context ?? '',
      worst_severity: meta.worst_severity ?? 'pass',
    },
  }
}

export async function getApprovalStatus(approvalId: string): Promise<ApprovalStatus | null> {
  const db = createServiceClient()

  const { data: parent } = await db
    .from('agent_events')
    .select('id, action, meta')
    .eq('id', approvalId)
    .single()

  if (!parent || parent.action !== ACTION_REQUEST) return null
  const meta = (parent.meta ?? {}) as { context?: string; worst_severity?: Severity }

  const { data: decisions } = await db
    .from('agent_events')
    .select('id, action, actor, created_at, meta')
    .eq('domain', 'harness')
    .filter('meta->>parent_id', 'eq', approvalId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!decisions || decisions.length === 0) {
    return {
      id: approvalId,
      state: 'pending',
      context: meta.context ?? '',
      worst_severity: meta.worst_severity ?? 'pass',
    }
  }

  const d = decisions[0] as { action: string; actor: string; created_at: string }
  const state =
    d.action === ACTION_DECISION.approve
      ? 'approved'
      : d.action === ACTION_DECISION.block
        ? 'blocked'
        : 'deferred'

  return {
    id: approvalId,
    state,
    decided_by: d.actor,
    decided_at: d.created_at,
    context: meta.context ?? '',
    worst_severity: meta.worst_severity ?? 'pass',
  }
}

// ── Telegram dispatch ────────────────────────────────────────────────────────

export interface SendApprovalCardResult {
  ok: boolean
  reason?: string
}

/**
 * Queue a Telegram approval card via outbound_notifications. Does NOT call
 * Telegram directly — the notifications-drain cron picks it up. Telegram-side
 * inline_keyboard is encoded in the payload so the drain handler renders it.
 */
export async function sendApprovalCard(args: {
  approvalId: string
  summary: string
  worstSeverity: Severity
  rationale?: string
}): Promise<SendApprovalCardResult> {
  const db = createServiceClient()

  const lines = [
    `🛡️ Safety review (${args.worstSeverity.toUpperCase()})`,
    args.summary,
  ]
  if (args.rationale) lines.push(`Reason: ${args.rationale.slice(0, 200)}`)
  lines.push(`ID: ${args.approvalId.slice(0, 8)}`)

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: buildSafetyCallbackData('approve', args.approvalId) },
        { text: '🚫 Block', callback_data: buildSafetyCallbackData('block', args.approvalId) },
        { text: '⏸️ Defer', callback_data: buildSafetyCallbackData('defer', args.approvalId) },
      ],
    ],
  }

  const { error } = await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: { text: lines.join('\n'), reply_markup: replyMarkup },
    correlation_id: `safety-approval-${args.approvalId}`,
    requires_response: true,
  })

  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

// ── Telegram callback helpers (used by webhook + button-builder) ─────────────

export const SAFETY_CALLBACK_PREFIX = 'sr'

export function buildSafetyCallbackData(decision: Decision, approvalId: string): string {
  const code = decision === 'approve' ? 'ap' : decision === 'block' ? 'bk' : 'df'
  return `${SAFETY_CALLBACK_PREFIX}:${code}:${approvalId}`
}

export function parseSafetyCallbackData(
  data: string,
): { decision: Decision; approvalId: string } | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== SAFETY_CALLBACK_PREFIX) return null
  const decisionMap: Record<string, Decision> = { ap: 'approve', bk: 'block', df: 'defer' }
  const decision = decisionMap[parts[1]]
  if (!decision) return null
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuidRe.test(parts[2])) return null
  return { decision, approvalId: parts[2] }
}
