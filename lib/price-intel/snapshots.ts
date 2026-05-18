import { createClient } from '@/lib/supabase/server'

export interface SnapshotInput {
  asin: string
  domain?: number
  prices: {
    amazon?: number | null
    new?: number | null
    used?: number | null
    buybox?: number | null
    bsr?: number | null
  }
  source?: string
}

export interface SnapshotStats {
  avg30: number | null
  avg90: number | null
  min90: number | null
  max90: number | null
  avgBsr30: number | null
  avgBsr90: number | null
  count: number
}

/** Write price snapshot rows. Uses upsert with ignoreDuplicates (one per ASIN/type/day). */
export async function saveSnapshot(input: SnapshotInput): Promise<void> {
  const supabase = await createClient()
  const domain = input.domain ?? 6
  const source = input.source ?? 'keepa'

  const rows = Object.entries(input.prices)
    .filter(([, v]) => v != null && v > 0)
    .map(([price_type, value]) => ({
      asin: input.asin,
      domain,
      price_type,
      value,
      source,
    }))

  if (rows.length === 0) return

  // ON CONFLICT DO NOTHING via ignoreDuplicates — unique index on (asin, domain, price_type, snapped_at::date)
  await supabase
    .from('price_snapshots')
    .upsert(rows, { onConflict: 'asin,domain,price_type', ignoreDuplicates: true })
}

/** Compute rolling stats for an ASIN from stored snapshots. */
export async function getSnapshotStats(
  asin: string,
  domain = 6
): Promise<SnapshotStats> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('price_snapshots')
    .select('price_type, value, snapped_at')
    .eq('asin', asin)
    .eq('domain', domain)
    .gte('snapped_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order('snapped_at', { ascending: false })

  if (!data || data.length === 0) {
    return { avg30: null, avg90: null, min90: null, max90: null, avgBsr30: null, avgBsr90: null, count: 0 }
  }

  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const priceTypes = ['amazon', 'new', 'used', 'buybox']

  const prices90 = data
    .filter(r => priceTypes.includes(r.price_type) && r.value)
    .map(r => Number(r.value))
  const prices30 = data
    .filter(r => priceTypes.includes(r.price_type) && r.value && new Date(r.snapped_at) >= cutoff30)
    .map(r => Number(r.value))
  const bsr90 = data
    .filter(r => r.price_type === 'bsr' && r.value)
    .map(r => Number(r.value))
  const bsr30 = data
    .filter(r => r.price_type === 'bsr' && r.value && new Date(r.snapped_at) >= cutoff30)
    .map(r => Number(r.value))

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null

  return {
    avg30: avg(prices30),
    avg90: avg(prices90),
    min90: prices90.length ? Math.min(...prices90) : null,
    max90: prices90.length ? Math.max(...prices90) : null,
    avgBsr30: avg(bsr30),
    avgBsr90: avg(bsr90),
    count: data.length,
  }
}

/** True when we have enough history to score deals without Keepa stats. */
export function hasEnoughHistory(count: number, minDays = 14): boolean {
  return count >= minDays
}
