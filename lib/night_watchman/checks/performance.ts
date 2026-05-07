// Performance checks — p95 route latency (Vercel API), Supabase slow query log.
// Both placeholders in v2 — wiring to Vercel/Supabase analytics APIs is a v2.1 follow-up.

import { registerCheck } from '../registry'
import type { CheckResult } from '../types'

// ─── performance.route_latency_p95 ────────────────────────────────────────────
registerCheck({
  key: 'performance.route_latency_p95',
  category: 'performance',
  defaultSeverity: 'medium',
  label: 'p95 latency on hot routes within budget',
  async run(): Promise<CheckResult> {
    return {
      key: 'performance.route_latency_p95',
      category: 'performance',
      status: 'skipped',
      evidence: {
        reason:
          'Vercel Analytics API integration not yet built. Requires VERCEL_TOKEN + Insights endpoint. Logged for v2.1.',
      },
    }
  },
})

// ─── performance.slow_query_log ───────────────────────────────────────────────
registerCheck({
  key: 'performance.slow_query_log',
  category: 'performance',
  defaultSeverity: 'medium',
  label: 'No new Supabase slow-query log entries',
  async run(): Promise<CheckResult> {
    return {
      key: 'performance.slow_query_log',
      category: 'performance',
      status: 'skipped',
      evidence: {
        reason:
          'pg_stat_statements / Supabase logs API integration not yet built. Logged for v2.1.',
      },
    }
  },
})
