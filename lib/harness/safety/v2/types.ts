/**
 * lib/harness/safety/v2/types.ts
 *
 * Shared types for Safety Agent v2 (T-002, spec v2 2026-05-08).
 *
 * Each signal module returns SignalFinding[]. The scorer (Sub-phase B) resolves
 * the WeightKey to a number from harness_config and sums to a 0–100 risk score.
 * Audit trail lands in safety_decisions (migration 0162).
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done
 */

// F18: lib/harness/safety/v2

/**
 * Weight keys correspond 1:1 to harness_config rows seeded in migration 0162.
 * Adding a key here requires both: an INSERT in a new migration, and a default
 * lookup at scorer time so missing rows don't crash the gate.
 */
export type WeightKey =
  | 'SAFETY_WEIGHT_SECRET_DETECTED'
  | 'SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'
  | 'SAFETY_WEIGHT_MIGRATION_ADDITIVE'
  | 'SAFETY_WEIGHT_COVERAGE_DROP_5PCT'
  | 'SAFETY_WEIGHT_COVERAGE_DROP_15PCT'
  | 'SAFETY_WEIGHT_LOC_DELTA_2X'
  | 'SAFETY_WEIGHT_FAILURE_PATTERN_LOW'
  | 'SAFETY_WEIGHT_FAILURE_PATTERN_HIGH'
  | 'SAFETY_WEIGHT_SHARED_SEAM_TOUCH'
  | 'SAFETY_WEIGHT_API_ROUTE_NETNEW'
  | 'SAFETY_WEIGHT_BASE'

export interface SignalFinding {
  /** Stable identifier for telemetry. e.g. "drop_table", "loc_delta_2x". */
  id: string
  /** Human-readable label rendered in audit + Colin escalation. */
  name: string
  /** harness_config key the scorer looks up for the numeric weight. */
  weight_key: WeightKey
  /** One-line evidence string (file path, line snippet, count, etc). */
  evidence: string
}

/**
 * PR-vs-base diff input. Constructed by the deploy-gate-runner adapter
 * (Sub-phase D) from GitHub API; signal modules consume it as a pure value.
 */
export interface PRDiffInput {
  /** Unified diff text — `git diff base..head`. */
  unified_diff: string
  /** Files touched (added + modified + deleted). */
  files_changed: string[]
  /** Lines added (`git diff --shortstat`). */
  loc_added: number
  /** Lines removed. */
  loc_removed: number
  /** Migration files in the PR with their full SQL. */
  migration_files: { path: string; sql: string }[]
  /** Net-new files (added in this PR, not in base). */
  new_files?: string[]
  /** Optional plan_loc from task_queue — null if no plan recorded. */
  plan_loc?: number | null
  /** Optional commit message — used for failure-pattern keyword extraction. */
  commit_message?: string
}

/**
 * Tier classification from a numeric risk score. Thresholds live in
 * harness_config (SAFETY_THRESHOLD_LOW_MAX / SAFETY_THRESHOLD_MEDIUM_MAX).
 */
export type RiskTier = 'low' | 'medium' | 'high'

/**
 * Final routing action. Maps 1:1 to safety_decisions.action enum.
 */
export type SafetyAction =
  | 'auto_merge'
  | 'twin_proceed'
  | 'twin_hold'
  | 'twin_escalate'
  | 'colin_escalate'
  | 'twin_unavailable'
