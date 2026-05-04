export type CheckStatus = 'pass' | 'fail' | 'warn'
export type CapacityTier = string
export type TickStatus = 'completed' | 'partial_failure' | 'failed'
export type DigestStatus = 'sent' | 'no_tick_found' | 'telegram_failed'

export interface Flag {
  severity: 'critical' | 'warn' | 'info'
  message: string
  entity_id?: string
  entity_type?: string
}

export interface CheckResult {
  name: string
  status: CheckStatus
  flags: Flag[]
  counts: Record<string, number>
  duration_ms: number
}

export interface TickResult {
  tick_id: string
  run_id: string
  mode: 'overnight_readonly' | 'daytime_ollama'
  checks: CheckResult[]
  duration_ms: number
  started_at: string
  finished_at: string
  status: TickStatus
}

export interface DaytimeTickResult extends Omit<TickResult, 'mode'> {
  mode: 'daytime_ollama'
  tunnel_used: boolean
}

export interface QualityDimensions {
  completeness: number
  signal_quality: number
  efficiency: number
  hygiene: number
}

export interface QualityScore {
  aggregate: number
  capacity_tier: CapacityTier
  dimensions: QualityDimensions
  weights_version: string
  scored_at: string
  scored_by: string
}

export interface HistoricalContext {
  task_type: string
  capacity_tier: CapacityTier
  prior_durations_ms: number[]
}

export interface DigestResult {
  status: DigestStatus
  composed_at: string
  sent_at: string | null
  found_tick: boolean
  character_count: number
  telegram_latency_ms: number | null
  source_flag_count: number
}
