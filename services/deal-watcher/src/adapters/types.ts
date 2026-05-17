export interface WatchTarget {
  id: string
  name: string
  type: 'amazon-asin' | 'lego-ca' | 'generic-url' | 'shopify'
  url: string | null
  asin: string | null
  lego_item_number: string | null
  check_interval_min: number
  check_interval_sec: number | null // overrides check_interval_min when set
  alert_on: string
  threshold_price: number | null
  last_status: string | null
  last_checked_at: string | null
  notes: string | null
}

export interface StockResult {
  in_stock: boolean
  raw_status: string
  price?: number | null
}

export interface SiteAdapter {
  check(target: WatchTarget): Promise<StockResult>
  cartUrl(target: WatchTarget): string | null
}
