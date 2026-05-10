// F18: capture=agent_events (gpu_day_check_run events) + docs/gpu-day-readiness.md weighted tracker (F23); bench=10/10 checks green on GPU Day; surface=gpu-day-readiness.md + /gpu-day pass/fail summary row

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GpuDayShell } from './_components/GpuDayShell'

export const dynamic = 'force-dynamic'

export default async function GpuDayPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const hasTunnelConfig = !!process.env.OLLAMA_TUNNEL_URL
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY

  const { count: memCount } = await supabase
    .from('knowledge')
    .select('id', { count: 'exact', head: true })

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
          GPU Day
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
          System activation dashboard — press when the GPU arrives
        </p>
      </div>
      <GpuDayShell
        hasTunnelConfig={hasTunnelConfig}
        hasAnthropicKey={hasAnthropicKey}
        memCount={memCount ?? 0}
      />
    </div>
  )
}
