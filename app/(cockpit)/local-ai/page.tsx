// F18: capture=agent_events (ollama_status_check events via /api/local-ai/status); bench=100% uptime on OLLAMA_TUNNEL_URL; surface=/local-ai status pill + morning_digest "Ollama: Online/Offline"

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LocalAIShell } from './_components/LocalAIShell'

export const dynamic = 'force-dynamic'

export default async function LocalAIPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { count: memCount } = await supabase
    .from('knowledge')
    .select('id', { count: 'exact', head: true })

  const hasTunnelConfig = !!process.env.OLLAMA_TUNNEL_URL

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
          Local AI
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
          Ollama status, models, and knowledge store
        </p>
      </div>
      <LocalAIShell memCount={memCount ?? 0} hasTunnelConfig={hasTunnelConfig} />
    </div>
  )
}
