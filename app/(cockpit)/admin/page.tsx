// F18: bench=harness_task_completion_rate; surface=AdminClient stats cards.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'
import { AdminClient } from './_components/AdminClient'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  const [configResult, tasksAllResult, tasksCompletedResult, eventsResult] = await Promise.all([
    service.from('harness_config').select('key, value').order('key'),
    service.from('task_queue').select('id', { count: 'exact', head: true }),
    service
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed'),
    service
      .from('agent_events')
      .select('id, domain, action, actor, status, created_at, error_message')
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  await logEvent('admin', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Admin
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          System configuration · Task queue stats · Recent agent events
        </p>
      </div>
      <AdminClient
        configRows={configResult.data ?? []}
        tasksTotal={tasksAllResult.count ?? 0}
        tasksCompleted={tasksCompletedResult.count ?? 0}
        recentEvents={eventsResult.data ?? []}
      />
    </div>
  )
}
