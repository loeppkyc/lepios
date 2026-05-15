'use client'

// F18 Ceiling Metric Layer — CeilingTable component
// chunk: f18-ceiling  task_id: e1d3c848-ce4f-4d9d-a4f2-1f8eb6585d5c
// F20: NO inline style={} attributes — Tailwind classes only

type CeilingStatus = 'at_ceiling' | 'below_benchmark' | 'ok' | 'no_data'

export interface CeilingRow {
  id: string
  module: string
  metric_name: string
  metric_unit: string | null
  current_value: number | null
  benchmark_value: number | null
  ceiling_value: number | null
  ceiling_cause: string
  ceiling_cause_category: 'money' | 'hardware' | 'time'
  ceiling_lift_cost: string | null
  ceiling_lift_gain_pct: number | null
  benchmark_source: 'colin-target' | 'industry' | 'known-good' | null
  last_updated_at: string
  notes: string | null
  status: CeilingStatus
}

// Sort order: hardware (hardest to fix) → money → time (easiest)
const CATEGORY_SORT_ORDER: Record<string, number> = {
  hardware: 0,
  money: 1,
  time: 2,
}

// Traffic-light colors — Tailwind classes only (F20)
const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  hardware: 'rounded bg-red-900/60 px-1.5 py-0.5 text-xs font-semibold text-red-300',
  money: 'rounded bg-yellow-900/60 px-1.5 py-0.5 text-xs font-semibold text-yellow-300',
  time: 'rounded bg-green-900/60 px-1.5 py-0.5 text-xs font-semibold text-green-300',
}

function fmtValue(value: number | null, unit: string | null): string {
  if (value === null || value === undefined) return '—'
  const v = value.toLocaleString('en-CA')
  return unit ? `${v} ${unit}` : v
}

function fmtGainPct(pct: number | null): string {
  if (pct === null || pct === undefined) return '—'
  return `+${pct.toLocaleString('en-CA')}%`
}

function isStale(lastUpdatedAt: string): boolean {
  const updated = new Date(lastUpdatedAt)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return updated < thirtyDaysAgo
}

interface Props {
  rows: CeilingRow[]
}

export function CeilingTable({ rows }: Props) {
  const sorted = [...rows].sort(
    (a, b) =>
      (CATEGORY_SORT_ORDER[a.ceiling_cause_category] ?? 99) -
      (CATEGORY_SORT_ORDER[b.ceiling_cause_category] ?? 99)
  )

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center font-[var(--font-ui)] text-sm text-[var(--color-text-muted)]">
        No ceiling metrics found.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse font-[var(--font-mono)] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Module
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Metric
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Current
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Benchmark
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Ceiling
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Category
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Lift Cost
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-widest text-[var(--color-text-disabled)]">
              Gain %
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const stale = isStale(row.last_updated_at)
            const isLast = i === sorted.length - 1
            return (
              <tr
                key={row.id}
                className={isLast ? '' : 'border-b border-[var(--color-border)]'}
                title={row.ceiling_cause}
              >
                {/* Module */}
                <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                  {row.module}
                  {stale && (
                    <span
                      className="ml-1.5 text-yellow-400"
                      title={`Last updated ${new Date(row.last_updated_at).toLocaleDateString('en-CA')} — data may be stale`}
                    >
                      ⚠️
                    </span>
                  )}
                </td>

                {/* Metric */}
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                  {row.metric_name}
                  {row.metric_unit && (
                    <span className="ml-1 text-xs text-[var(--color-text-disabled)]">
                      ({row.metric_unit})
                    </span>
                  )}
                </td>

                {/* Current */}
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-primary)]">
                  {row.current_value === null ? (
                    <span className="text-[var(--color-text-disabled)]">—</span>
                  ) : (
                    row.current_value.toLocaleString('en-CA')
                  )}
                </td>

                {/* Benchmark */}
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {fmtValue(row.benchmark_value, null)}
                </td>

                {/* Ceiling */}
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {fmtValue(row.ceiling_value, null)}
                </td>

                {/* Category — traffic-light badge */}
                <td className="px-4 py-3">
                  <span className={CATEGORY_BADGE_CLASSES[row.ceiling_cause_category] ?? ''}>
                    {row.ceiling_cause_category}
                  </span>
                </td>

                {/* Lift Cost */}
                <td className="max-w-xs px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {row.ceiling_lift_cost ?? '—'}
                </td>

                {/* Gain % */}
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {fmtGainPct(row.ceiling_lift_gain_pct)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
