// F18: bench=cron_success_rate; surface=CommandCentreClient last-run badges.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'
import { CommandCentreClient } from './_components/CommandCentreClient'
import vercelConfig from '../../../vercel.json'

export const dynamic = 'force-dynamic'

function humanSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return cron
  const [minute, hour, , , dayOfWeek] = parts
  const h = parseInt(hour)
  const m = parseInt(minute)
  const hhmm = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`
  if (dayOfWeek === '*') return `Daily at ${hhmm}`
  if (dayOfWeek === '0') return `Sundays at ${hhmm}`
  if (dayOfWeek === '1') return `Mondays at ${hhmm}`
  if (dayOfWeek === '4') return `Thursdays at ${hhmm}`
  if (dayOfWeek === '1-5') return `Weekdays at ${hhmm}`
  return `${cron} (UTC)`
}

export default async function CommandCentrePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  // Get last known run time for each cron path from agent_events domain
  const cronPaths: string[] = (vercelConfig.crons ?? []).map(
    (c: { path: string; schedule: string }) => c.path
  )

  // Fetch last event per cron path (use action = path)
  const { data: lastEvents } = await service
    .from('agent_events')
    .select('action, status, created_at')
    .in('action', cronPaths)
    .order('created_at', { ascending: false })
    .limit(cronPaths.length * 3)

  // Build last-run map
  const lastRunMap: Record<string, { status: string | null; created_at: string }> = {}
  for (const e of lastEvents ?? []) {
    if (e.action && !lastRunMap[e.action]) {
      lastRunMap[e.action] = { status: e.status, created_at: e.created_at }
    }
  }

  const crons = (vercelConfig.crons ?? []).map((c: { path: string; schedule: string }) => ({
    path: c.path,
    schedule: c.schedule,
    humanSchedule: humanSchedule(c.schedule),
    lastRun: lastRunMap[c.path] ?? null,
  }))

  await logEvent('command-centre', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Command Centre
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Cron schedules · {crons.length} scheduled jobs · Last-run status
        </p>
      </div>
      <CommandCentreClient crons={crons} />
    </div>
  )
}
