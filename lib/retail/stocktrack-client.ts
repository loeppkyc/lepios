/**
 * StockTrack API client — TypeScript port of stocktrack_api.py.
 *
 * No auth key required. Reverse-engineered endpoints.
 * Edmonton store IDs hardcoded (Streamlit production values).
 * Home Depot prices arrive in cents — divided by 100 here.
 * search.php may hit reCAPTCHA; drops_data.php and trends_data.php are reliable.
 */

import type { StockTrackProduct, StoreAvailability, PriceDrop, TrendingProduct } from './types'

export type StockTrackPeriod = 'today' | 'yesterday' | 'weekly'
export type StockTrackSearchType = 'search' | 'upc' | 'sku'

export const STOCKTRACK_STORES: Record<string, string> = {
  bb: 'Best Buy',
  ct: 'Canadian Tire',
  hd: 'Home Depot',
  st: 'Staples',
  wm: 'Walmart',
  sc: 'Sport Chek',
  tr: 'Toys R Us',
  pa: 'Princess Auto',
}

// Edmonton-area store IDs per retailer (from stocktrack_api.py production values)
export const EDMONTON_STORE_IDS: Record<string, string[]> = {
  bb: ['931', '932', '935', '937', '200'],
  ct: ['0467', '0397', '0288', '0614', '0347', '0334'],
  hd: ['7043', '7046', '7044', '7091', '7188'],
  st: [], // uses postal code T5G2Y2 instead
  wm: ['1015', '1088', '1279', '3106', '3075'],
  sc: [],
  tr: [],
  pa: [],
}

const BASE = 'https://stocktrack.ca'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
  Accept: 'application/json',
}

async function stGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`StockTrack ${res.status}: ${url}`)
  return res.json()
}

// ── Product search ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSearchResult(item: any, storeCode: string): StockTrackProduct {
  const isHD = storeCode === 'hd'
  const rawPrice = item.Price ?? item.price ?? item.SalePrice ?? item.salePrice ?? null
  const price = rawPrice != null ? (isHD ? Number(rawPrice) / 100 : Number(rawPrice)) : null
  return {
    name: String(item.ProductName ?? item.productName ?? item.Name ?? item.name ?? ''),
    sku: String(item.PrimarySKU ?? item.Sku ?? item.sku ?? item.SKU ?? ''),
    price: isNaN(price as number) ? null : price,
    imageUrl: item.ImageUrl ?? item.imageUrl ?? undefined,
  }
}

export async function searchProduct(
  storeCode: string,
  query: string,
  type: StockTrackSearchType = 'search'
): Promise<StockTrackProduct[]> {
  const url = `${BASE}/${storeCode}/search.php?q=${encodeURIComponent(query)}&n=10&t=${type}`
  const data = (await stGet(url)) as Record<string, unknown>
  const items = (data.products ?? data.items ?? data.results ?? []) as unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.slice(0, 10).map((it) => parseSearchResult(it as any, storeCode))
}

// ── Availability ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAvailability(item: any, storeCode: string): StoreAvailability {
  const isHD = storeCode === 'hd'
  const rawPrice = item.Price ?? item.price ?? item.StorePrice ?? null
  const price = rawPrice != null ? (isHD ? Number(rawPrice) / 100 : Number(rawPrice)) : null
  return {
    store_name: String(item.StoreName ?? item.storeName ?? item.Name ?? ''),
    address: item.Address ?? item.address ?? undefined,
    city: item.City ?? item.city ?? undefined,
    quantity: Number(item.Quantity ?? item.quantity ?? item.Qty ?? 0),
    price: isNaN(price as number) ? null : price,
    on_sale: Boolean(item.OnSale ?? item.onSale ?? item.IsOnSale ?? false),
  }
}

export async function checkAvailability(
  storeCode: string,
  sku: string
): Promise<StoreAvailability[]> {
  const storeIds = EDMONTON_STORE_IDS[storeCode] ?? []
  if (storeIds.length === 0) return []

  const storeParam = storeIds.join(',')
  const url =
    storeCode === 'st'
      ? `${BASE}/${storeCode}/availability.php?sku=${encodeURIComponent(sku)}&postal=T5G2Y2`
      : `${BASE}/${storeCode}/availability.php?sku=${encodeURIComponent(sku)}&stores=${storeParam}`

  const data = (await stGet(url)) as Record<string, unknown>
  const stores = (data.stores ?? data.items ?? data.locations ?? []) as unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stores.map((it) => parseAvailability(it as any, storeCode))
}

// ── Price drops ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDrop(item: any, storeCode: string): PriceDrop {
  const isHD = storeCode === 'hd'

  // Field name variance: CT vs BB vs others
  const rawCurrent =
    item.NewPrice ?? item.salePrice ?? item.CurrentPrice ?? item.current_price ?? null
  const rawRegular =
    item.OldPrice ?? item.regularPrice ?? item.RegularPrice ?? item.regular_price ?? null
  const rawDiscount =
    item.SavePct ?? item.save_pct ?? item.DiscountPct ?? item.discountPct ?? null
  const rawSku = item.PrimarySKU ?? item.Sku ?? item.SKU ?? item.sku ?? ''

  const toCad = (v: unknown) => {
    if (v == null) return null
    const n = Number(v)
    return isNaN(n) ? null : isHD ? n / 100 : n
  }

  const current = toCad(rawCurrent)
  const regular = toCad(rawRegular)
  const discountPct =
    rawDiscount != null
      ? Number(rawDiscount)
      : current != null && regular != null && regular > 0
        ? ((regular - current) / regular) * 100
        : null

  return {
    product_name: String(
      item.ProductName ?? item.productName ?? item.Name ?? item.name ?? 'Unknown'
    ),
    sku: String(rawSku),
    current_price: current,
    regular_price: regular,
    discount_pct: discountPct != null ? Math.round(discountPct * 10) / 10 : null,
    category: item.Category ?? item.category ?? undefined,
    store_code: storeCode,
  }
}

export async function getPriceDrops(
  storeCode: string,
  opts: {
    period?: StockTrackPeriod
    minDiscountPct?: number
    search?: string
  } = {}
): Promise<PriceDrop[]> {
  const { period = 'today', minDiscountPct = 0, search } = opts
  let url = `${BASE}/${storeCode}/drops_data.php?t=${period}&sort=save_p&count=50`
  if (search) url += `&q=${encodeURIComponent(search)}`

  const data = (await stGet(url)) as Record<string, unknown>
  const items = (data.drops ?? data.items ?? data.results ?? []) as unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drops = items.map((it) => parseDrop(it as any, storeCode))
  return minDiscountPct > 0
    ? drops.filter((d) => d.discount_pct != null && d.discount_pct >= minDiscountPct)
    : drops
}

// ── Trending ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTrending(item: any, storeCode: string): TrendingProduct {
  const isHD = storeCode === 'hd'
  const toCad = (v: unknown) => {
    if (v == null) return null
    const n = Number(v)
    return isNaN(n) ? null : isHD ? n / 100 : n
  }
  return {
    product_name: String(
      item.ProductName ?? item.productName ?? item.Name ?? item.name ?? 'Unknown'
    ),
    sku: String(item.PrimarySKU ?? item.Sku ?? item.sku ?? ''),
    price: toCad(item.Price ?? item.price ?? item.SalePrice ?? null),
    regular_price: toCad(item.RegularPrice ?? item.regularPrice ?? item.OldPrice ?? null),
    stores_in_stock: Number(item.StoresInStock ?? item.storesInStock ?? 0),
    stores_total: Number(item.StoresTotal ?? item.storesTotal ?? 0),
  }
}

export async function getTrending(storeCode: string): Promise<TrendingProduct[]> {
  const url = `${BASE}/${storeCode}/trends_data.php`
  const data = (await stGet(url)) as Record<string, unknown>
  const items = (data.trending ?? data.items ?? data.results ?? []) as unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.map((it) => parseTrending(it as any, storeCode))
}

// ── Multi-store scan (Auto Scan) ─────────────────────────────────────────────

export async function scanForDeals(
  storeCodes: string[],
  minDiscountPct: number,
  period: StockTrackPeriod = 'today',
  keywords?: string
): Promise<PriceDrop[]> {
  const results = await Promise.allSettled(
    storeCodes.map((code) => getPriceDrops(code, { period, minDiscountPct, search: keywords }))
  )
  const all: PriceDrop[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}
