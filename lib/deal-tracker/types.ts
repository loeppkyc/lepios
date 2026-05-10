export interface DealTrackerItem {
  id: string
  user_id: string
  product: string
  url: string | null
  store: string | null
  target_price: number
  current_price: number | null
  last_checked_at: string | null
  alert_sent: boolean
  added_at: string
}

export interface DealPriceHistory {
  id: string
  item_id: string
  price: number
  recorded_at: string
}

export interface DealTrackerResponse {
  items: DealTrackerItem[]
}

export interface DealPriceHistoryResponse {
  history: DealPriceHistory[]
}
