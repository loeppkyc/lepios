import { amazonAsinAdapter } from './amazon-asin.js'
import { genericUrlAdapter } from './generic-url.js'
import { legoCaAdapter } from './lego-ca.js'
import { shopifyAdapter } from './shopify.js'
import type { SiteAdapter, WatchTarget } from './types.js'

const adapters: Record<WatchTarget['type'], SiteAdapter> = {
  'amazon-asin': amazonAsinAdapter,
  'lego-ca': legoCaAdapter,
  'generic-url': genericUrlAdapter,
  shopify: shopifyAdapter,
}

export function getAdapter(type: WatchTarget['type']): SiteAdapter {
  const adapter = adapters[type]
  if (!adapter) throw new Error(`No adapter for type: ${type}`)
  return adapter
}

export type { SiteAdapter, StockResult, WatchTarget } from './types.js'
