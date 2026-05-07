// Cost checks — quota forecast vs budget, API spend spike vs 7-day baseline.

import { createServiceClient } from '@/lib/supabase/service'
import { forecastQuotaBeforeStart } from '@/lib/harness/quota-forecast'
import { registerCheck } from '../registry'
import type { CheckResult } from '../types'

// ─── cost.quota_over_budget ───────────────────────────────────────────────────
// Distinct from health.quota_burn — that one is about cliff time. This one is
// about projected month-end spend.
registerCheck({
  key: 'cost.quota_over_budget',
  category: 'cost',
  defaultSeverity: 'high',
  label: 'Projected month-end token spend within budget',
  async run(): Promise<CheckResult> {
    try {
      const forecast = await forecastQuotaBeforeStart()
      const projected = forecast.projected_month_end_spend_usd
      const budget = forecast.month_budget_usd
      if (projected == null || budget == null) {
        return {
          key: 'cost.quota_over_budget',
          category: 'cost',
          status: 'skipped',
          evidence: {
            reason: 'forecast missing projected_month_end_spend_usd or month_budget_usd',
            forecast,
          },
        }
      }
      const ratio = projected / budget
      if (ratio > 1.0) {
        return {
          key: 'cost.quota_over_budget',
          category: 'cost',
          status: 'fail',
          severity: ratio > 1.25 ? 'critical' : 'high',
          evidence: { projected_usd: projected, budget_usd: budget, ratio },
        }
      }
      if (ratio > 0.85) {
        return {
          key: 'cost.quota_over_budget',
          category: 'cost',
          status: 'warn',
          severity: 'medium',
          evidence: { projected_usd: projected, budget_usd: budget, ratio },
        }
      }
      return {
        key: 'cost.quota_over_budget',
        category: 'cost',
        status: 'ok',
        evidence: { projected_usd: projected, budget_usd: budget, ratio },
      }
    } catch (err) {
      return {
        key: 'cost.quota_over_budget',
        category: 'cost',
        status: 'skipped',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})

// ─── cost.spend_spike ─────────────────────────────────────────────────────────
// Yesterday's API spend > 2σ vs 7-day baseline. Reads agent_events.cost_usd.
registerCheck({
  key: 'cost.spend_spike',
  category: 'cost',
  defaultSeverity: 'high',
  label: "Yesterday's API spend within 2σ of 7-day baseline",
  async run(): Promise<CheckResult> {
    const db = createServiceClient()
    try {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await db
        .from('agent_events')
        .select('cost_usd, occurred_at')
        .gte('occurred_at', eightDaysAgo)
        .not('cost_usd', 'is', null)
      if (error) {
        return {
          key: 'cost.spend_spike',
          category: 'cost',
          status: 'warn',
          severity: 'low',
          evidence: { error: error.message },
        }
      }
      // Bucket by yyyy-mm-dd (UTC).
      const buckets = new Map<string, number>()
      for (const row of (data ?? []) as Array<{ cost_usd: string; occurred_at: string }>) {
        const day = row.occurred_at.slice(0, 10)
        const usd = parseFloat(row.cost_usd)
        if (!Number.isFinite(usd)) continue
        buckets.set(day, (buckets.get(day) ?? 0) + usd)
      }
      // Order by date asc; last 7 = baseline, last = yesterday.
      const sorted = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))
      if (sorted.length < 4) {
        return {
          key: 'cost.spend_spike',
          category: 'cost',
          status: 'skipped',
          evidence: {
            reason: 'insufficient cost history (<4 days with cost_usd rows)',
            days_with_data: sorted.length,
          },
        }
      }
      const baseline = sorted.slice(0, -1)
      const [yesterdayDay, yesterdaySpend] = sorted[sorted.length - 1]
      const mean = baseline.reduce((s, [, v]) => s + v, 0) / baseline.length
      const variance =
        baseline.reduce((s, [, v]) => s + (v - mean) ** 2, 0) / Math.max(1, baseline.length - 1)
      const sigma = Math.sqrt(variance)
      const z = sigma === 0 ? 0 : (yesterdaySpend - mean) / sigma
      if (z > 5) {
        return {
          key: 'cost.spend_spike',
          category: 'cost',
          status: 'fail',
          severity: 'critical',
          evidence: {
            day: yesterdayDay,
            spend_usd: yesterdaySpend,
            baseline_mean: mean,
            sigma,
            z_score: z,
          },
        }
      }
      if (z > 2) {
        return {
          key: 'cost.spend_spike',
          category: 'cost',
          status: 'warn',
          severity: 'medium',
          evidence: {
            day: yesterdayDay,
            spend_usd: yesterdaySpend,
            baseline_mean: mean,
            sigma,
            z_score: z,
          },
        }
      }
      return {
        key: 'cost.spend_spike',
        category: 'cost',
        status: 'ok',
        evidence: {
          day: yesterdayDay,
          spend_usd: yesterdaySpend,
          baseline_mean: mean,
          sigma,
          z_score: z,
        },
      }
    } catch (err) {
      return {
        key: 'cost.spend_spike',
        category: 'cost',
        status: 'warn',
        severity: 'low',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})
