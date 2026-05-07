import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { OuraDailyRow } from '@/lib/oura/sync'
import { OuraDashboard } from './_components/OuraDashboard'

export const dynamic = 'force-dynamic'

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-small)',
        color: 'var(--color-critical)',
      }}
    >
      Failed to load Oura data: {message}
    </div>
  )
}

export default async function OuraHealthPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Last 90 days — enough to see trend; tabular renders fine at this size.
  const now = new Date()
  const after = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('oura_daily')
    .select(
      'date, sleep_score, readiness_score, activity_score, total_sleep_hours, deep_sleep_min, rem_sleep_min, light_sleep_min, hrv, resting_hr, steps, synced_at'
    )
    .gte('date', after)
    .order('date', { ascending: false })

  const rows: OuraDailyRow[] = !error && data ? (data as OuraDailyRow[]) : []

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
          Oura Health
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
          Sleep, readiness, activity from the Oura Ring · last 90 days · nightly sync
        </p>
      </div>

      {error && <ErrorCard message={error.message} />}

      <OuraDashboard rows={rows} />
    </div>
  )
}
