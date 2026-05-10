export type RetailWatchlistStatus = 'watching' | 'active' | 'passed' | 'sold'

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
  passed: 'Passed',
  sold: 'Sold',
}

export const STATUS_COLORS: Record<RetailWatchlistStatus, string> = {
  watching: 'bg-blue-900/40 text-blue-300',
  active: 'bg-green-900/40 text-green-300',
  passed: 'bg-zinc-800 text-zinc-400',
  sold: 'bg-amber-900/40 text-amber-300',
}
