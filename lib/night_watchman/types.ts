// Core types for night-watchman v2.
// Mirrors the CHECK constraints in migration 0140.

export type Category = 'health' | 'errors' | 'security' | 'data' | 'cost' | 'performance'
export type Status = 'ok' | 'warn' | 'fail' | 'skipped'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type RepairOutcome =
  | 'success'
  | 'failure'
  | 'not_applicable'
  | 'escalated'
  | 'sandbox_pr_opened'
export type Resolution =
  | 'auto_repaired'
  | 'sandbox_pr'
  | 'human_resolved'
  | 'timed_out'
  | 'superseded'
export type Scope = 'sleep_window' | 'daytime' | 'manual'

/** Result of running a single check. */
export interface CheckResult {
  key: string
  category: Category
  status: Status
  severity?: Severity
  /** Stable, JSON-safe diagnostic payload — what made the check decide. */
  evidence: Record<string, unknown>
  /** Per-check execution time. Filled by the scanner; checks may leave undefined. */
  durationMs?: number
}

/** Result of attempting a repair on a failing check. */
export interface RepairResult {
  outcome: RepairOutcome
  /** Free-form, JSON-safe — what was tried, what changed, links/IDs. */
  evidence: Record<string, unknown>
  /**
   * If true, the repair flips the check from fail→ok this scan.
   * Drives total_repairs counter + auto-bump signal.
   */
  resolved: boolean
}

/** Telegram message routing for an escalation. */
export interface TelegramOutcome {
  /** message_id returned by Telegram API on success. */
  messageId?: number
  ok: boolean
  error?: string
}

/** A pluggable check definition. */
export interface CheckDef {
  key: string
  category: Category
  /**
   * Default severity if a check signals fail without specifying. Individual
   * runs may override (e.g. p95 latency check returns 'medium' or 'critical'
   * depending on threshold).
   */
  defaultSeverity: Severity
  /** Description for /self-repair status grid. */
  label: string
  run(ctx: CheckContext): Promise<CheckResult>
  /** Optional repair playbook. Absent = always escalate. */
  repair?: (result: CheckResult, ctx: RepairContext) => Promise<RepairResult>
}

/** Context passed to every check.run() — injected by the scanner. */
export interface CheckContext {
  runId: string
  scope: Scope
  /** Wall-clock time the run started (UTC). */
  runStartedAt: Date
  /** True when running for dry-run (no repairs apply). */
  dryRun: boolean
}

/** Context passed to a check's repair() — adds repair-specific knobs. */
export interface RepairContext extends CheckContext {
  /**
   * If true, the loop guard says we've hit the per-check or global cap and
   * the scanner is calling repair() ONLY to get the would-have-tried evidence
   * for the escalation message. The repair must NOT take any side effect.
   */
  observeOnly: boolean
}

/** Tier of repair handler dispatch. */
export type RepairTier = 'safe_list' | 'sandbox_gated' | 'human_required'

/** Scanner output — what the cron route returns. */
export interface ScanReport {
  runId: string
  startedAt: string
  finishedAt: string
  scope: Scope
  totalChecks: number
  totalRepairs: number
  totalIncidents: number
  totalEscalations: number
  halted: boolean
  haltReason?: string
  results: CheckResult[]
  /**
   * One entry per repair attempted in this scan, in order.
   * (Null = repair_outcome from check_results row joined back.)
   */
  repairs: Array<{
    checkKey: string
    tier: RepairTier
    outcome: RepairOutcome
    resolved: boolean
  }>
}
