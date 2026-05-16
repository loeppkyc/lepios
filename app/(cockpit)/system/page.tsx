// F18: capture=agent_events (domain='gpu', action='gpu.metrics' — written by local-ai-worker every 1 min); bench=RTX 3060 max safe temp 85°C, max VRAM 12288 MB; surface=/system gauges + history charts

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SystemShell } from './_components/SystemShell'

export const dynamic = 'force-dynamic'

export default async function SystemPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
          System
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
          GPU health, window activity, scope drift
        </p>
      </div>
      <SystemShell />
    </div>
  )
}
