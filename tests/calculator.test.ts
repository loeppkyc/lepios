import { describe, it, expect } from 'vitest'
import {
  calcProfit,
  calcRoi,
  getDecision,
  MIN_PROFIT_CAD,
  MIN_ROI_PCT,
  DEFAULT_MIN_PROFIT_CAD,
  DEFAULT_MIN_ROI_PCT,
  DEFAULT_MAX_BSR,
} from '@/lib/profit/calculator'

describe('calcProfit', () => {
  it('returns buy_box - fees - cost', () => {
    expect(calcProfit(15.0, 5.0, 2.0)).toBe(8.0)
  })

  it('returns negative profit when not profitable', () => {
    expect(calcProfit(5.0, 4.0, 2.0)).toBe(-1.0)
  })

  it('rounds to 2 decimal places', () => {
    expect(calcProfit(10.0, 3.333, 1.0)).toBe(5.67)
  })
})

describe('calcRoi', () => {
  it('returns (profit / cost) * 100', () => {
    expect(calcRoi(8.0, 2.0)).toBe(400.0)
  })

  it('returns 0 when costPaid is 0', () => {
    expect(calcRoi(5.0, 0)).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    expect(calcRoi(1.0, 3.0)).toBe(33.33)
  })
})

describe('getDecision', () => {
  it('returns buy when profit >= MIN_PROFIT and roi >= MIN_ROI', () => {
    expect(getDecision(MIN_PROFIT_CAD, MIN_ROI_PCT)).toBe('buy')
    expect(getDecision(5.0, 100)).toBe('buy')
  })

  it('returns skip when profit below threshold', () => {
    expect(getDecision(MIN_PROFIT_CAD - 0.01, 200)).toBe('skip')
  })

  it('returns skip when roi below threshold', () => {
    expect(getDecision(10.0, MIN_ROI_PCT - 0.01)).toBe('skip')
  })

  it('returns skip when both below threshold', () => {
    expect(getDecision(1.0, 10)).toBe('skip')
  })
})

describe('constants', () => {
  it('MIN_PROFIT_CAD is $3.00', () => {
    expect(MIN_PROFIT_CAD).toBe(3.0)
  })

  it('MIN_ROI_PCT is 50', () => {
    expect(MIN_ROI_PCT).toBe(50)
  })

  it('DEFAULT_* aliases match compat aliases', () => {
    expect(DEFAULT_MIN_PROFIT_CAD).toBe(MIN_PROFIT_CAD)
    expect(DEFAULT_MIN_ROI_PCT).toBe(MIN_ROI_PCT)
    expect(DEFAULT_MAX_BSR).toBe(0)
  })
})

describe('getDecision — with settings override', () => {
  it('uses settings.min_profit_cad when provided', () => {
    const settings = { min_profit_cad: 5.0, min_roi_pct: 0, max_bsr: 0 }
    expect(getDecision(4.99, 100, null, settings)).toBe('skip')
    expect(getDecision(5.0, 100, null, settings)).toBe('buy')
  })

  it('uses settings.min_roi_pct when provided', () => {
    const settings = { min_profit_cad: 0, min_roi_pct: 75, max_bsr: 0 }
    expect(getDecision(10, 74.99, null, settings)).toBe('skip')
    expect(getDecision(10, 75, null, settings)).toBe('buy')
  })

  it('applies BSR gate when max_bsr > 0 and bsr exceeds it', () => {
    const settings = { min_profit_cad: 0, min_roi_pct: 0, max_bsr: 500000 }
    expect(getDecision(10, 100, 500001, settings)).toBe('skip')
    expect(getDecision(10, 100, 500000, settings)).toBe('buy')
  })

  it('ignores BSR gate when max_bsr is 0 (no limit)', () => {
    const settings = { min_profit_cad: 0, min_roi_pct: 0, max_bsr: 0 }
    expect(getDecision(10, 100, 9999999, settings)).toBe('buy')
  })

  it('ignores BSR gate when bsr is null', () => {
    const settings = { min_profit_cad: 0, min_roi_pct: 0, max_bsr: 100000 }
    expect(getDecision(10, 100, null, settings)).toBe('buy')
  })

  it('falls back to defaults when settings not provided', () => {
    // With default settings ($3 profit, 50% ROI)
    expect(getDecision(3.0, 50)).toBe('buy')
    expect(getDecision(2.99, 50)).toBe('skip')
  })
})
