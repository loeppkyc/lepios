// F18: capture=agent_events (notif_dismissed, notif_all_clear events); bench=0 unread alerts = healthy baseline; surface=/notifications badge count + morning_digest "N notifications active"

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotificationsShell } from './_components/NotificationsShell'

export const dynamic = 'force-dynamic'

async function fetchSignals() {
  const supabase = await createClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  const [receiptsRes, betsRes, failuresRes, templatesRes, expensesRes] = await Promise.all([
    supabase
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .or('match_status.is.null,match_status.not.in.(matched,confirmed)'),
    supabase.from('bets').select('id', { count: 'exact', head: true }).eq('result', 'Pending'),
    supabase
      .from('failures_log')
      .select('id, failure_number, title, severity, status')
      .in('status', ['open', 'fixing', 'recurring'])
      .order('severity', { ascending: false })
      .limit(10),
    supabase
      .from('recurring_expense_templates')
      .select('vendor, frequency')
      .eq('active', true)
      .eq('frequency', 'monthly'),
    supabase
      .from('business_expenses')
      .select('vendor')
      .gte('date', monthStart)
      .lte('date', monthEnd),
  ])

  const loggedVendors = new Set(
    (expensesRes.data ?? []).map((e: { vendor: string }) => e.vendor?.toLowerCase())
  )
  const billsDue = (templatesRes.data ?? []).filter(
    (t: { vendor: string; frequency: string }) => !loggedVendors.has(t.vendor?.toLowerCase())
  ).length

  return {
    unmatchedReceipts: receiptsRes.count ?? 0,
    pendingBets: betsRes.count ?? 0,
    billsDue,
    openFailures: failuresRes.data?.length ?? 0,
    openFailuresList: (failuresRes.data ?? []) as {
      id: string
      failure_number: string
      title: string
      severity: string
      status: string
    }[],
  }
}

export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const signals = await fetchSignals()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-base)', padding: '24px' }}>
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Notifications
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          Live alerts from receipts, bets, expenses, and failures
        </p>
      </div>
      <NotificationsShell signals={signals} />
    </div>
  )
}
