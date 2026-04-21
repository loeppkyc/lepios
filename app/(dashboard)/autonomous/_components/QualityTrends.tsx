/**
 * Quality Trends — §9 Step 6 of feedback-loop scoring.
 *
 * Server component. Fetches quality_score data from agent_events for the last
 * 14 days, grouped by task_type, within the current capacity tier. Renders one
 * card per task_type with a sparkline, aggregate scores, and dimension breakdown.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { CURRENT_CAPACITY_TIER, BASELINE_MIN_RUNS } from '@/lib/orchestrator/config'
import type { QualityScore } from '@/lib/orchestrator/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SparklinePoint {
  day: string
  avg_aggregate: number | null
}

interface DimensionBreakdown {
  completeness: number
  signal_quality: number
  efficiency: number
  hygiene: number
}

export interface TaskTypeTrend {
  task_type: string
  latest_score: number
  avg_14d: number
  sparkline_data: SparklinePoint[]
  run_count: number
  dimension_breakdown: DimensionBreakdown
  has_sufficient_baseline: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLast14Days(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-positive)'
  if (score >= 60) return 'var(--color-warning)'
  return 'var(--color-critical)'
}

// ── Data fetching ─────────────────────────────────────────────────────────────

export async function fetchQualityTrends(): Promise<TaskTypeTrend[]> {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('agent_events')
    .select('task_type, occurred_at, quality_score')
    .gte('occurred_at', since)
    .not('quality_score', 'is', null)
    .filter('quality_score->>capacity_tier', 'eq', CURRENT_CAPACITY_TIER)
    .order('occurred_at', { ascending: true })

  if (error || !data || data.length === 0) return []

  const days14 = getLast14Days()

  // Group rows by task_type
  const byTaskType = new Map<string, Array<{ occurred_at: string; quality_score: QualityScore }>>()
  for (const row of data) {
    if (!row.task_type) continue
    const qs = row.quality_score as QualityScore
    if (typeof qs?.aggregate !== 'number') continue
    const list = byTaskType.get(row.task_type) ?? []
    list.push({ occurred_at: row.occurred_at, quality_score: qs })
    byTaskType.set(row.task_type, list)
  }

  const trends: TaskTypeTrend[] = []

  for (const [task_type, rows] of byTaskType) {
    const run_count = rows.length

    // rows are ascending by occurred_at — latest is last
    const latest_score = rows[rows.length - 1].quality_score.aggregate

    const avg_14d =
      Math.round((rows.reduce((s, r) => s + r.quality_score.aggregate, 0) / run_count) * 10) / 10

    const dim_sums = { completeness: 0, signal_quality: 0, efficiency: 0, hygiene: 0 }
    for (const r of rows) {
      const d = r.quality_score.dimensions
      dim_sums.completeness += d.completeness
      dim_sums.signal_quality += d.signal_quality
      dim_sums.efficiency += d.efficiency
      dim_sums.hygiene += d.hygiene
    }
    const dimension_breakdown: DimensionBreakdown = {
      completeness: Math.round(dim_sums.completeness / run_count),
      signal_quality: Math.round(dim_sums.signal_quality / run_count),
      efficiency: Math.round(dim_sums.efficiency / run_count),
      hygiene: Math.round(dim_sums.hygiene / run_count),
    }

    // Build per-day avg for sparkline, filling gaps with null
    const byDay = new Map<string, number[]>()
    for (const r of rows) {
      const day = r.occurred_at.slice(0, 10)
      const arr = byDay.get(day) ?? []
      arr.push(r.quality_score.aggregate)
      byDay.set(day, arr)
    }
    const sparkline_data: SparklinePoint[] = days14.map((day) => {
      const arr = byDay.get(day)
      if (!arr || arr.length === 0) return { day, avg_aggregate: null }
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length
      return { day, avg_aggregate: Math.round(avg * 10) / 10 }
    })

    trends.push({
      task_type,
      latest_score,
      avg_14d,
      sparkline_data,
      run_count,
      dimension_breakdown,
      has_sufficient_baseline: run_count >= BASELINE_MIN_RUNS,
    })
  }

  return trends.sort((a, b) => a.task_type.localeCompare(b.task_type))
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: SparklinePoint[] }) {
  const W = 120
  const H = 40
  const padV = 4
  const chartH = H - padV * 2
  const n = data.length

  const nonNullPoints = data.filter((p) => p.avg_aggregate !== null)
  if (nonNullPoints.length === 0) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="no sparkline data">
        <text
          x={W / 2}
          y={H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--color-text-disabled)"
          fontSize={9}
          fontFamily="var(--font-ui)"
        >
          no data
        </text>
      </svg>
    )
  }

  const xFor = (i: number) => ((n > 1 ? i / (n - 1) : 0.5) * W).toFixed(1)
  const yFor = (v: number) => (padV + (1 - v / 100) * chartH).toFixed(1)

  // Build path with M/L, lifting pen at null gaps
  const parts: string[] = []
  let penUp = true
  for (let i = 0; i < data.length; i++) {
    const p = data[i]
    if (p.avg_aggregate === null) {
      penUp = true
      continue
    }
    parts.push(
      penUp ? `M${xFor(i)},${yFor(p.avg_aggregate)}` : `L${xFor(i)},${yFor(p.avg_aggregate)}`
    )
    penUp = false
  }

  // Latest non-null point for the dot
  let lastIdx = -1
  let lastVal: number | null = null
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].avg_aggregate !== null) {
      lastIdx = i
      lastVal = data[i].avg_aggregate
      break
    }
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="14-day quality sparkline">
      <line
        x1={0}
        y1={padV + chartH * 0.5}
        x2={W}
        y2={padV + chartH * 0.5}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path
        d={parts.join(' ')}
        fill="none"
        stroke="var(--color-accent-gold)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lastIdx >= 0 && lastVal !== null && (
        <circle cx={xFor(lastIdx)} cy={yFor(lastVal)} r={2.5} fill="var(--color-accent-gold)" />
      )}
    </svg>
  )
}

// ── Quality card ──────────────────────────────────────────────────────────────

function QualityCard({ trend }: { trend: TaskTypeTrend }) {
  const color = scoreColor(trend.latest_score)
  const d = trend.dimension_breakdown

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        minWidth: 180,
        flex: '1 1 180px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
        }}
      >
        {trend.task_type}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1.6rem',
            fontWeight: 700,
            color,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {trend.latest_score}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          avg {trend.avg_14d}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginLeft: 'auto',
          }}
        >
          {trend.run_count}r
        </span>
      </div>

      <Sparkline data={trend.sparkline_data} />

      {/* Dimension breakdown: C / SQ / E / H */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-muted)',
        }}
      >
        <span>
          C <strong style={{ color: scoreColor(d.completeness) }}>{d.completeness}</strong>
        </span>
        <span>
          SQ <strong style={{ color: scoreColor(d.signal_quality) }}>{d.signal_quality}</strong>
        </span>
        <span>
          E <strong style={{ color: scoreColor(d.efficiency) }}>{d.efficiency}</strong>
        </span>
        <span>
          H <strong style={{ color: scoreColor(d.hygiene) }}>{d.hygiene}</strong>
        </span>
      </div>

      {!trend.has_sufficient_baseline && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            backgroundColor: 'var(--color-overlay)',
            borderRadius: 3,
            padding: '2px 6px',
            alignSelf: 'flex-start',
          }}
        >
          Insufficient baseline ({trend.run_count}/{BASELINE_MIN_RUNS})
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default async function QualityTrends() {
  const trends = await fetchQualityTrends()

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
          }}
        >
          Quality Trends
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            backgroundColor: 'var(--color-overlay)',
            borderRadius: 3,
            padding: '2px 6px',
          }}
        >
          Scored against: {CURRENT_CAPACITY_TIER}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          last 14 days
        </span>
      </div>

      {trends.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No quality data yet — scores appear after the first scored run
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {trends.map((trend) => (
            <QualityCard key={trend.task_type} trend={trend} />
          ))}
        </div>
      )}
    </div>
  )
}
