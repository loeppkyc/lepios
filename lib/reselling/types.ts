// Shared types for the reselling cluster (Repricer, Marketplace Hub, Retail HQ)

export interface RepricerRule {
  id: string
  user_id: string
  asin: string
  title: string | null
  rule_type: 'margin' | 'fixed' | 'competitive'
  min_price: number
  max_price: number
  target_margin: number | null
  notes: string | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RepricerLogEntry {
  id: string
  rule_id: string | null
  asin: string
  old_price: number | null
  new_price: number
  reason: string | null
  dry_run: boolean
  logged_at: string
}

export interface MarketplaceListing {
  id: string
  user_id: string
  sku: string | null
  title: string
  source: 'amazon' | 'books' | 'manual'
  asin: string | null
  isbn: string | null
  list_price: number | null
  ebay_status: 'none' | 'active' | 'sold' | 'ended'
  ebay_listed_at: string | null
  ebay_sold_at: string | null
  ebay_sold_price: number | null
  fb_status: 'none' | 'active' | 'sold' | 'ended'
  fb_listed_at: string | null
  fb_sold_at: string | null
  fb_sold_price: number | null
  kijiji_status: 'none' | 'active' | 'sold' | 'ended'
  kijiji_listed_at: string | null
  kijiji_sold_at: string | null
  kijiji_sold_price: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ChannelStatus = 'none' | 'active' | 'sold' | 'ended'

export interface BrandRiskEntry {
  brand: string
  risk_level: 0 | 1 | 2 | 3 | 4 | 5
  label: 'safe' | 'low' | 'moderate' | 'elevated' | 'high' | 'extreme'
  category: string
  notes: string
}

export interface RetailDeal {
  id: string
  asin: string | null
  title: string
  product_type: string | null
  source: string | null
  buy_price_cad: number | null
  sell_price_cad: number | null
  roi_pct: number | null
  sales_rank: number | null
  marketplace: string | null
  status: string | null
  found_date: string | null
  expires_date: string | null
  notes: string | null
}
