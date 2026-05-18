/**
 * GET/POST /api/cron/keepa-price-scan
 *
 * Daily LEGO price alert cron (8 AM MDT = 14:00 UTC).
 * For every row in lego_asin_catalog with an ASIN, checks the current
 * Amazon.ca price via Keepa and fires a Telegram alert if the price
 * breaches the user's price_alert_rules thresholds.
 *
 * Alert conditions (either triggers):
 *   - price <= msrp_cad * (1 - drop_pct_threshold / 100)
 *   - price <= absolute_price_cap_cad (when set)
 *
 * Spam guard: only alerts if last_alerted_at is NULL or > 24 h ago.
 * Auth: requireCronSecret (F22).
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { keepaFetch, keepaConfigured } from '@/lib/keepa/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CatalogRow {
  set_number: string
  asin: string
  name: string
  msrp_cad: number | null
  last_price_cad: number | null
}

interface AlertRuleRow {
  id: string
  set_number: string
  drop_pct_threshold: number
  absolute_price_cap_cad: number | null
  last_alerted_at: string | null
}

export async function GET(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauth = requireCronSecret(request)
  if (unauth) return unauth

  const db = createServiceClient()
  const started = Date.now()

  // ── 0. Keepa guard ─────────────────────────────────────────────────────────
  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  // ── 1. Load catalog rows that have an ASIN ─────────────────────────────────
  const { data: catalogRows, error: catalogErr } = await db
    .from('lego_asin_catalog')
    .select('set_number, asin, name, msrp_cad, last_price_cad')
    .not('asin', 'is', null)
    .returns<CatalogRow[]>()

  if (catalogErr) {
    return NextResponse.json({ error: catalogErr.message }, { status: 500 })
  }

  const catalog = catalogRows ?? []
  if (catalog.length === 0) {
    return NextResponse.json({ scanned: 0, alerted: 0 })
  }

  // ── 2. Load active alert rules ─────────────────────────────────────────────
  const setNumbers = catalog.map((r) => r.set_number)
  const { data: ruleRows, error: rulesErr } = await db
    .from('price_alert_rules')
    .select('id, set_number, drop_pct_threshold, absolute_price_cap_cad, last_alerted_at')
    .in('set_number', setNumbers)
    .eq('is_active', true)
    .returns<AlertRuleRow[]>()

  if (rulesErr) {
    return NextResponse.json({ error: rulesErr.message }, { status: 500 })
  }

  // Build a map from set_number → rule for quick lookup
  const rulesBySet = new Map<string, AlertRuleRow>()
  for (const rule of ruleRows ?? []) {
    rulesBySet.set(rule.set_number, rule)
  }

  // ── 3. Scan prices and fire alerts ─────────────────────────────────────────
  let scanned = 0
  let alerted = 0
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  for (const entry of catalog) {
    // Only scan sets that have an active alert rule
    const rule = rulesBySet.get(entry.set_number)
    if (!rule) continue

    // Spam guard: skip if alerted in the last 24 hours
    if (rule.last_alerted_at) {
      const lastAlerted = new Date(rule.last_alerted_at)
      if (lastAlerted > twentyFourHoursAgo) continue
    }

    // Fetch current price from Keepa
    const { product, tokensLeft } = await keepaFetch(entry.asin, 6)
    scanned++

    if (!product) continue

    // Extract current price — Keepa units ÷ 100 = CAD
    const currentRaw = product.stats?.current
    let priceCad: number | null = null
    if (Array.isArray(currentRaw)) {
      for (const idx of [0, 1, 2]) {
        const raw = currentRaw[idx]
        if (typeof raw === 'number' && raw > 0) {
          priceCad = Math.round((raw / 100) * 100) / 100
          break
        }
      }
    }

    if (priceCad === null) continue

    // Update catalog with latest price
    await db
      .from('lego_asin_catalog')
      .update({
        last_price_cad: priceCad,
        last_checked_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('set_number', entry.set_number)

    // Check alert conditions
    const msrp = entry.msrp_cad
    const pctThreshold = rule.drop_pct_threshold
    const absCap = rule.absolute_price_cap_cad

    const pctTrigger = msrp != null && priceCad <= msrp * (1 - pctThreshold / 100)
    const absTrigger = absCap != null && priceCad <= absCap

    if (!pctTrigger && !absTrigger) continue

    // ── Fire Telegram alert ─────────────────────────────────────────────────
    const pctOff = msrp && msrp > 0 ? Math.round(((msrp - priceCad) / msrp) * 100) : null
    const msrpStr = msrp ? `$${msrp.toFixed(2)}` : 'MSRP unknown'
    const pctOffStr = pctOff != null ? `${pctOff}% off MSRP ${msrpStr}` : `vs MSRP ${msrpStr}`

    const text = [
      `🏷️ <b>LEGO Price Alert</b>`,
      `${entry.name} (#${entry.set_number})`,
      `Amazon.ca: <b>$${priceCad.toFixed(2)}</b> (${pctOffStr})`,
      `https://www.amazon.ca/dp/${entry.asin}`,
    ].join('\n')

    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text, parse_mode: 'HTML' },
      status: 'pending',
      correlation_id: `lego_price_alert_${entry.set_number}_${Date.now()}`,
    })

    // Mark rule as alerted
    await db
      .from('price_alert_rules')
      .update({ last_alerted_at: now.toISOString() })
      .eq('id', rule.id)

    alerted++

    // Log token balance warning if running low
    if (tokensLeft != null && tokensLeft < 100) {
      console.warn(`[keepa-price-scan] tokens low: ${tokensLeft} remaining`)
    }
  }

  // ── 4. Drain outbound_notifications if any alerts were fired ───────────────
  if (alerted > 0) {
    const secret = getCronSecret()
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
    try {
      await fetch(`${base}/api/harness/notifications-drain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      })
    } catch {
      // non-blocking — pg_cron drain will catch it
    }
  }

  // ── 5. F18 observability ───────────────────────────────────────────────────
  await db.from('agent_events').insert({
    domain: 'lego',
    action: 'keepa_price_scan',
    actor: 'cron_keepa_price_scan',
    status: 'success',
    duration_ms: Date.now() - started,
    output_summary: `scanned=${scanned} alerted=${alerted}`,
    meta: { scanned, alerted },
  })

  return NextResponse.json({ scanned, alerted })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
