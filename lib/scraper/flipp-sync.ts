import { createServiceClient } from '@/lib/supabase/service'
import { searchFlippItems, mapMerchantToStore } from './flipp'

export interface FlippSyncResult {
  staples_checked: number
  products_upserted: number
  price_history_logged: number
  not_found: number
  errors: number
  duration_ms: number
}

export async function runFlippSync(): Promise<FlippSyncResult> {
  const supabase = createServiceClient()
  const started = Date.now()
  const now = new Date().toISOString()

  const { data: staples, error: staplesErr } = await supabase
    .from('food_catalog')
    .select('id, name, brand')
    .eq('is_household_staple', true)

  if (staplesErr || !staples) {
    throw new Error(`Failed to fetch staples: ${staplesErr?.message}`)
  }

  // Reset all flyer flags before this run so stale deals from the prior week are cleared
  await supabase.from('grocery_products').update({ in_flyer: false }).eq('in_flyer', true)

  let productsUpserted = 0
  let priceHistoryLogged = 0
  let notFound = 0
  let errors = 0

  for (const staple of staples) {
    try {
      const query = [staple.name, staple.brand].filter(Boolean).join(' ')
      const items = await searchFlippItems(query)

      // Group by merchant, keep the highest-scored match per store
      const byMerchant = new Map<string, (typeof items)[0]>()
      for (const item of items) {
        const existing = byMerchant.get(item.merchant_name)
        if (!existing || item.score > existing.score) {
          byMerchant.set(item.merchant_name, item)
        }
      }

      let foundAny = false

      for (const [merchantName, item] of byMerchant) {
        const store = mapMerchantToStore(merchantName)
        if (!store || item.current_price == null) continue

        foundAny = true

        const { data: upserted, error: upsertErr } = await supabase
          .from('grocery_products')
          .upsert(
            {
              food_catalog_id: staple.id,
              name: item.name,
              store,
              store_sku: String(item.flyer_item_id),
              regular_price: item.original_price ?? null,
              sale_price: item.current_price,
              in_flyer: true,
              last_scraped_at: now,
              is_active: true,
            },
            { onConflict: 'food_catalog_id,store' }
          )
          .select('id')
          .single()

        if (upsertErr || !upserted) {
          errors++
          continue
        }

        productsUpserted++

        const { error: histErr } = await supabase.from('grocery_price_history').insert({
          grocery_product_id: upserted.id,
          price: item.current_price,
          is_sale: true,
          scraped_at: now,
        })
        if (!histErr) priceHistoryLogged++
      }

      if (!foundAny) notFound++
    } catch {
      errors++
    }

    // 300ms between Flipp requests — respectful without hitting timeouts
    await new Promise((r) => setTimeout(r, 300))
  }

  await supabase.from('agent_events').insert({
    domain: 'grocery',
    action: 'flipp-sync',
    actor: 'system',
    status: errors > 0 ? 'warning' : 'success',
    duration_ms: Date.now() - started,
    output_summary: `${productsUpserted} products upserted, ${notFound} not in Edmonton flyers, ${errors} errors`,
    meta: {
      staples_checked: staples.length,
      products_upserted: productsUpserted,
      price_history_logged: priceHistoryLogged,
      not_found: notFound,
      errors,
    },
  })

  return {
    staples_checked: staples.length,
    products_upserted: productsUpserted,
    price_history_logged: priceHistoryLogged,
    not_found: notFound,
    errors,
    duration_ms: Date.now() - started,
  }
}
