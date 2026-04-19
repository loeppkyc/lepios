import { describe, it, expect } from 'vitest'
import {
  calcProfit,
  calcRoi,
  getDecision,
  MIN_PROFIT_CAD,
  MIN_ROI_PCT,
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
})
