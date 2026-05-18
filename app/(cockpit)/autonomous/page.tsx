// F18: bench=harness_autonomy_pct; surface=AutonomousClient halted/running status.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'
import { AutonomousClient } from './_components/AutonomousClient'

export const dynamic = 'force-dynamic'

export default async function AutonomousPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  const [configResult, tasksResult, eventsResult] = await Promise.all([
    service
      .from('harness_config')
      .select('key, value')
      .in('key', ['HARNESS_HALTED', 'HARNESS_REMOTE_INVOCATION_ENABLED', 'CRON_SECRET'])
      .order('key'),
    service
      .from('task_queue')
      .select('id, title, status, priority, claimed_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(50),
    service
      .from('agent_events')
      .select('id, domain, action, actor, status, created_at, output_summary, error_message')
      .eq('actor', 'coordinator')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const config = Object.fromEntries((configResult.data ?? []).map((r) => [r.key, r.value]))

  const tasks = tasksResult.data ?? []
  const statusCounts = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  }

  await logEvent('autonomous', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Autonomous Harness
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Harness status · Task queue · Coordinator timeline
        </p>
      </div>
      <AutonomousClient
        harnessHalted={config['HARNESS_HALTED'] === 'true'}
        remoteInvocationEnabled={config['HARNESS_REMOTE_INVOCATION_ENABLED'] === 'true'}
        tasks={tasks}
        statusCounts={statusCounts}
        coordinatorEvents={eventsResult.data ?? []}
      />
    </div>
  )
}
