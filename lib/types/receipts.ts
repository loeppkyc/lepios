// Shared receipt types. No server-only imports — safe for client and server.

export type MatchStatus = 'matched' | 'review' | 'unmatched'

export interface Receipt {
  id: string
  upload_date: string // 'YYYY-MM-DD'
  receipt_date: string | null // 'YYYY-MM-DD'
  vendor: string
  vendor_key: string
  pretax: number | null
  tax_amount: number
  total: number | null
  category: string
  storage_path: string | null
  match_status: MatchStatus
  matched_expense_id: string | null
  notes: string
  ocr_source: 'manual' | 'claude_vision' | 'email_import'
  created_at: string
  updated_at: string
}

export interface OcrResult {
  vendor: string | null
  date: string | null // 'YYYY-MM-DD'
  pretax: number | null
  tax_amount: number | null
  total: number | null
  suggested_category: string | null
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: 'Matched',
  review: 'Needs Review',
  unmatched: 'Unmatched',
}
