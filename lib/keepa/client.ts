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
    res = await fetch(url.toString())
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

  return {
    product: data.products?.[0] ?? null,
    tokensLeft: data.tokensLeft ?? null,
  }
}
