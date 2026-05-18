/**
 * GET/POST /api/cron/lightning-deals
 *
 * Every-4-hour cron that fetches active lightning deals from Keepa (Amazon.ca),
 * deduplicates via the keepa_lightning_deals table, and fires Telegram alerts
 * for new deals that haven't been alerted yet.
 *
 * Steps:
 *   1. Auth guard (requireCronSecret — F22)
 *   2. Fetch from Keepa (getLightningDeals — ~50 tokens/call)
 *   3. Upsert each deal: ON CONFLICT (asin, domain) DO NOTHING
 *   4. Query the rows that are new (alerted=false, not yet ended)
 *   5. Fire Telegram alerts via outbound_notifications
 *   6. Mark alerted=true on sent rows
 *   7. Drain outbound_notifications
 *   8. F18 observability: log to agent_events
 *
 * Auth: requireCronSecret (F22).
 * maxDuration: 60s — Keepa call + Supabase writes should complete well under 30s.
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { getLightningDeals } from '@/lib/keepa/lightning'
import { keepaConfigured } from '@/lib/keepa/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauth = requireCronSecret(request)
  if (unauth) return unauth

  const db = createServiceClient()
  const started = Date.now()
  const now = new Date()

  // ── 0. Keepa guard ─────────────────────────────────────────────────────────
  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  // ── 1. Fetch lightning deals from Keepa ────────────────────────────────────
  const { deals, tokensLeft } = await getLightningDeals(6, 25, 100)

  if (tokensLeft != null && tokensLeft < 100) {
    console.warn(`[lightning-deals] Keepa tokens low: ${tokensLeft} remaining`)
  }

  let scanned = deals.length
  let alerted = 0

  if (scanned === 0) {
    await db.from('agent_events').insert({
      domain: 'keepa',
      action: 'lightning_deals_scan',
      actor: 'cron_lightning_deals',
      status: 'success',
      duration_ms: Date.now() - started,
      output_summary: 'scanned=0 alerted=0',
      meta: { scanned: 0, alerted: 0 },
    })
    return NextResponse.json({ ok: true, scanned: 0, alerted: 0 })
  }

  // ── 2. Upsert deals into keepa_lightning_deals ─────────────────────────────
  // ON CONFLICT (asin, domain) DO NOTHING — pure dedup
  const rows = deals.map((d) => ({
    asin: d.asin,
    domain: 6,
    title: d.title,
    deal_price: d.dealPrice,
    orig_price: d.origPrice,
    discount_pct: d.discountPct,
    deal_type: d.dealType,
    starts_at: d.startsAt?.toISOString() ?? null,
    ends_at: d.endsAt?.toISOString() ?? null,
    alerted: false,
    found_at: now.toISOString(),
  }))

  // Batch upsert — ignore conflicts (existing deals already alerted or in flight)
  const { error: upsertErr } = await db
    .from('keepa_lightning_deals')
    .upsert(rows, {
      onConflict: 'asin,domain',
      ignoreDuplicates: true,
    })

  if (upsertErr) {
    console.error('[lightning-deals] upsert error:', upsertErr.message)
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  // ── 3. Fetch newly inserted rows that need alerting ────────────────────────
  // Only rows: alerted=false AND (ends_at IS NULL OR ends_at > now)
  const { data: pendingRows, error: fetchErr } = await db
    .from('keepa_lightning_deals')
    .select('id, asin, title, deal_price, orig_price, discount_pct, deal_type, ends_at')
    .eq('alerted', false)
    .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
    .order('discount_pct', { ascending: false })

  if (fetchErr) {
    console.error('[lightning-deals] fetch pending error:', fetchErr.message)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const pending = pendingRows ?? []

  // Read brand allowlist from harness_config — empty value = no filter
  const { data: brandRow } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'LIGHTNING_BRAND_ALLOWLIST')
    .maybeSingle()

  const brandAllowlist: string[] = brandRow?.value
    ? (brandRow.value as string).split(',').map((b) => b.trim().toLowerCase()).filter(Boolean)
    : []

  const filtered =
    brandAllowlist.length > 0
      ? pending.filter((row) => {
          const t = ((row.title as string | null) ?? '').toLowerCase()
          return brandAllowlist.some((b) => t.includes(b))
        })
      : pending

  // ── 4. Fire Telegram alerts + mark alerted ─────────────────────────────────
  for (const row of filtered) {
    const dealPriceStr = row.deal_price != null ? `$${(row.deal_price as number).toFixed(2)}` : 'N/A'
    const origPriceStr = row.orig_price != null ? `$${(row.orig_price as number).toFixed(2)}` : 'N/A'
    const discountStr = row.discount_pct != null ? `${(row.discount_pct as number).toFixed(0)}%` : ''
    const endsAtStr =
      row.ends_at != null
        ? new Date(row.ends_at as string).toLocaleString('en-CA', {
            timeZone: 'America/Edmonton',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'No expiry'

    const titleLine = row.title ?? row.asin
    const typeLabel = row.deal_type === 'lightning' ? '⚡ Lightning Deal' : '⭐ Best Deal'

    const text = [
      `${typeLabel} — Amazon.ca`,
      `[${row.asin as string}] ${titleLine}`,
      `${dealPriceStr} → was ${origPriceStr}${discountStr ? ` (-${discountStr})` : ''}`,
      `Ends: ${endsAtStr}`,
      `https://www.amazon.ca/dp/${row.asin as string}`,
    ].join('\n')

    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text },
      status: 'pending',
      correlation_id: `lightning_deal_${row.asin as string}_${row.id as string}`,
    })

    // Mark alerted
    await db
      .from('keepa_lightning_deals')
      .update({ alerted: true })
      .eq('id', row.id)

    alerted++
  }

  // ── 5. Drain outbound_notifications ────────────────────────────────────────
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

  // ── 6. F18 observability ───────────────────────────────────────────────────
  await db.from('agent_events').insert({
    domain: 'keepa',
    action: 'lightning_deals_scan',
    actor: 'cron_lightning_deals',
    status: 'success',
    duration_ms: Date.now() - started,
    output_summary: `scanned=${scanned} alerted=${alerted} brand_filtered=${pending.length - filtered.length}`,
    meta: { scanned, alerted, brand_filtered: pending.length - filtered.length, tokensLeft },
  })

  return NextResponse.json({ ok: true, scanned, alerted })
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
