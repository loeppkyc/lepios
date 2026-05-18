// F18: bench=error_rate_per_domain; surface=DebugClient status breakdown.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'
import { DebugClient } from './_components/DebugClient'

export const dynamic = 'force-dynamic'

export default async function DebugPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  const [eventsResult, tasksResult, configCountResult] = await Promise.all([
    service.from('agent_events').select('*').order('created_at', { ascending: false }).limit(50),
    service
      .from('task_queue')
      .select('id, title, status, priority, claimed_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(10),
    service.from('harness_config').select('key', { count: 'exact', head: true }),
  ])

  await logEvent('debug', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Debug
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Agent events · Task queue · JSON inspector · Config key count:{' '}
          {configCountResult.count ?? 0}
        </p>
      </div>
      <DebugClient events={eventsResult.data ?? []} tasks={tasksResult.data ?? []} />
    </div>
  )
}
