import { keepaBreaker } from '@/lib/circuit-breaker'
import { saveSnapshot } from '@/lib/price-intel/snapshots'

const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export function keepaConfigured(): boolean {
  return Boolean(keepaKey())
}

export interface KeepaRawProduct {
  asin: string
  title?: string
  monthlySold?: number
  stats?: {
    current?: number[]
    avg?: number[]
    salesRankDrops30?: number
  }
}

interface KeepaResponse {
  products?: KeepaRawProduct[]
  tokensLeft?: number
}

// Keepa price units: integer hundredths of the currency (2999 = $29.99). -1 = unavailable.
function keepaPriceToCAD(units: number | undefined | null): number | null {
  if (units == null || units < 0) return null
  return units / 100
}

export async function keepaFetch(
  asin: string,
  domain = 6
): Promise<{ product: KeepaRawProduct | null; tokensLeft: number | null }> {
  const key = keepaKey()
  if (!key) return { product: null, tokensLeft: null }

  const url = new URL(`${KEEPA_BASE}/product`)
  url.searchParams.set('key', key)
  url.searchParams.set('domain', String(domain))
  url.searchParams.set('asin', asin)
  // stats=90 only — never history=1/days/rating (F7: token exhaustion risk, ~1 token/ASIN)
  url.searchParams.set('stats', '90')

  let res: Response
  try {
    res = await keepaBreaker.call(() => fetch(url.toString()))
  } catch (e) {
    console.error('[keepaFetch] network error:', e)
    return { product: null, tokensLeft: null }
  }

  if (!res.ok) {
    console.error(`[keepaFetch] ${res.status} for ASIN ${asin}`)
    return { product: null, tokensLeft: null }
  }

  let data: KeepaResponse
  try {
    data = (await res.json()) as KeepaResponse
  } catch (e) {
    console.error('[keepaFetch] JSON parse error:', e)
    return { product: null, tokensLeft: null }
  }

  const product = data.products?.[0] ?? null

  // Fire-and-forget snapshot write — never blocks or throws on the caller
  if (product) {
    void saveSnapshot({
      asin,
      domain,
      prices: {
        amazon: keepaPriceToCAD(product.stats?.current?.[0]),
        new: keepaPriceToCAD(product.stats?.current?.[1]),
        used: keepaPriceToCAD(product.stats?.current?.[2]),
        buybox: keepaPriceToCAD(product.stats?.current?.[18]),
        bsr: product.stats?.current?.[3] != null && product.stats.current[3] > 0
          ? product.stats.current[3]
          : null,
      },
    }).catch((e) => console.error('[keepaFetch] snapshot write failed:', e))
  }

  return {
    product,
    tokensLeft: data.tokensLeft ?? null,
  }
}
