/**
 * /harness/drift — Window Scope Drift Tracker
 *
 * Shows how often parallel Claude Code windows touch files outside their
 * declared scope. Data source: agent_events WHERE action='scope_drift'.
 * Logged by scripts/window-scope-check.mjs on pre-commit hook block.
 *
 * F18: bench=0 scope_drift attempts per session (target: all sessions drift-free);
 *      surface=/harness/drift DriftChart
 * F20: No inline style={} — Tailwind + CSS vars only.
 */

// F18: bench=0 scope_drift events per session; surface=/harness/drift DriftChart

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DriftChart, type DailyCount, type DriftEvent } from './_components/DriftChart'

export const dynamic = 'force-dynamic'

export default async function DriftPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: events } = await service
    .from('agent_events')
    .select('occurred_at, actor, meta, input_summary')
    .eq('action', 'scope_drift')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(200)

  // Group by day (MDT)
  const byDay: Record<string, number> = {}
  const windowsWithDrift = new Set<string>()

  for (const e of events ?? []) {
    const day = new Date(e.occurred_at).toLocaleDateString('en-CA', {
      timeZone: 'America/Edmonton',
    })
    byDay[day] = (byDay[day] ?? 0) + 1
    if (e.actor) windowsWithDrift.add(e.actor)
  }

  const dailyCounts: DailyCount[] = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // Total distinct claude_code actors in window for drift-free count
  const { data: allActors } = await service
    .from('agent_events')
    .select('actor')
    .gte('occurred_at', since)
    .eq('domain', 'claude_code')
    .not('actor', 'is', null)

  const totalWindows = new Set((allActors ?? []).map((r) => r.actor).filter(Boolean)).size
  const driftWindows = windowsWithDrift.size
  const driftFreeWindows = Math.max(0, totalWindows - driftWindows)

  const recentEvents: DriftEvent[] = (events ?? []).slice(0, 50).map((e) => ({
    occurred_at: e.occurred_at as string,
    actor: e.actor as string | null,
    input_summary: e.input_summary as string | null,
    meta: e.meta as DriftEvent['meta'],
  }))

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />

      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
          Window Drift Tracker
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] font-[var(--font-ui)] tracking-wider text-[var(--color-text-muted)]">
          Scope violations caught by pre-commit hook · Last 30 days · Zero drift = safe to open more
          windows
        </p>
      </div>

      <DriftChart
        dailyCounts={dailyCounts}
        totalWindows={totalWindows}
        driftWindows={driftWindows}
        driftFreeWindows={driftFreeWindows}
        recentEvents={recentEvents}
      />
    </div>
  )
}
