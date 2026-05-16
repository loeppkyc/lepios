import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PoaDrafter } from './_components/PoaDrafter'

// F17: Suspension notice → high-stress seller signal. Draft sessions feed amazon_legal domain
//      in agent_events (suspension_type, response time, draft acceptance rate).
// F18: bench=Claude API P95 < 8000ms; surface=agent_events.duration_ms; unit=ms

export const dynamic = 'force-dynamic'

export default async function AmazonLegalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-base)', padding: '24px' }}>
      {/* Cockpit top rail */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      {/* Page header */}
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
          Amazon Seller Legal
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
          Plan of Action drafter · Not legal advice · You submit manually
        </p>
      </div>

      <PoaDrafter />
    </div>
  )
}
