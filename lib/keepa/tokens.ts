const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export interface KeepaTokenStatus {
  tokensLeft: number
  refillRate: number
  refillIn: number
}

export async function getTokenStatus(): Promise<KeepaTokenStatus | null> {
  const key = keepaKey()
  if (!key) return null

  let res: Response
  try {
    const url = new URL(`${KEEPA_BASE}/token`)
    url.searchParams.set('key', key)
    res = await fetch(url.toString())
  } catch {
    return null
  }

  if (!res.ok) return null

  try {
    const data = (await res.json()) as Record<string, unknown>
    return {
      tokensLeft: typeof data.tokensLeft === 'number' ? data.tokensLeft : 0,
      refillRate: typeof data.refillRate === 'number' ? data.refillRate : 0,
      refillIn: typeof data.refillIn === 'number' ? data.refillIn : 0,
    }
  } catch {
    return null
  }
}

export function estimateTokenCost(products: number, withHistory: boolean): number {
  return products * (withHistory ? 2 : 1)
}
