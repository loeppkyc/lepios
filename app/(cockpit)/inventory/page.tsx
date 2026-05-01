import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchFbaInventoryDetailed } from '@/lib/amazon/inventory'
import { computeInventoryValue } from '@/lib/cogs/fifo'
import { InventoryTable } from './_components/InventoryTable'
import type { CogsEntryForFifo } from '@/lib/cogs/fifo'
import type { FbaInventoryItem } from '@/lib/amazon/inventory'

export const dynamic = 'force-dynamic'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function InventoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = todayIso()

  // Fetch FBA inventory — empty array on API error (graceful degradation)
  let fbaItems: FbaInventoryItem[] = []
  let fetchError: string | null = null
  try {
    fbaItems = (await fetchFbaInventoryDetailed()).filter((i) => i.fulfillable_quantity > 0)
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch FBA inventory.'
  }

  // Fetch cogs_entries for FIFO costing (per_unit only, all history for these ASINs)
  const fulfillableByAsin = new Map<string, number>(
    fbaItems.map((item) => [item.asin, item.fulfillable_quantity])
  )

  let cogsEntries: CogsEntryForFifo[] = []
  if (fbaItems.length > 0) {
    const asins = fbaItems.map((i) => i.asin)
    const service = createServiceClient()
    const { data } = await service
      .from('cogs_entries')
      .select('asin, unit_cost_cad, quantity, purchased_at')
      .in('asin', asins)
      .eq('pricing_model', 'per_unit')
      .not('unit_cost_cad', 'is', null)
      .order('purchased_at', { ascending: true })

    cogsEntries = (data ?? []) as {
      asin: string
      unit_cost_cad: number
      quantity: number
      purchased_at: string
    }[]
  }

  const fifo = computeInventoryValue(cogsEntries, fulfillableByAsin)

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
          Inventory
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
          Live FBA stock · FIFO inventory value · per-ASIN cost layers
        </p>
      </div>

      {fetchError && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            padding: '12px 16px',
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-critical)',
            }}
          >
            FBA inventory unavailable: {fetchError}
          </span>
        </div>
      )}

      <InventoryTable items={fbaItems} fifo={fifo} today={today} />
    </div>
  )
}
