/**
 * POST /api/admin/lego-catalog/harvest
 *
 * Looks up Amazon.ca ASINs for LEGO set numbers via the Keepa search API,
 * then upserts results into lego_asin_catalog.
 *
 * Auth: session user required (admin-only action — no cron-secret needed).
 * Body: { set_numbers: string[] }
 *
 * Token guard: returns 503 when KEEPA_API_KEY is not configured.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { keepaConfigured } from '@/lib/keepa/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Keepa search response shape (subset)
interface KeepaSearchProduct {
  asin?: string
  title?: string
  stats?: {
    current?: number[]
  }
}

interface KeepaSearchResponse {
  products?: KeepaSearchProduct[]
  tokensLeft?: number
  error?: number
}

interface HarvestResult {
  set_number: string
  asin: string | null
  name: string | null
  price_cad: number | null
  status: 'found' | 'not_found' | 'error'
  error?: string
}

async function keepaSearch(setNumber: string): Promise<KeepaSearchProduct | null> {
  const key = process.env.KEEPA_API_KEY ?? ''
  if (!key) return null

  const url = new URL('https://api.keepa.com/search')
  url.searchParams.set('key', key)
  url.searchParams.set('domain', '6') // Amazon.ca
  url.searchParams.set('type', 'product')
  url.searchParams.set('term', `LEGO ${setNumber}`)
  url.searchParams.set('page', '0')

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch (e) {
    console.error(`[lego-harvest] network error searching ${setNumber}:`, e)
    return null
  }

  if (!res.ok) {
    console.error(`[lego-harvest] Keepa search HTTP ${res.status} for set ${setNumber}`)
    return null
  }

  let data: KeepaSearchResponse
  try {
    data = (await res.json()) as KeepaSearchResponse
  } catch {
    return null
  }

  if (!data.products || data.products.length === 0) return null

  // Pick the product whose title contains the set number
  const match = data.products.find((p) => p.title && p.title.includes(setNumber))
  return match ?? data.products[0] ?? null
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── Auth: require valid session ────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Keepa guard ────────────────────────────────────────────────────────────
  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'Keepa not configured' }, { status: 503 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { set_numbers?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.set_numbers) || body.set_numbers.length === 0) {
    return NextResponse.json(
      { error: 'set_numbers must be a non-empty array of strings' },
      { status: 400 }
    )
  }

  const setNumbers = (body.set_numbers as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())

  if (setNumbers.length === 0) {
    return NextResponse.json(
      { error: 'set_numbers must contain at least one valid string' },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const results: HarvestResult[] = []

  for (const setNumber of setNumbers) {
    try {
      const product = await keepaSearch(setNumber)

      if (!product || !product.asin) {
        results.push({
          set_number: setNumber,
          asin: null,
          name: null,
          price_cad: null,
          status: 'not_found',
        })
        continue
      }

      // Extract current price from stats.current[0] (Amazon price, Keepa units ÷ 100 = CAD)
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

      const name = product.title ?? `LEGO Set ${setNumber}`
      const asin = product.asin

      // Upsert into lego_asin_catalog
      const { error: upsertErr } = await db.from('lego_asin_catalog').upsert(
        {
          set_number: setNumber,
          asin,
          name,
          last_price_cad: priceCad,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'set_number' }
      )

      if (upsertErr) {
        results.push({
          set_number: setNumber,
          asin,
          name,
          price_cad: priceCad,
          status: 'error',
          error: upsertErr.message,
        })
        continue
      }

      results.push({ set_number: setNumber, asin, name, price_cad: priceCad, status: 'found' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      results.push({
        set_number: setNumber,
        asin: null,
        name: null,
        price_cad: null,
        status: 'error',
        error: msg,
      })
    }
  }

  return NextResponse.json({ results })
}
