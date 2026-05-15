export type RetailWatchlistStatus =
  | 'watching'
  | 'active'
  | 'bought'
  | 'shipped_to_fba'
  | 'live_on_amazon'
  | 'sold'
  | 'passed'
  | 'returned'

export interface RetailWatchlistItem {
  id: string
  product: string
  brand: string | null
  category: string | null
  upc: string | null
  asin: string | null
  store: string
  buy_price: number | null
  regular_price: number | null
  pct_off: number | null
  amazon_price: number | null
  est_fba_fees: number | null
  est_profit: number | null
  roi_pct: number | null
  target_buy_price: number | null
  current_price: number | null
  url: string | null
  status: RetailWatchlistStatus
  notes: string | null
  alert_sent_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface RetailWatchlistCreate {
  product: string
  brand?: string
  category?: string
  upc?: string
  asin?: string
  store?: string
  buy_price?: number
  regular_price?: number
  pct_off?: number
  amazon_price?: number
  est_fba_fees?: number
  est_profit?: number
  roi_pct?: number
  target_buy_price?: number
  current_price?: number
  url?: string
  status?: RetailWatchlistStatus
  notes?: string
}

export interface RetailWatchlistUpdate {
  product?: string
  brand?: string
  category?: string
  upc?: string
  asin?: string
  store?: string
  buy_price?: number
  regular_price?: number
  pct_off?: number
  amazon_price?: number
  est_fba_fees?: number
  est_profit?: number
  roi_pct?: number
  target_buy_price?: number
  current_price?: number
  url?: string
  status?: RetailWatchlistStatus
  notes?: string
  is_active?: boolean
}

export const RETAIL_STORES = [
  'Walmart',
  'Canadian Tire',
  'Home Depot',
  'London Drugs',
  'Costco',
  'Sport Chek',
  'Staples',
  'Best Buy',
  'LEGO Store',
  'Winners / HomeSense',
  'Real Canadian Superstore',
  'Other',
] as const

export const RETAIL_CATEGORIES = [
  'LEGO & Toys',
  'Electronics',
  'Tools & Hardware',
  'Sports & Outdoors',
  'Health & Beauty',
  'Books & Media',
  'Kitchen & Home',
  'Office & School',
  'Auto',
  'Pet',
  'Other',
] as const

export const STATUS_LABELS: Record<RetailWatchlistStatus, string> = {
  watching: 'Watching',
  active: 'Active Deal',
  bought: 'Bought',
  shipped_to_fba: 'Shipped to FBA',
  live_on_amazon: 'Live on Amazon',
  sold: 'Sold',
  passed: 'Passed',
  returned: 'Returned',
}

export const STATUS_COLORS: Record<RetailWatchlistStatus, string> = {
  watching: 'bg-blue-900/40 text-blue-300',
  active: 'bg-green-900/40 text-green-300',
  bought: 'bg-purple-900/40 text-purple-300',
  shipped_to_fba: 'bg-indigo-900/40 text-indigo-300',
  live_on_amazon: 'bg-amber-900/40 text-amber-300',
  sold: 'bg-teal-900/40 text-teal-300',
  passed: 'bg-zinc-800 text-zinc-400',
  returned: 'bg-red-900/30 text-red-400',
}

// ── StockTrack types ──────────────────────────────────────────────────────────

export interface StockTrackProduct {
  name: string
  sku: string
  price: number | null
  imageUrl?: string
}

export interface StoreAvailability {
  store_name: string
  address?: string
  city?: string
  quantity: number
  price: number | null
  on_sale: boolean
}

export interface PriceDrop {
  product_name: string
  sku: string
  current_price: number | null
  regular_price: number | null
  discount_pct: number | null
  category?: string
  store_code: string
}

export interface TrendingProduct {
  product_name: string
  sku: string
  price: number | null
  regular_price: number | null
  stores_in_stock: number
  stores_total: number
}

export interface ScannerConfig {
  id: string
  store_code: string
  min_discount_pct: number
  keywords: string | null
  enabled: boolean
  last_scanned_at: string | null
  created_at: string
  updated_at: string
}
