// F17: Automations page — no direct behavioral signal (UI-only config manager).
// F18: bench=run_count_per_automation; surface=AutomationsClient run counts.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { AutomationsClient } from './_components/AutomationsClient'

export const dynamic = 'force-dynamic'

export default async function AutomationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: automations } = await supabase
    .from('automations')
    .select('*')
    .order('created_at', { ascending: false })

  await logEvent('automations', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Automations
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Scheduled and event-driven automations · Telegram · Webhooks · API calls
        </p>
      </div>
      <AutomationsClient initialAutomations={automations ?? []} />
    </div>
  )
}
