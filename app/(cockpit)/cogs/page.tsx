import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CogsEntryForm } from './_components/CogsEntryForm'
import { CogsTable } from './_components/CogsTable'
import type { CogsEntry, CogsPerAsin } from '@/lib/cogs/types'

export const dynamic = 'force-dynamic'

export default async function CogsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  const { data: entries } = await service
    .from('cogs_entries')
    .select(
      'id, asin, pricing_model, unit_cost_cad, quantity, total_cost_cad, purchased_at, vendor, notes, source, created_at, created_by'
    )
    .order('purchased_at', { ascending: false })
    .limit(50)

  const { data: summary } = await service
    .from('cogs_per_asin_view')
    .select(
      'asin, weighted_avg_unit_cost, latest_unit_cost, total_quantity_purchased, has_pallet_entries, entry_count'
    )
    .order('asin')

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
          COGS
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
          Cost of goods sold · manual entries · per-unit and pallet
        </p>
      </div>

      {/* Entry form */}
      <CogsEntryForm />

      {/* Entries + per-ASIN summary */}
      <div style={{ marginTop: 24 }}>
        <CogsTable
          entries={(entries ?? []) as CogsEntry[]}
          summary={(summary ?? []) as CogsPerAsin[]}
        />
      </div>
    </div>
  )
}
