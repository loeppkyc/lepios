// Generic URL adapter — HTML pattern match
// Pattern stored in watch_targets.notes:
//   "MATCH:Add to Cart"  — alerts when text IS present
//   "ABSENT:Sold Out"    — alerts when text is NOT present
// Bare string (no prefix) defaults to MATCH behaviour.

import type { SiteAdapter, StockResult, WatchTarget } from './types.js'

export const genericUrlAdapter: SiteAdapter = {
  async check(target: WatchTarget): Promise<StockResult> {
    if (!target.url) throw new Error('generic-url target missing url')

    const res = await fetch(target.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LepiOS-WatchBot/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    const pattern = target.notes ?? 'MATCH:in stock'
    let matched: boolean
    if (pattern.startsWith('ABSENT:')) {
      matched = !html.toLowerCase().includes(pattern.slice(7).toLowerCase())
    } else {
      const term = pattern.startsWith('MATCH:') ? pattern.slice(6) : pattern
      matched = html.toLowerCase().includes(term.toLowerCase())
    }

    return { in_stock: matched, raw_status: matched ? 'match' : 'no_match' }
  },

  cartUrl(target: WatchTarget): string | null {
    return target.url
  },
}
