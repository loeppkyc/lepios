import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchPetBundle } from './_lib/queries'
import { PetHealthShell } from './_components/PetHealthShell'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function PetHealthPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const initialTab = params.tab ?? 'profiles'

  const bundle = await fetchPetBundle(supabase)

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-base)',
        padding: '24px',
      }}
    >
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
          Pet Health Centre
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
          Profiles, vet visits, vaccines, medications &amp; food safety
        </p>
      </div>

      <PetHealthShell initialTab={initialTab} bundle={bundle} />
    </div>
  )
}
