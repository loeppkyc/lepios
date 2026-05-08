/**
 * /failures — Failures Log cockpit page (T-006 Phase 1c).
 *
 * Reads failures_log; renders the FailuresShell client component with the
 * sorted row list. Manual entry form + "promote to harness test" action
 * are inside the shell.
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

// F18: capture=failures_log table rows + agent_events 'failures_log.*' actions; bench=<5% recurrence rate over 30d (recurring / total fixed); surface=/failures cockpit + docs/claude-md/failures.md (auto-rendered) + morning_digest counts

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listFailures } from '@/lib/failures/list'
import { FailuresShell } from './_components/FailuresShell'

export const dynamic = 'force-dynamic'

export default async function FailuresPage(props: {
  searchParams: Promise<{ status?: string; severity?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sp = await props.searchParams
  const rows = await listFailures({ status: sp.status, severity: sp.severity })

  const counts = {
    open: rows.filter((r) => r.status === 'open' || r.status === 'fixing').length,
    recurring: rows.filter((r) => r.status === 'recurring').length,
    fixed: rows.filter((r) => r.status === 'fixed').length,
  }

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
          Failures Log
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
          Source of truth for failures. Auto-syncs to{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>docs/claude-md/failures.md</code>.
        </p>
      </div>

      <FailuresShell
        rows={rows}
        counts={counts}
        initialStatus={sp.status ?? 'all'}
        initialSeverity={sp.severity ?? 'all'}
      />
    </div>
  )
}
