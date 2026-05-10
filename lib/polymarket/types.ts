export interface PolymarketPrediction {
  id: string
  user_id: string
  trade_date: string
  market: string
  pick: string
  buy_price: number | null
  confidence: 'high' | 'medium' | 'low' | null
  potential_return: number | null
  resolved: boolean
  outcome: string | null
  pnl: number | null
  notes: string | null
  created_at: string
}

export interface PolymarketResponse {
  predictions: PolymarketPrediction[]
}
