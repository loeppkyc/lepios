/**
 * /harness/ceiling — F18 Ceiling Metric Dashboard
 *
 * Server component. Fetches module_ceiling_metrics via service client,
 * computes status at read time, renders CeilingTable.
 *
 * F18 surfacing path: Colin navigates here to see "module name, current value,
 * benchmark, ceiling, category (traffic-light), lift cost, estimated gain."
 * F20: No inline style={} — Tailwind classes only.
 *
 * chunk: f18-ceiling  task_id: e1d3c848-ce4f-4d9d-a4f2-1f8eb6585d5c
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CeilingTable, type CeilingRow } from './_components/CeilingTable'

export const dynamic = 'force-dynamic'

// Status computation mirrors app/api/metrics/ceiling/route.ts
type CeilingStatus = 'at_ceiling' | 'below_benchmark' | 'ok' | 'no_data'

function computeStatus(
  current: number | null,
  benchmark: number | null,
  ceiling: number | null
): CeilingStatus {
  if (current === null || current === undefined) return 'no_data'
  if (ceiling !== null && ceiling !== undefined && current >= ceiling * 0.95) return 'at_ceiling'
  if (benchmark !== null && benchmark !== undefined && current < benchmark) return 'below_benchmark'
  return 'ok'
}

export default async function CeilingPage() {
  // Auth gate — session required
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Service client bypasses RLS to read the locked table
  const service = createServiceClient()

  const { data, error } = await service
    .from('module_ceiling_metrics')
    .select(
      'id, module, metric_name, metric_unit, current_value, benchmark_value, ceiling_value, ceiling_cause, ceiling_cause_category, ceiling_lift_cost, ceiling_lift_gain_pct, benchmark_source, last_updated_at, notes, created_at'
    )
    .order('created_at', { ascending: true })

  const rows: CeilingRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    module: row.module as string,
    metric_name: row.metric_name as string,
    metric_unit: row.metric_unit as string | null,
    current_value: row.current_value as number | null,
    benchmark_value: row.benchmark_value as number | null,
    ceiling_value: row.ceiling_value as number | null,
    ceiling_cause: row.ceiling_cause as string,
    ceiling_cause_category: row.ceiling_cause_category as 'money' | 'hardware' | 'time',
    ceiling_lift_cost: row.ceiling_lift_cost as string | null,
    ceiling_lift_gain_pct: row.ceiling_lift_gain_pct as number | null,
    benchmark_source: row.benchmark_source as 'colin-target' | 'industry' | 'known-good' | null,
    last_updated_at: row.last_updated_at as string,
    notes: row.notes as string | null,
    status: computeStatus(
      row.current_value as number | null,
      row.benchmark_value as number | null,
      row.ceiling_value as number | null
    ),
  }))

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      {/* Cockpit top rail */}
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />

      {/* Page header */}
      <div className="mb-6">
        <h1 className="m-0 font-[var(--font-ui)] text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Ceiling Metrics
        </h1>
        <p className="mt-1 font-[var(--font-ui)] text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          F18 — module ceilings, benchmarks, and lift costs · Sorted hardware → money → time
        </p>
      </div>

      {/* Fetch error surface */}
      {error && (
        <div className="mb-6 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5 font-[var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-critical)]">
          Failed to load ceiling metrics: {error.message}
        </div>
      )}

      {/* Ceiling table */}
      <CeilingTable rows={rows} />
    </div>
  )
}
