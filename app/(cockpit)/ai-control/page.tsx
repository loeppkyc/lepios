// F17: governance observability — surfaces agent audit, config, session, and capability state for the behavioral engine
// F18: bench=0 stale harness_config keys, 0 orphan capabilities, <30s session beacon staleness; surface=/ai-control Config + Windows tabs

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { AIControlShell } from './_components/AIControlShell'

export const dynamic = 'force-dynamic'

const SENSITIVE_PATTERNS = /SECRET|TOKEN|KEY|PASSWORD|AUTH|CREDENTIAL/i

export default async function AIControlPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()

  const [auditResult, configResult, sessionsResult, capabilitiesResult] = await Promise.all([
    db
      .from('agent_events')
      .select(
        'id, occurred_at, domain, action, actor, status, input_summary, output_summary, error_message, duration_ms, tokens_used, model, cost_usd'
      )
      .order('occurred_at', { ascending: false })
      .limit(100),
    db.from('harness_config').select('key, value').order('key'),
    db
      .from('session_beacons')
      .select('branch, pid, hostname, started_at, last_heartbeat, tool_count, last_tool')
      .order('last_heartbeat', { ascending: false })
      .limit(30),
    db
      .from('capability_registry')
      .select('capability, domain, description, default_enforcement, destructive, created_at')
      .order('domain')
      .order('capability'),
  ])

  // Mask sensitive harness_config values
  const config = (configResult.data ?? []).map((row) => ({
    key: row.key as string,
    value: SENSITIVE_PATTERNS.test(row.key as string) ? '[redacted]' : (row.value as string),
  }))

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 font-[var(--font-ui)] text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          AI Control Center
        </h1>
        <p className="mt-1 font-[var(--font-ui)] text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Harness governance · Audit trail · Config · Active sessions · Capability registry
        </p>
      </div>

      <AIControlShell
        auditEvents={auditResult.data ?? []}
        config={config}
        sessions={sessionsResult.data ?? []}
        capabilities={capabilitiesResult.data ?? []}
      />
    </div>
  )
}
