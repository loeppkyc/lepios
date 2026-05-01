import { createClient } from '@/lib/supabase/server'

export class KeepaNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeepaNetworkError'
  }
}

export class KeepaHttpError extends Error {
  readonly status: number
  readonly asin: string
  constructor(status: number, asin: string) {
    super(`Keepa returned HTTP ${status} for ASIN ${asin}`)
    this.name = 'KeepaHttpError'
    this.status = status
    this.asin = asin
  }
}

export class KeepaParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeepaParseError'
  }
}

const KEEPA_BASE = 'https://api.keepa.com'
// Keepa timestamps are minutes since 2011-01-01T00:00:00Z
const KEEPA_EPOCH_MS = Date.UTC(2011, 0, 1)
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export interface BsrPoint {
  t: number // Unix epoch seconds
  rank: number
}

export interface BsrHistoryResult {
  asin: string
  points: BsrPoint[]
  fetchedAt: string
  fromCache: boolean
  tokensLeft: number | null
}

export function extractBsrPoints(rankRaw: number[]): BsrPoint[] {
  const cutoffMs = Date.now() - NINETY_DAYS_MS
  const points: BsrPoint[] = []

  for (let i = 0; i + 1 < rankRaw.length; i += 2) {
    const keepaMinutes = rankRaw[i]
    const rank = rankRaw[i + 1]
    if (rank <= 0) continue // -1 = out of stock, skip

    const unixMs = KEEPA_EPOCH_MS + keepaMinutes * 60 * 1000
    if (unixMs < cutoffMs) continue

    points.push({ t: Math.floor(unixMs / 1000), rank })
  }

  return points
}

async function fetchFromKeepa(
  asin: string
): Promise<{ points: BsrPoint[]; tokensLeft: number | null }> {
  const key = keepaKey()
  if (!key) return { points: [], tokensLeft: null }

  const url = new URL(`${KEEPA_BASE}/product`)
  url.searchParams.set('key', key)
  url.searchParams.set('domain', '6')
  url.searchParams.set('asin', asin)
  url.searchParams.set('history', '1')
  url.searchParams.set('stats', '90')
  // NO rating=1 — not needed for BSR history, saves ~1 token

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch (e) {
    console.error('[getBsrHistory] network error:', e)
    throw new KeepaNetworkError(e instanceof Error ? e.message : String(e))
  }

  if (!res.ok) {
    console.error(`[getBsrHistory] Keepa ${res.status} for ASIN ${asin}`)
    throw new KeepaHttpError(res.status, asin)
  }

  let data: { products?: { csv?: (number[] | null)[] }[]; tokensLeft?: number }
  try {
    data = await res.json()
  } catch (e) {
    console.error('[getBsrHistory] JSON parse error:', e)
    throw new KeepaParseError(e instanceof Error ? e.message : String(e))
  }

  const product = data.products?.[0]
  const rankRaw = product?.csv?.[3]
  const points = Array.isArray(rankRaw) ? extractBsrPoints(rankRaw) : []

  return { points, tokensLeft: data.tokensLeft ?? null }
}

export async function getBsrHistory(asin: string): Promise<BsrHistoryResult> {
  const supabase = await createClient()

  // Cache check — 6h TTL (BSR can swing meaningfully within a day on spike books)
  const { data: cached } = await supabase
    .from('keepa_history_cache')
    .select('points, fetched_at')
    .eq('asin', asin)
    .gt('fetched_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .maybeSingle()

  if (cached) {
    return {
      asin,
      points: cached.points as BsrPoint[],
      fetchedAt: cached.fetched_at,
      fromCache: true,
      tokensLeft: null,
    }
  }

  // Cache miss — call Keepa
  const { points, tokensLeft } = await fetchFromKeepa(asin)
  const fetchedAt = new Date().toISOString()

  await supabase
    .from('keepa_history_cache')
    .upsert(
      { asin, points, tokens_left: tokensLeft, fetched_at: fetchedAt },
      { onConflict: 'asin' }
    )

  return { asin, points, fetchedAt, fromCache: false, tokensLeft }
}
