/**
 * POST /api/lego/price-check
 *
 * Runs a Keepa price check for all lego_vault sets with valid 10-char ASINs.
 * Token guard: blocks if tokensLeft < 50 (F7 lesson — token exhaustion prevention).
 * After check: fires Telegram alerts via outbound_notifications for sets where
 *   current_amazon_price >= target_sell_price AND alert_sent = false.
 *
 * POST body variants:
 *   {} — full vault price check (main action)
 *   { action: 'fees', items: [{asin, price}] } — FBA fee batch lookup (for Analytics tab)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { keepaFetch, keepaConfigured } from '@/lib/keepa/client'
import { getTokenStatus } from '@/lib/keepa/tokens'
import { getFbaFees } from '@/lib/amazon/fees'
import { logEvent, logError } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

// Keepa token guard threshold (F7 lesson)
const MIN_KEEPA_TOKENS = 50

interface VaultSet {
  id: string
  set_number: string
  name: string
  asin: string
  target_sell_cad: number | null
  alert_sent: boolean
}

interface PriceCheckResult {
  asin: string
  set_number: string
  name: string
  price: number | null
  alert_triggered: boolean
  error: string | null
}

interface FeeItem {
  asin: string
  price: number
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parse body to determine action
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine for the main action
  }

  const bodyObj = (body ?? {}) as Record<string, unknown>

  // ── FBA fee batch lookup (used by Analytics tab) ──────────────────────────
  if (bodyObj.action === 'fees') {
    const items = (bodyObj.items ?? []) as FeeItem[]
    const fees: Array<{ asin: string; fee: number }> = []

    for (const item of items.slice(0, 20)) {
      // cap at 20 to avoid long-running calls
      if (!item.asin || !item.price) continue
      try {
        const fee = await getFbaFees(item.asin, item.price, { bookMode: false })
        fees.push({ asin: item.asin, fee })
      } catch {
        // skip — best effort
      }
    }

    return NextResponse.json({ fees })
  }

  // ── Full vault price check ─────────────────────────────────────────────────
  if (!keepaConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'KEEPA_API_KEY is not configured.' },
      { status: 503 }
    )
  }

  // 1. Token guard — check before any Keepa calls
  const tokenStatus = await getTokenStatus()
  if (!tokenStatus) {
    return NextResponse.json(
      { ok: false, error: 'Could not fetch Keepa token balance. Try again in a moment.' },
      { status: 502 }
    )
  }
  if (tokenStatus.tokensLeft < MIN_KEEPA_TOKENS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Keepa token balance too low to run price check (${tokenStatus.tokensLeft} left, minimum ${MIN_KEEPA_TOKENS}). Tokens refill at ${tokenStatus.refillRate}/min.`,
      },
      { status: 429 }
    )
  }

  // 2. Load vault sets with valid ASINs
  const { data: rawSets, error: fetchErr } = await supabase
    .from('lego_vault')
    .select('id, set_number, name, asin, target_sell_cad, alert_sent')

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  const allSets = (rawSets ?? []) as VaultSet[]
  const setsWithAsin = allSets.filter((s) => s.asin && s.asin.length === 10)

  if (setsWithAsin.length === 0) {
    return NextResponse.json({
      ok: true,
      setsChecked: 0,
      alertsFired: 0,
      tokensUsed: 0,
      tokensLeft: tokenStatus.tokensLeft,
      results: [],
    })
  }

  const startTime = Date.now()
  const results: PriceCheckResult[] = []
  let tokensUsed = 0
  let alertsFired = 0
  let tokensLeft = tokenStatus.tokensLeft

  // 3. Call Keepa for each ASIN (domain=6 = Amazon.ca)
  for (const set of setsWithAsin) {
    // Re-check token budget before each call
    if (tokensLeft < MIN_KEEPA_TOKENS) {
      results.push({
        asin: set.asin,
        set_number: set.set_number,
        name: set.name,
        price: null,
        alert_triggered: false,
        error: 'Stopped: token balance too low to continue.',
      })
      continue
    }

    const { product, tokensLeft: remaining } = await keepaFetch(set.asin, 6)

    if (remaining != null) {
      tokensUsed += tokensLeft - remaining
      tokensLeft = remaining
    }

    if (!product) {
      results.push({
        asin: set.asin,
        set_number: set.set_number,
        name: set.name,
        price: null,
        alert_triggered: false,
        error: 'No data returned from Keepa.',
      })
      continue
    }

    // Extract current buy-box price from Keepa stats.current
    // Keepa prices are in cents * 100 (multiply by 0.01 to get CAD)
    // stats.current array: index 0 = Amazon, index 1 = Marketplace New, etc.
    const currentRaw = product.stats?.current
    let priceCad: number | null = null
    if (Array.isArray(currentRaw)) {
      // Try Amazon price (index 0) first, then marketplace new (index 1)
      for (const idx of [0, 1, 2]) {
        const raw = currentRaw[idx]
        if (typeof raw === 'number' && raw > 0) {
          priceCad = Math.round((raw / 100) * 100) / 100
          break
        }
      }
    }

    // 4. Update Supabase with current price
    const updateData: Record<string, unknown> = {
      last_price_check: new Date().toISOString(),
    }
    if (priceCad != null) {
      updateData.current_amazon_cad = priceCad
    }

    await supabase.from('lego_vault').update(updateData).eq('id', set.id)

    // Also insert price history row
    if (priceCad != null) {
      await supabase.from('lego_price_history').insert({
        vault_id: set.id,
        price_cad: priceCad,
        checked_at: new Date().toISOString().slice(0, 10),
      })
    }

    // 5. Alert logic: price >= target AND alert not yet sent
    let alertTriggered = false
    if (
      priceCad != null &&
      set.target_sell_cad != null &&
      set.target_sell_cad > 0 &&
      priceCad >= set.target_sell_cad &&
      !set.alert_sent
    ) {
      const text =
        `Lego price alert! Set ${set.set_number} (${set.name || 'no name'}) ` +
        `is now $${priceCad.toFixed(2)} CAD on Amazon.ca. ` +
        `Your target was $${set.target_sell_cad.toFixed(2)}.`

      await supabase.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text },
        correlation_id: `lego_alert_${set.id}_${Date.now()}`,
      })

      await supabase.from('lego_vault').update({ alert_sent: true }).eq('id', set.id)

      alertTriggered = true
      alertsFired++
    }

    results.push({
      asin: set.asin,
      set_number: set.set_number,
      name: set.name,
      price: priceCad,
      alert_triggered: alertTriggered,
      error: null,
    })
  }

  const durationMs = Date.now() - startTime

  // F18 observability
  void logEvent('lego', 'price_check', {
    actor: 'user',
    status: 'success',
    outputSummary: `Checked ${results.length} sets, fired ${alertsFired} alerts, ${tokensUsed} tokens used`,
    durationMs,
  })

  return NextResponse.json({
    ok: true,
    setsChecked: results.length,
    alertsFired,
    tokensUsed,
    tokensLeft,
    results,
  })
}

export async function GET() {
  // Trigger notifications drain for fired alerts
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('lego_vault')
    .select('id, set_number, name, asin, paid_cad, target_sell_cad, current_amazon_cad, alert_sent')
    .order('date_added', { ascending: false })

  if (error) {
    void logError('lego', 'vault.get', new Error(error.message), { actor: 'user' })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
