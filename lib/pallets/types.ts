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
