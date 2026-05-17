// Amazon CA checker via Keepa API
// Domain 6 = amazon.ca (Colin's marketplace — codebase convention, lib/keepa/client.ts:31)
// stats=1 adds current price stats; history=0 keeps token cost to ~1/ASIN (F7 guard)
// availabilityAmazon: 0 = available from Amazon, else unavailable

export interface AmazonStatus {
  in_stock: boolean
  price_cents: number | null // Keepa units: divide by 100 for dollars
}

export async function checkAmazon(asin: string): Promise<AmazonStatus> {
  const apiKey = process.env.KEEPA_API_KEY ?? ''
  if (!apiKey) throw new Error('KEEPA_API_KEY not set')

  const url = `https://api.keepa.com/product?key=${apiKey}&domain=6&asin=${asin}&stats=1&history=0`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Keepa HTTP ${res.status}`)

  const data = (await res.json()) as {
    products?: Array<{
      availabilityAmazon?: number
      stats?: { current?: number[] }
    }>
  }

  const product = data.products?.[0]
  if (!product) throw new Error('No product returned from Keepa')

  const in_stock = product.availabilityAmazon === 0
  // stats.current index 0 = NEW price in Keepa units (×100 = cents); -1 means not available
  const rawPrice = product.stats?.current?.[0]
  const price_cents = typeof rawPrice === 'number' && rawPrice > 0 ? rawPrice : null

  return { in_stock, price_cents }
}
