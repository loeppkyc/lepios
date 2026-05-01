export type PricingModel = 'per_unit' | 'pallet'
export type CogsSource = 'manual' | 'sellerboard_import' | 'receipt_ocr'

export interface CogsEntry {
  id: string
  asin: string
  pricing_model: PricingModel
  unit_cost_cad: number | null
  quantity: number
  total_cost_cad: number | null // generated; null when pricing_model='pallet'
  purchased_at: string // YYYY-MM-DD
  vendor: string | null
  notes: string | null
  source: CogsSource
  created_at: string
  created_by: string
}

export interface CogsEntryInsert {
  asin: string
  pricing_model?: PricingModel
  unit_cost_cad?: number | null
  quantity?: number
  purchased_at: string
  vendor?: string | null
  notes?: string | null
  source?: CogsSource
  created_by?: string
}

// Aggregated view row — one row per ASIN across all cogs_entries
export interface CogsPerAsin {
  asin: string
  weighted_avg_unit_cost: number | null // null when only pallet entries exist
  latest_unit_cost: number | null
  total_quantity_purchased: number
  has_pallet_entries: boolean
  entry_count: number
}

// What orders-sync.ts applies to each order row
export interface OrderCogsResult {
  cogs_cad: number
  cogs_source: 'per_unit' | 'pallet' | null
}
