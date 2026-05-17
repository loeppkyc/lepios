// Shopify adapter stub
// Future: use /products/{handle}.json?fields=variants (inventory_quantity)
// No auth needed for public storefronts; private needs Storefront API token.

import type { SiteAdapter, StockResult, WatchTarget } from './types.js'

export const shopifyAdapter: SiteAdapter = {
  async check(_target: WatchTarget): Promise<StockResult> {
    throw new Error('Shopify adapter not yet implemented')
  },

  cartUrl(_target: WatchTarget): string | null {
    return null
  },
}
