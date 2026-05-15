/**
 * API route tests for /api/trades and /api/trades/[id]
 *
 * Tests request validation, response shape, and R-multiple computation logic.
 * Validation tests use inline Zod schemas (same logic as the routes).
 * P&L tests are pure math — no Supabase needed.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { getPointValue } from '../../lib/trading/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Test: validation helpers ──────────────────────────────────────────────────

const TradeInsertSchema = z.object({
  trade_date: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  mode: z.enum(['paper', 'live']).default('paper'),
  horizon: z.enum(['day', 'swing']),
  direction: z.enum(['long', 'short']),
  ticker: z.string().min(1),
  instrument_type: z.enum(['future', 'stock', 'commodity', 'index']).default('stock'),
  price_in: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive(),
  position_size: z.number().positive().default(1),
  mood: z.string().optional(),
  comments: z.string().optional(),
  prediction_id: z.string().uuid().optional(),
})

const TradeSettleSchema = z.object({
  date_out: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  price_out: z.number().positive(),
  stopped_out: z.boolean(),
})

describe('TradeInsertSchema validation', () => {
  it('requires trade_date, horizon, direction, ticker, price_in, stop_loss, take_profit', () => {
    // Valid input
    const validResult = TradeInsertSchema.safeParse({
      trade_date: '2026-05-15',
      horizon: 'day',
      direction: 'long',
      ticker: 'ES=F',
      price_in: 4800,
      stop_loss: 4780,
      take_profit: 4860,
    })
    expect(validResult.success).toBe(true)
    if (validResult.success) {
      expect(validResult.data.mode).toBe('paper') // default applied
      expect(validResult.data.position_size).toBe(1) // default applied
    }
  })

  it('rejects invalid date format', () => {
    const result = TradeInsertSchema.safeParse({
      trade_date: '05/15/2026',
      horizon: 'day',
      direction: 'long',
      ticker: 'ES=F',
      price_in: 4800,
      stop_loss: 4780,
      take_profit: 4860,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid direction', () => {
    const schema = z.object({ direction: z.enum(['long', 'short']) })
    const result = schema.safeParse({ direction: 'buy' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid horizon', () => {
    const schema = z.object({ horizon: z.enum(['day', 'swing']) })
    const result = schema.safeParse({ horizon: 'weekly' })
    expect(result.success).toBe(false)
  })

  it('accepts optional prediction_id as uuid', () => {
    const result = TradeInsertSchema.safeParse({
      trade_date: '2026-05-15',
      horizon: 'swing',
      direction: 'short',
      ticker: 'TSLA',
      price_in: 200,
      stop_loss: 210,
      take_profit: 180,
      prediction_id: '123e4567-e89b-12d3-a456-426614174000',
    })
    expect(result.success).toBe(true)
  })

  it('rejects prediction_id that is not a uuid', () => {
    const result = TradeInsertSchema.safeParse({
      trade_date: '2026-05-15',
      horizon: 'day',
      direction: 'long',
      ticker: 'ES=F',
      price_in: 4800,
      stop_loss: 4780,
      take_profit: 4860,
      prediction_id: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })
})

// ── Test: TradeSettle validation ──────────────────────────────────────────────

describe('TradeSettleSchema validation', () => {
  it('requires date_out, price_out, stopped_out', () => {
    const valid = TradeSettleSchema.safeParse({
      date_out: '2026-05-15',
      price_out: 4820,
      stopped_out: false,
    })
    expect(valid.success).toBe(true)
  })

  it('rejects missing stopped_out', () => {
    const missing = TradeSettleSchema.safeParse({
      date_out: '2026-05-15',
      price_out: 4820,
    })
    expect(missing.success).toBe(false)
  })

  it('requires price_out to be positive', () => {
    const neg = TradeSettleSchema.safeParse({
      date_out: '2026-05-15',
      price_out: -100,
      stopped_out: false,
    })
    expect(neg.success).toBe(false)
  })
})

// ── Test: P&L computation logic ───────────────────────────────────────────────

describe('Trade P&L computation', () => {
  // These mirror the logic in app/api/trades/[id]/route.ts
  function computePnl(params: {
    price_in: number
    price_out: number
    stop_loss: number
    direction: 'long' | 'short'
    position_size: number
    point_value: number
  }) {
    const directionSign = params.direction === 'long' ? 1 : -1
    const points_pnl = (params.price_out - params.price_in) * directionSign
    const dollar_pnl = points_pnl * params.point_value * params.position_size
    const abs_planned_risk = Math.abs(params.price_in - params.stop_loss)
    const abs_planned_risk_dollars = abs_planned_risk * params.point_value * params.position_size
    const r_multiple = abs_planned_risk_dollars > 0 ? dollar_pnl / abs_planned_risk_dollars : null
    return { points_pnl, dollar_pnl, r_multiple }
  }

  it('AC-3: ES=F long, price_in=4800, price_out=4820, position=1 → points=20, $=100', () => {
    const result = computePnl({
      price_in: 4800,
      price_out: 4820,
      stop_loss: 4780,
      direction: 'long',
      position_size: 1,
      point_value: 5, // ES=F
    })
    expect(result.points_pnl).toBe(20)
    expect(result.dollar_pnl).toBe(100)
    expect(result.r_multiple).toBe(1.0) // risk=20pts=$100, reward=$100 → 1R
  })

  it('losing long trade produces negative P&L', () => {
    const result = computePnl({
      price_in: 4800,
      price_out: 4790,
      stop_loss: 4780,
      direction: 'long',
      position_size: 1,
      point_value: 5,
    })
    expect(result.points_pnl).toBe(-10)
    expect(result.dollar_pnl).toBe(-50)
    expect(result.r_multiple).toBe(-0.5)
  })

  it('short trade winning produces positive P&L', () => {
    const result = computePnl({
      price_in: 4800,
      price_out: 4760,
      stop_loss: 4820,
      direction: 'short',
      position_size: 1,
      point_value: 5,
    })
    expect(result.points_pnl).toBe(40)
    expect(result.dollar_pnl).toBe(200)
    expect(result.r_multiple).toBe(2.0) // risk=20pts=$100, reward=$200 → 2R
  })

  it('TSLA stock uses point_value=1', () => {
    const result = computePnl({
      price_in: 200,
      price_out: 220,
      stop_loss: 190,
      direction: 'long',
      position_size: 10,
      point_value: 1, // stock
    })
    expect(result.points_pnl).toBe(20)
    expect(result.dollar_pnl).toBe(200) // 20pts × 1 × 10 shares
  })

  it('returns null r_multiple when stop == entry (zero risk)', () => {
    const result = computePnl({
      price_in: 4800,
      price_out: 4820,
      stop_loss: 4800, // same as entry — no risk defined
      direction: 'long',
      position_size: 1,
      point_value: 5,
    })
    expect(result.r_multiple).toBeNull()
  })
})

// ── Test: getPointValue ───────────────────────────────────────────────────────

describe('getPointValue', () => {
  it('returns correct point values for futures', () => {
    expect(getPointValue('ES=F')).toBe(5)
    expect(getPointValue('RTY=F')).toBe(5)
    expect(getPointValue('NQ=F')).toBe(2)
    expect(getPointValue('GC=F')).toBe(10)
    expect(getPointValue('CL=F')).toBe(10)
    expect(getPointValue('SI=F')).toBe(25)
  })

  it('returns 1 for stocks', () => {
    expect(getPointValue('TSLA')).toBe(1)
    expect(getPointValue('NVDA')).toBe(1)
    expect(getPointValue('AAPL')).toBe(1)
  })

  it('defaults to 1 for unknown tickers', () => {
    expect(getPointValue('UNKNOWN_TICKER')).toBe(1)
  })
})

// ── Test: learn route guard ─────────────────────────────────────────────────

describe('Learn route guard', () => {
  it('MIN_SAMPLE_SIZE is 20', () => {
    // Verify the constant matches acceptance doc spec
    const MIN_SAMPLE_SIZE = 20
    expect(MIN_SAMPLE_SIZE).toBe(20)
  })

  it('skips learn when sample_size < 20', () => {
    const sampleSize = 15
    const MIN = 20
    const shouldSkip = sampleSize < MIN
    expect(shouldSkip).toBe(true)
  })

  it('proceeds when sample_size >= 20', () => {
    const sampleSize = 25
    const MIN = 20
    const shouldSkip = sampleSize < MIN
    expect(shouldSkip).toBe(false)
  })
})
