import type { SupabaseClient } from '@supabase/supabase-js'
import type { CogsPerAsin, OrderCogsResult } from './types'

/**
 * Fetch cogs_per_asin_view for the given ASINs in a single query.
 * Called once per sync batch — never in a per-order loop.
 * Returns empty map on any DB failure so callers never crash.
 */
export async function lookupCogsByAsin(
  asins: string[],
  supabase: SupabaseClient
): Promise<Map<string, CogsPerAsin>> {
  if (asins.length === 0) return new Map()

  const { data, error } = await supabase
    .from('cogs_per_asin_view')
    .select(
      'asin, weighted_avg_unit_cost, latest_unit_cost, total_quantity_purchased, has_pallet_entries, entry_count'
    )
    .in('asin', asins)

  if (error || !data) return new Map()

  return new Map(data.map((row) => [row.asin as string, row as CogsPerAsin]))
}

/**
 * Compute cogs_cad and cogs_source for one order line item.
 * Pure function — no DB access. Call after lookupCogsByAsin.
 *
 * Rules (from Q3/Q4 design answers):
 *  - ASIN not in map → cogs_cad=0, cogs_source=null (no data)
 *  - ASIN has pallet entries only (no per_unit) → cogs_cad=0, cogs_source='pallet'
 *  - ASIN has per_unit entries → cogs_cad = weighted_avg * qty, cogs_source='per_unit'
 */
export function computeOrderCogs(
  asin: string,
  quantity: number,
  cogsMap: Map<string, CogsPerAsin>
): OrderCogsResult {
  const entry = cogsMap.get(asin)
  if (!entry) return { cogs_cad: 0, cogs_source: null }

  if (entry.weighted_avg_unit_cost == null) {
    // Pallet-only ASIN: cost tracked at pallet level, not per-unit
    return { cogs_cad: 0, cogs_source: 'pallet' }
  }

  return {
    cogs_cad: Math.round(entry.weighted_avg_unit_cost * quantity * 100) / 100,
    cogs_source: 'per_unit',
  }
}
