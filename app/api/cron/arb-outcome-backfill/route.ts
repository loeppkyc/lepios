import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Daily backfill: for arb_decisions rows older than 14 days with outcome IS NULL,
 * check amazon_listings for a matching ASIN.
 *
 * If listing found AND listed_at is within 14 days of decided_at AND
 * sp_api_status = 'ACCEPTED' → set outcome='sold_attempted'.
 * Else → set outcome='no_listing'.
 *
 * This is a best-effort signal. Full sold/unsold truth requires future SP-API orders enrichment.
 */
export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  return runBackfill()
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  return runBackfill()
}

async function runBackfill(): Promise<NextResponse> {
  const svc = createServiceClient()

  // Fetch arb_decisions rows older than 14 days with no outcome
  const { data: pending, error: fetchError } = await svc
    .from('arb_decisions')
    .select('id, asin, decided_at')
    .is('outcome', null)
    .lt('decided_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: 'No pending rows to backfill' })
  }

  // Dedupe ASINs so we only query amazon_listings once per ASIN
  const asins = [...new Set(pending.map((r) => r.asin))]

  const { data: listings, error: listingError } = await svc
    .from('amazon_listings')
    .select('asin, listed_at, sp_api_status')
    .in('asin', asins)

  if (listingError) {
    return NextResponse.json({ error: listingError.message }, { status: 500 })
  }

  // Build a map: asin → latest listing with ACCEPTED status
  const listingMap = new Map<string, { listed_at: string; sp_api_status: string }>()
  for (const listing of listings ?? []) {
    // If multiple listings for the same ASIN, keep the first ACCEPTED one found
    if (!listingMap.has(listing.asin) || listing.sp_api_status === 'ACCEPTED') {
      listingMap.set(listing.asin, {
        listed_at: listing.listed_at,
        sp_api_status: listing.sp_api_status,
      })
    }
  }

  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
  const now = new Date().toISOString()

  let updatedCount = 0

  // Process in batches to avoid large single UPDATE
  for (const row of pending) {
    const listing = listingMap.get(row.asin)
    let outcome: 'sold_attempted' | 'no_listing'

    if (listing && listing.sp_api_status === 'ACCEPTED') {
      const listedAt = new Date(listing.listed_at).getTime()
      const decidedAt = new Date(row.decided_at).getTime()
      const withinWindow = Math.abs(listedAt - decidedAt) <= FOURTEEN_DAYS_MS
      outcome = withinWindow ? 'sold_attempted' : 'no_listing'
    } else {
      outcome = 'no_listing'
    }

    const { error: updateError } = await svc
      .from('arb_decisions')
      .update({ outcome, outcome_checked_at: now })
      .eq('id', row.id)

    if (!updateError) {
      updatedCount++
    }
  }

  return NextResponse.json({ ok: true, updated: updatedCount, total_pending: pending.length })
}
