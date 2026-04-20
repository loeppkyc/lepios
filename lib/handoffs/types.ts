export type HandoffStatus = 'completed' | 'partial' | 'blocked' | 'deferred'
export type ImpactLevel = 'critical' | 'high' | 'medium' | 'low'
export type Priority = 'p0' | 'p1' | 'p2'

export interface HandoffDecision {
  decision: string
  rationale: string
  reversible: boolean
  affected_files?: string[]
}

export interface HandoffCompleted {
  task: string
  artifact?: string
  verified: boolean
}

export interface HandoffDeferred {
  task: string
  rationale: string
  sprint_gate?: string
  blocking: boolean
}

export interface HandoffUnresolved {
  issue: string
  impact: ImpactLevel
  suggested_action?: string
}

export interface HandoffArchitecturalChange {
  change: string
  files_affected: string[]
  migration?: string
}

export interface HandoffNextStep {
  action: string
  priority: Priority
  prerequisite?: string
}

export interface HandoffScore {
  in_scope: number  // 0–100 headline score
  notes?: string
  deferred_items: Array<{
    item: string
    rationale: string
  }>
}

/**
 * Machine-readable session handoff record. schema_version=1.
 * Stored in session_handoffs.payload JSONB; surface columns mirror
 * the top-level fields for cheap SQL filtering.
 */
export interface SessionHandoff {
  schema_version: 1
  session_id: string        // e.g. "2026-04-18-sprint3" — human-readable slug
  occurred_at: string       // ISO 8601
  goal: string              // one sentence: what this session set out to accomplish
  status: HandoffStatus
  sprint?: number
  decisions: HandoffDecision[]
  completed: HandoffCompleted[]
  deferred: HandoffDeferred[]
  unresolved: HandoffUnresolved[]
  architectural_changes: HandoffArchitecturalChange[]
  next_steps: HandoffNextStep[]
  score?: HandoffScore
  notes?: string
}

/** Row shape as stored in Supabase. */
export interface SessionHandoffRow {
  id: string
  session_id: string
  schema_version: number
  occurred_at: string
  goal: string
  status: HandoffStatus
  sprint: number | null
  payload: SessionHandoff
}

export interface SaveHandoffOptions {
  /** Overwrite an existing record with the same session_id (upsert). Default: false */
  upsert?: boolean
}
