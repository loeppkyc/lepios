export interface TrackResult {
  track: string
  label: string
  strategic_weight_pct: number
  source: 'db' | 'doc_parse' | 'hardcoded'
  rollup_pct: number
  raw_pts: number
  denominator: number
  known_undercount: boolean
  source_stale: boolean
  source_last_updated: string | null
  compute_ms: number
  error: string | null
}

export interface RollupReport {
  computed_at: string // ISO UTC
  strategic_pct: number // weighted sum
  delta_vs_prev: number | null
  tracks: TrackResult[]
  sources_polled: number
  errors_per_track: number
  total_compute_ms: number
}
