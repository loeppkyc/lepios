import { createServiceClient } from '@/lib/supabase/service'
import { searchFlippItems, mapMerchantToStore } from './flipp'
import { sendDailyBot } from '@/lib/telegram/daily-bot'
import { GROCERY_STORE_LABELS } from '@/lib/diet/types'
import type { GroceryStore } from '@/lib/diet/types'

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

  // ── Telegram: top 5 deals >20% off ───────────────────────────────────────────
  // Supabase JS doesn't support column-vs-column comparisons, so we fetch
  // all in-flyer products with both prices set and filter in memory.
  try {
    const { data: flyerDeals } = await supabase
      .from('grocery_products')
      .select('name, store, sale_price, regular_price')
      .eq('in_flyer', true)
      .not('sale_price', 'is', null)
      .not('regular_price', 'is', null)

    const filtered = (flyerDeals ?? [])
      .filter(
        (d) =>
          d.sale_price != null && d.regular_price != null && d.sale_price < d.regular_price * 0.8
      )
      .sort((a, b) => {
        const savA = (a.regular_price! - a.sale_price!) / a.regular_price!
        const savB = (b.regular_price! - b.sale_price!) / b.regular_price!
        return savB - savA
      })
      .slice(0, 5)

    if (filtered.length > 0) {
      const lines = filtered.map((d) => {
        const storeLabel = GROCERY_STORE_LABELS[d.store as GroceryStore] ?? d.store
        const pct = Math.round(((d.regular_price! - d.sale_price!) / d.regular_price!) * 100)
        return `• ${d.name}: $${d.sale_price!.toFixed(2)} (was $${d.regular_price!.toFixed(2)}, ${pct}% off) @ ${storeLabel}`
      })
      const msg = `Flipp deals this week:\n${lines.join('\n')}`
      await sendDailyBot(msg)
    }
  } catch (err) {
    console.error(
      '[flipp-sync] Telegram push failed:',
      err instanceof Error ? err.message : String(err)
    )
  }

  return {
    staples_checked: staples.length,
    products_upserted: productsUpserted,
    price_history_logged: priceHistoryLogged,
    not_found: notFound,
    errors,
    duration_ms: Date.now() - started,
  }
}
