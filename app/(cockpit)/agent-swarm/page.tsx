// F18: bench=tasks_completed_per_day; surface=AgentSwarmClient stats cards.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'
import { AgentSwarmClient } from './_components/AgentSwarmClient'

export const dynamic = 'force-dynamic'

export default async function AgentSwarmPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  // eslint-disable-next-line react-hooks/purity -- server component, not a hook
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [eventsResult, activeTasksResult, completedTodayResult] = await Promise.all([
    service
      .from('agent_events')
      .select(
        'id, domain, action, actor, status, created_at, input_summary, output_summary, error_message'
      )
      .order('created_at', { ascending: false })
      .limit(20),
    service
      .from('task_queue')
      .select('id, title, status, priority, claimed_by, created_at')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false }),
    service
      .from('task_queue')
      .select('id')
      .eq('status', 'completed')
      .gte('updated_at', todayStart.toISOString()),
  ])

  const recentEvents = eventsResult.data ?? []
  const activeTasks = activeTasksResult.data ?? []
  const completedToday = completedTodayResult.data?.length ?? 0
  const eventsLastHour = recentEvents.filter((e) => e.created_at >= oneHourAgo).length

  await logEvent('agent-swarm', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Agent Swarm
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Live task queue · Agent events · Swarm activity feed
        </p>
      </div>
      <AgentSwarmClient
        recentEvents={recentEvents}
        activeTasks={activeTasks}
        completedToday={completedToday}
        eventsLastHour={eventsLastHour}
      />
    </div>
  )
}
