/**
 * /api/keepa/tracking
 *
 * CRUD endpoints for Keepa server-side ASIN tracking.
 * Keepa tracks registered ASINs and alerts when price thresholds are hit,
 * so LepiOS doesn't need to poll Keepa continuously for those ASINs.
 *
 * GET    /api/keepa/tracking          — list all tracked ASINs
 * POST   /api/keepa/tracking          — add ASIN to tracking { asin, domain?, targetPriceCad? }
 * DELETE /api/keepa/tracking?asin=... — remove ASIN from tracking
 *
 * Auth: Supabase session required (same pattern as /api/keepa/alerts).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { addTracking, getTrackedAsins, removeTracking } from '@/lib/keepa/tracking'
import { keepaConfigured } from '@/lib/keepa/client'

export const dynamic = 'force-dynamic'

// ── GET — list all tracked ASINs ──────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  const { entries, tokensLeft } = await getTrackedAsins(6)
  return NextResponse.json({ entries, tokensLeft })
}

// ── POST — add tracking ───────────────────────────────────────────────────────
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  let body: { asin?: string; domain?: number; targetPriceCad?: number }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { asin, domain = 6, targetPriceCad } = body
  if (!asin || typeof asin !== 'string' || asin.trim().length === 0) {
    return NextResponse.json({ error: 'asin is required' }, { status: 400 })
  }

  const { ok, tokensLeft } = await addTracking(asin.trim().toUpperCase(), domain, targetPriceCad)
  if (!ok) {
    return NextResponse.json({ error: 'Keepa tracking add failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, asin: asin.trim().toUpperCase(), tokensLeft })
}

// ── DELETE — remove tracking ──────────────────────────────────────────────────
export async function DELETE(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const asin = url.searchParams.get('asin')
  const domainParam = url.searchParams.get('domain')
  const domain = domainParam ? parseInt(domainParam, 10) : 6

  if (!asin) {
    return NextResponse.json({ error: 'asin query parameter required' }, { status: 400 })
  }

  const { ok } = await removeTracking(asin.toUpperCase(), domain)
  if (!ok) {
    return NextResponse.json({ error: 'Keepa tracking remove failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, asin: asin.toUpperCase() })
}
