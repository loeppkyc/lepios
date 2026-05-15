// Shared types for the receipt_lines feature.
// No server-only imports — safe for client and server.

export interface ReceiptLine {
  id: string
  created_at: string
  receipt_date: string         // YYYY-MM-DD
  vendor: string
  pre_tax: number | null
  tax: number | null
  total: number
  category: string | null
  line_items: LineItem[]
  source: 'gmail' | 'upload' | 'camera'
  source_email_id: string | null
  drive_url: string | null
  ocr_model: 'haiku' | 'sonnet' | 'regex' | null
  ocr_raw: unknown
  reconciled: boolean
  notes: string | null
}

export interface LineItem {
  description: string
  amount: number
  qty?: number
}

export interface ReceiptMatch {
  id: string
  created_at: string
  receipt_id: string
  transaction_id: string
  match_confidence: number
  auto_confirmed: boolean
  confirmed_at: string | null
  confirmed_by: string | null
}

export interface MatchCandidate {
  transaction_id: string
  transaction: {
    id: string
    date: string
    description: string
    amount: number
  }
  match_confidence: number
  auto_confirmed: boolean
}
