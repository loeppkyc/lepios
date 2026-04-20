export type CheckStatus = 'pass' | 'fail' | 'warn'
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
  mode: 'overnight_readonly'
  checks: CheckResult[]
  duration_ms: number
  started_at: string
  finished_at: string
  status: TickStatus
}
