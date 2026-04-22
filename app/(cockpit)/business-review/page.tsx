import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TodayYesterdayPanel } from './_components/TodayYesterdayPanel'

export const dynamic = 'force-dynamic'

export default async function BusinessReviewPage() {
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
          Business Review
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
          Sprint 4 — confirmed orders only · Pending excluded from all numbers
        </p>
      </div>

      {/* Today + Yesterday panels — Chunk A */}
      <TodayYesterdayPanel />

      {/* Chunks B–E compose here in subsequent sprints */}
    </div>
  )
}
