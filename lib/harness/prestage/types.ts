/**
 * lib/harness/prestage/types.ts
 *
 * Shared types for the queue pre-stager (Module B).
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4
 */

export type ProposalSource =
  | 'failures_md'
  | 'env_audit'
  | 'gpu_day_gap'
  | 'self_repair_dlq'
  | 'morning_digest'
  | 'manual'

/**
 * What a source returns. The runner adds id, status, created_at, etc.
 * - source_ref is the dedup key. Sources MUST set it for any non-manual proposal.
 * - confidence is 0..1; >= 0.8 is the auto-promotion floor.
 * - risk_score is 0..100; mapped to RiskTier at promote time.
 */
export type ProposalDraft = {
  task: string
  description: string
  source_ref: string
  confidence: number
  risk_score: number
  proposed_priority?: number
  metadata?: Record<string, unknown>
}

export type ProposalSourceFn = () => Promise<ProposalDraft[]>

export type SourceRegistration = {
  source: ProposalSource
  enabled: boolean
  run: ProposalSourceFn
}

export type RunSummary = {
  ok: true
  total_proposals_seen: number
  new_proposals: number
  auto_promoted: number
  per_source: Record<
    ProposalSource,
    { seen: number; inserted: number; promoted: number; error?: string }
  >
}
