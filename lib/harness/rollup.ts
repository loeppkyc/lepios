/**
 * Harness rollup auto-compute.
 *
 * To update a component: one SQL statement, no code change needed.
 *   UPDATE harness_components
 *     SET completion_pct = 75, updated_at = NOW()
 *     WHERE id = 'harness:twin_ollama';
 *
 * To add a component:
 *   INSERT INTO harness_components (id, display_name, weight_pct, completion_pct)
 *   VALUES ('harness:new_thing', 'New thing', 5, 0);
 *   -- then adjust other weights so SUM(weight_pct) = 100
 *
 * Formula: rollup_pct = SUM(weight_pct × completion_pct / 100) / SUM(weight_pct) × 100
 */

import { createServiceClient } from '@/lib/supabase/service'

export interface HarnessComponent {
  id: string
  display_name: string
  weight_pct: number
  completion_pct: number
}

export interface HarnessRollup {
  rollup_pct: number
  components: HarnessComponent[]
  complete_count: number
  total_count: number
  points_remaining: number
  computed_at: string
}

export interface HarnessRollupOptions {
  /** Reserved for future tier-column filtering. Currently a no-op (no tier column). */
  tier?: 'T1' | 'T2' | 'T3' | 'T4'
}

// opts.tier reserved for future tier-column filtering; no-op until harness_components.tier exists.
export async function computeHarnessRollup(
  _opts?: HarnessRollupOptions,
): Promise<HarnessRollup | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('harness_components')
    .select('id, display_name, weight_pct, completion_pct')
    .order('weight_pct', { ascending: false })

  if (error || !data || data.length === 0) return null

  const components = data as HarnessComponent[]
  const totalWeight = components.reduce((s, c) => s + Number(c.weight_pct), 0)
  if (totalWeight === 0) return null

  const weightedSum = components.reduce(
    (s, c) => s + Number(c.weight_pct) * (Number(c.completion_pct) / 100),
    0
  )

  const rollup_pct = Math.round((weightedSum / totalWeight) * 1000) / 10
  const complete_count = components.filter((c) => Number(c.completion_pct) >= 100).length
  const total_count = components.length
  const points_remaining = Math.round((totalWeight - weightedSum) * 10) / 10

  return {
    rollup_pct,
    components,
    complete_count,
    total_count,
    points_remaining,
    computed_at: new Date().toISOString(),
  }
}

// ── F18: morning_digest summary line ─────────────────────────────────────────
// Never throws — returns "Harness rollup: unavailable" on any error.
// Logs harness_rollup_computed to agent_events for day-over-day delta tracking.

export async function buildHarnessRollupLine(): Promise<string> {
  try {
    const rollup = await computeHarnessRollup()
    if (!rollup) return 'Harness rollup: no harness_components rows'

    const { rollup_pct, complete_count, total_count } = rollup

    // Delta: look for yesterday's logged value (12h–48h ago to exclude today's run)
    const db = createServiceClient()
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString()
    const until = new Date(Date.now() - 12 * 3_600_000).toISOString()
    const { data: priorData } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'harness_rollup_computed')
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .order('occurred_at', { ascending: false })
      .limit(1)

    // F18: log this run's value (enables tomorrow's delta)
    await db.from('agent_events').insert({
      domain: 'harness',
      action: 'harness_rollup_computed',
      actor: 'morning_digest',
      status: 'success',
      meta: { rollup_pct, component_count: total_count },
    })

    const base = `Harness rollup: ${rollup_pct.toFixed(1)}% (${complete_count}/${total_count} components complete)`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priorPct = (priorData?.[0]?.meta as any)?.rollup_pct
    if (priorPct != null) {
      const delta = Math.round((rollup_pct - Number(priorPct)) * 10) / 10
      const sign = delta >= 0 ? '+' : ''
      return `${base} | Δ ${sign}${delta.toFixed(1)}% from yesterday`
    }

    return base
  } catch {
    return 'Harness rollup: unavailable'
  }
}
