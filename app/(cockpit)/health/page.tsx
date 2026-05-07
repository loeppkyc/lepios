import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchHealthBundle } from '@/lib/health/queries'
import { isPersonHandle, type PersonHandle } from '@/lib/health/types'
import { HealthShell } from './_components/HealthShell'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ p?: string; tab?: string }>
}

export default async function HealthPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const person: PersonHandle = isPersonHandle(params.p) ? params.p : 'colin'
  const initialTab = params.tab ?? 'dashboard'

  const bundle = await fetchHealthBundle(supabase, person)

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
          Family Health Records
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
          Vitals, symptoms, medications, doctor visits, workouts &amp; cycle tracking
        </p>
      </div>

      <HealthShell person={person} initialTab={initialTab} bundle={bundle} />
    </div>
  )
}
