import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MoneyHeroTiles } from './_components/MoneyHeroTiles'
import { AccountsList } from './_components/AccountsList'
import { AmazonSummaryTile } from './_components/AmazonSummaryTile'
import { ConnectionsHealth } from './_components/ConnectionsHealth'

export const dynamic = 'force-dynamic'

export default async function PositionPage() {
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
          Position
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
          Cash · Debt · Payouts · Connection health — live from QuickBooks
        </p>
      </div>

      {/* Hero: Cash / Debt / Net */}
      <MoneyHeroTiles />

      {/* Amazon payouts summary */}
      <div style={{ marginTop: 24 }}>
        <AmazonSummaryTile />
      </div>

      {/* Account details + connections health */}
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <AccountsList />
        <ConnectionsHealth />
      </div>
    </div>
  )
}
