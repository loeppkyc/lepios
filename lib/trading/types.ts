/**
 * Shared TypeScript types for the Trading Journal + AI Pick Engine.
 *
 * Domain rules:
 * - All prices stored as numeric(12,4) in DB; use number in TS
 * - direction: 'long' | 'short' — never 'buy'/'sell' (matches DB CHECK)
 * - mode: 'paper' | 'live' — live gate controlled by trust_state (Chunk B)
 * - R-multiple: (exit − entry) / planned_risk * direction_sign
 */

// ── Instrument universe ───────────────────────────────────────────────────────

export interface InstrumentDef {
  ticker: string
  name: string
  type: 'future' | 'stock' | 'commodity'
  point_value: number
}

export const INSTRUMENTS: { futures: InstrumentDef[]; stocks: InstrumentDef[] } = {
  futures: [
    { ticker: 'ES=F', name: 'S&P 500 (MES)', type: 'future', point_value: 5 },
    { ticker: 'RTY=F', name: 'Russell 2000 (M2K)', type: 'future', point_value: 5 },
    { ticker: 'NQ=F', name: 'Nasdaq (MNQ)', type: 'future', point_value: 2 },
    { ticker: 'GC=F', name: 'Gold (MGC)', type: 'commodity', point_value: 10 },
    { ticker: 'CL=F', name: 'Crude Oil (MCL)', type: 'commodity', point_value: 10 },
    { ticker: 'SI=F', name: 'Silver (MSI)', type: 'commodity', point_value: 25 },
  ],
  stocks: [
    { ticker: 'TSLA', name: 'Tesla', type: 'stock', point_value: 1 },
    { ticker: 'NVDA', name: 'Nvidia', type: 'stock', point_value: 1 },
    { ticker: 'AAPL', name: 'Apple', type: 'stock', point_value: 1 },
    { ticker: 'AMZN', name: 'Amazon', type: 'stock', point_value: 1 },
    { ticker: 'MSFT', name: 'Microsoft', type: 'stock', point_value: 1 },
    { ticker: 'META', name: 'Meta', type: 'stock', point_value: 1 },
    { ticker: 'AMD', name: 'AMD', type: 'stock', point_value: 1 },
    { ticker: 'GOOG', name: 'Alphabet', type: 'stock', point_value: 1 },
  ],
}

export const ALL_INSTRUMENTS: InstrumentDef[] = [...INSTRUMENTS.futures, ...INSTRUMENTS.stocks]

/** Look up point value for R-multiple calc; stocks default to 1 */
export function getPointValue(ticker: string): number {
  const found = ALL_INSTRUMENTS.find((i) => i.ticker === ticker)
  return found?.point_value ?? 1
}

// ── Mood values ───────────────────────────────────────────────────────────────

export const MOOD_VALUES = [
  'Calm',
  'Confident',
  'Casual',
  'Eager',
  'Excited',
  'Tired',
  'Anxious',
  'Panicky',
  'Stubborn',
  'Emotional',
  'Other',
  'Neutral',
] as const

export type Mood = (typeof MOOD_VALUES)[number]

// ── Prediction weights ────────────────────────────────────────────────────────

/** Matches prediction_weights.weights jsonb for domain='trading' */
export interface PredictionWeights {
  trend_weight: number
  rsi_weight: number
  volume_weight: number
  momentum_weight: number
  level_weight: number
  atr_stop_mult: number // TODO: tune with real data — seed 1.5
  atr_target_mult: number // TODO: tune with real data — seed 3.0
  min_score_threshold: number // TODO: tune with real data — seed 5.0
}

export const DEFAULT_WEIGHTS: PredictionWeights = {
  trend_weight: 1.0,
  rsi_weight: 1.0,
  volume_weight: 1.0,
  momentum_weight: 1.0,
  level_weight: 1.0,
  atr_stop_mult: 1.5,
  atr_target_mult: 3.0,
  min_score_threshold: 5.0,
}

// ── Scoring types ─────────────────────────────────────────────────────────────

export type Grade = 'A' | 'B+' | 'B' | 'C'

export interface ScoreResult {
  ticker: string
  name: string
  type: 'future' | 'stock' | 'commodity'
  direction: 'long' | 'short'
  score: number // 0–13 raw (integer)
  weighted_score: number // float after applying weights
  grade: Grade
  confidence: number // 0–10
  entry_price: number
  stop_price: number
  target_price: number
  atr: number
  risk_reward: number
  reasons: string[] // 2–4 human-readable snippets
  weights_used: PredictionWeights
}

// ── Trade row (DB → app) ──────────────────────────────────────────────────────

export interface TradeRow {
  id: string
  trade_date: string // YYYY-MM-DD
  mode: 'paper' | 'live'
  horizon: 'day' | 'swing'
  direction: 'long' | 'short'
  ticker: string
  instrument_type: 'future' | 'stock' | 'commodity' | 'index'
  price_in: number
  stop_loss: number
  take_profit: number
  position_size: number | null
  date_out: string | null
  price_out: number | null
  stopped_out: boolean | null
  points_pnl: number | null
  dollar_pnl: number | null
  r_multiple: number | null
  mood: string | null
  comments: string | null
  ai_notes: Record<string, unknown> | null
  prediction_id: string | null
  person_handle: string
  _source: string
  created_at: string
  updated_at: string
}

// ── Prediction row (DB → app) ─────────────────────────────────────────────────

export interface PredictionRow {
  id: string
  domain: 'trading' | 'sports'
  pick_date: string // YYYY-MM-DD
  generated_at: string
  grade: Grade
  confidence: number
  reason: string
  ticker: string | null
  direction: 'long' | 'short' | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  atr: number | null
  risk_reward: number | null
  raw_score: number | null
  weighted_score: number | null
  weights_snapshot: PredictionWeights | null
  mode: 'paper' | 'live'
  resolved_at: string | null
  won: boolean | null
  actual_pnl: number | null
  exit_price: number | null
  actual_result: string | null
  person_handle: string
  created_at: string
  updated_at: string
}

// ── API request/response shapes ───────────────────────────────────────────────

export interface TradeInsert {
  trade_date: string
  mode?: 'paper' | 'live'
  horizon: 'day' | 'swing'
  direction: 'long' | 'short'
  ticker: string
  instrument_type?: 'future' | 'stock' | 'commodity' | 'index'
  price_in: number
  stop_loss: number
  take_profit: number
  position_size?: number
  mood?: string
  comments?: string
  prediction_id?: string
}

export interface TradeSettle {
  date_out: string
  price_out: number
  stopped_out: boolean
}

export interface PredictionSettle {
  won: boolean
  actual_pnl?: number
  actual_result?: string
}
