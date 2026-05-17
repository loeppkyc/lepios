import { createServiceClient } from '@/lib/supabase/service'
import { GROCERY_STORE_LABELS } from '@/lib/diet/types'
import type { GroceryStore } from '@/lib/diet/types'

/**
 * Build a single morning-digest line for the top 3 flyer deals.
 *
 * Returns '' (empty string) if no deals are found — the digest skips blank lines.
 * Never throws.
 */
export async function buildGroceryDealsLine(): Promise<string> {
  try {
    const supabase = createServiceClient()

    // Supabase JS doesn't support column-vs-column comparisons, so fetch all
    // in-flyer products with both prices and sort/filter in memory.
    const { data } = await supabase
      .from('grocery_products')
      .select('name, store, sale_price, regular_price, food_catalog(name, brand)')
      .eq('in_flyer', true)
      .not('sale_price', 'is', null)
      .not('regular_price', 'is', null)

    if (!data || data.length === 0) return ''

    const withSavings = data
      .filter((d) => d.sale_price != null && d.regular_price != null && d.regular_price > 0)
      .map((d) => ({
        ...d,
        savingsPct: (d.regular_price! - d.sale_price!) / d.regular_price!,
      }))
      .filter((d) => d.savingsPct > 0)
      .sort((a, b) => b.savingsPct - a.savingsPct)
      .slice(0, 3)

    if (withSavings.length === 0) return ''

    const parts = withSavings.map((d) => {
      // Use food_catalog name/brand when available, fall back to product name
      const fc = Array.isArray(d.food_catalog) ? d.food_catalog[0] : d.food_catalog
      const displayName = fc?.name ? [fc.name, fc.brand].filter(Boolean).join(' ') : d.name
      const storeLabel = GROCERY_STORE_LABELS[d.store as GroceryStore] ?? d.store
      const pct = Math.round(d.savingsPct * 100)
      return `${displayName} $${d.sale_price!.toFixed(2)} (${storeLabel}, ${pct}% off)`
    })

    return `Top flyer deals: ${parts.join(' · ')}`
  } catch {
    return ''
  }
}
