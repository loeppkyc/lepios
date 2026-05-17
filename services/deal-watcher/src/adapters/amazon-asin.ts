// Amazon CA adapter via Keepa API
// Domain 6 = amazon.ca (Colin's marketplace — codebase convention, lib/keepa/client.ts:31)
// stats=1 adds current price stats; history=0 keeps token cost to ~1/ASIN (F7 guard)
// availabilityAmazon: 0 = available from Amazon, else unavailable

import type { SiteAdapter, StockResult, WatchTarget } from './types.js'

interface KeepaResponse {
  products?: Array<{
    availabilityAmazon?: number
    stats?: { current?: number[] }
  }>
}

export const amazonAsinAdapter: SiteAdapter = {
  async check(target: WatchTarget): Promise<StockResult> {
    if (!target.asin) throw new Error('amazon-asin target missing asin')

    const apiKey = process.env.KEEPA_API_KEY ?? ''
    if (!apiKey) throw new Error('KEEPA_API_KEY not set')

    const url = `https://api.keepa.com/product?key=${apiKey}&domain=6&asin=${target.asin}&stats=1&history=0`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Keepa HTTP ${res.status}`)

    const data = (await res.json()) as KeepaResponse
    const product = data.products?.[0]
    if (!product) throw new Error('No product returned from Keepa')

    const in_stock = product.availabilityAmazon === 0
    // stats.current index 0 = NEW price in Keepa units (×100 = cents); -1 means unavailable
    const rawPrice = product.stats?.current?.[0]
    const price = typeof rawPrice === 'number' && rawPrice > 0 ? rawPrice / 100 : null

    return { in_stock, raw_status: in_stock ? 'in_stock' : 'out_of_stock', price }
  },

  cartUrl(target: WatchTarget): string | null {
    return target.asin ? `https://www.amazon.ca/dp/${target.asin}` : null
  },
}
