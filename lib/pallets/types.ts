export interface PalletInvoice {
  id: string
  invoice_month: string // YYYY-MM-DD (first of month)
  vendor: string
  pallets_count: number
  total_cost_incl_gst: number
  gst_amount: number
  notes: string | null
  created_at: string
}

export interface PalletInvoiceInsert {
  invoice_month: string // YYYY-MM-DD (first of month)
  vendor: string
  pallets_count: number
  total_cost_incl_gst: number
  gst_amount: number
  notes?: string | null
}

export type PalletStatus = 'active' | 'closed' | 'settled'

export interface Pallet {
  id: string
  source: string
  intake_date: string // YYYY-MM-DD
  est_cost_cad: number | null
  status: PalletStatus
  notes: string | null
  created_at: string
}

export interface PalletInsert {
  source: string
  intake_date: string
  est_cost_cad?: number | null
  notes?: string | null
}

export interface PalletWithScanCount extends Pallet {
  scan_count: number
}

// ── AP Records (sub-module 2) ─────────────────────────────────────────────

export interface PalletApRecord {
  id: string
  pallet_id: string
  invoice_month: string // YYYY-MM-DD (first of month)
  confirmed_cost_cad: number
  gst_amount_cad: number
  paid_on: string | null // YYYY-MM-DD
  notes: string | null
  created_at: string
}

export interface PalletApRecordInsert {
  pallet_id: string
  invoice_month: string
  confirmed_cost_cad: number
  gst_amount_cad: number
  paid_on?: string | null
  notes?: string | null
}

export interface SettledPalletWithAp extends Pallet {
  confirmed_cost_cad: number
  gst_amount_cad: number
  invoice_month: string
  paid_on: string | null
}
