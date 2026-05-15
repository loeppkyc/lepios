/**
 * GET /api/metrics/ceiling
 *
 * Returns all rows from module_ceiling_metrics with a computed `status` field.
 *
 * Auth: CRON_SECRET bearer OR authenticated Supabase session.
 * Uses service-role client so RLS-locked table is readable server-side.
 *
 * F22: dual-auth via hasValidCronSecret + session fallback (not cron-only).
 * chunk: f18-ceiling  task_id: e1d3c848-ce4f-4d9d-a4f2-1f8eb6585d5c
 */

import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronSecret } from '@/lib/auth/cron-secret'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Status values computed at read time — never stored.
type CeilingStatus = 'at_ceiling' | 'below_benchmark' | 'ok' | 'no_data'

/**
 * Compute status from current, benchmark, and ceiling values.
 *
 * - no_data   — current_value is NULL
 * - at_ceiling — current_value >= ceiling_value * 0.95 (within 5%)
 * - below_benchmark — current_value < benchmark_value
 * - ok        — current_value >= benchmark_value and below ceiling
 */
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth gate: CRON_SECRET bearer OR authenticated Supabase session
  if (!hasValidCronSecret(request)) {
    const sessionClient = await createClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Service client bypasses RLS to read the locked table
  const service = createServiceClient()

  const { data, error } = await service
    .from('module_ceiling_metrics')
    .select(
      'id, module, metric_name, metric_unit, current_value, benchmark_value, ceiling_value, ceiling_cause, ceiling_cause_category, ceiling_lift_cost, ceiling_lift_gain_pct, benchmark_source, last_updated_at, notes, created_at'
    )
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch ceiling metrics' }, { status: 500 })
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    status: computeStatus(
      row.current_value as number | null,
      row.benchmark_value as number | null,
      row.ceiling_value as number | null
    ),
  }))

  return NextResponse.json({ rows })
}
