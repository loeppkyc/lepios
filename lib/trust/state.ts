/**
 * Trust Gate state types and trust_state DB row shape.
 *
 * The trust gate is the paper-to-live gate for each domain (trading / sports).
 * All five thresholds must pass for gate_status='open'.
 * Only an authenticated user can flip to live; flip to paper is always allowed.
 *
 * Sprint 10 Chunk C
 */

export type Domain = 'trading' | 'sports'
export type Mode = 'paper' | 'live'
export type GateStatus = 'open' | 'closed'

/** Full trust_state DB row shape (matches migration 0142) */
export interface TrustStateRow {
  domain: Domain
  current_mode: Mode
  flipped_to_live_at: string | null
  flipped_to_live_by: string | null

  // Thresholds (editable via PATCH /api/trust-state/[domain]/thresholds)
  min_sample_size: number
  win_rate_threshold: number
  secondary_metric_key: string
  secondary_metric_threshold: number
  calibration_grade: string
  calibration_threshold: number
  max_drawdown_threshold: number

  // Rolling stats (recomputed on every prediction resolve)
  current_sample_size: number
  current_win_rate: number | null
  current_secondary_metric: number | null
  current_calibration_rate: number | null
  current_drawdown: number | null
  last_recomputed_at: string | null

  // Gate state
  gate_status: GateStatus
  gate_failures: string[] | null

  updated_at: string
}

/** Single metric evaluation result */
export interface MetricEval {
  current: number | null
  threshold: number
  pass: boolean
}

/** Full gate evaluation for one domain */
export interface GateEvaluation {
  domain: Domain
  current_mode: Mode
  gate_status: GateStatus
  metrics: {
    sample_size: MetricEval
    win_rate: MetricEval
    secondary: MetricEval & { key: string }
    calibration: MetricEval
    drawdown: MetricEval
  }
  /** Human-readable list of unmet thresholds */
  failures: string[]
  /** gate_status === 'open' AND current_mode === 'paper' */
  can_go_live: boolean
}
