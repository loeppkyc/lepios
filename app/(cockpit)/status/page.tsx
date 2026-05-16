/**
 * /cockpit/status — Internal System Status Page
 *
 * Shows per-component uptime history using data already in `agent_events`
 * and `harness_config`. Statuspage.io but internal and zero-cost.
 *
 * Pattern: follows app/(cockpit)/harness/drift/page.tsx exactly.
 *   - Server-rendered (force-dynamic)
 *   - Auth check via createClient()
 *   - Data queries via createServiceClient()
 *   - Passes data to client components
 *
 * F17: Observability layer for behavioral engine reliability.
 * F18: Surface for per-component uptime % (see acceptance doc §F18 Metrics).
 * F20: No inline style={} — Tailwind + CSS vars only.
 */

// F18: bench=component uptime % (target 95%+ harness-cron, 90%+ twin, 99%+ sp-api); surface=/cockpit/status StatusGrid
// F20: NO inline style={} — Tailwind + CSS vars only

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAllComponentStatuses } from '@/lib/status/components'
import { StatusGrid } from './_components/StatusGrid'

export const dynamic = 'force-dynamic'

export default async function StatusPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const components = await fetchAllComponentStatuses()

  const now = new Date()
  const updatedAt = now.toLocaleString('en-CA', {
    timeZone: 'America/Edmonton',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />

      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-[var(--font-ui)] font-semibold text-[var(--color-text-primary)]">
          System Status
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] font-[var(--font-ui)] tracking-wider text-[var(--color-text-muted)]">
          Real-time component health · 90-day uptime history · Updated {updatedAt}
        </p>
      </div>

      <StatusGrid components={components} />
    </div>
  )
}
