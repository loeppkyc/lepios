import { describe, it, expect } from 'vitest'
import { estimateEbayFees, estimateEbayProfit } from '@/lib/ebay/fees'

describe('estimateEbayFees', () => {
  it('applies 13.25% FVF to item price + $5 shipping', () => {
    // $20 item + $5 shipping = $25 base; $25 * 0.1325 = $3.3125 → $3.31; + $0.30 = $3.61
    const fees = estimateEbayFees(20)
    expect(fees.finalValueFee).toBe(3.31)
    expect(fees.perOrderFee).toBe(0.3)
    expect(fees.totalFees).toBe(3.61)
    expect(fees.shippingCost).toBe(5.0)
  })

  it('FVF base includes shipping — not just item price', () => {
    // $10 item, shipping_charged=$5 → base=$15 → FVF=$15*0.1325=$1.9875→$1.99; total=$2.29
    const fees = estimateEbayFees(10)
    expect(fees.finalValueFee).toBe(1.99)
    expect(fees.totalFees).toBe(2.29)
  })

  it('is more conservative than $0 shipping_charged', () => {
    // With $0 shipping: FVF = $10 * 0.1325 = $1.325 → $1.33; total = $1.63
    // With $5 shipping: FVF = $15 * 0.1325 = $1.9875 → $1.99; total = $2.29
    // Correct (higher) fees = lower estimated profit
    const fees = estimateEbayFees(10)
    expect(fees.totalFees).toBeGreaterThan(1.63)
  })
})

describe('estimateEbayProfit', () => {
  it('calculates profit correctly for a typical book', () => {
    // $20 item, $3.61 fees, $5 shipping, $0.25 cost = $11.14
    const profit = estimateEbayProfit(20, 0.25)
    expect(profit).toBe(11.14)
  })

  it('returns negative profit when costs exceed price', () => {
    const profit = estimateEbayProfit(5, 4)
    expect(profit).toBeLessThan(0)
  })

  it('is lower than naive calc ignoring shipping on FVF base', () => {
    // Naive (wrong): profit = 20 - (20*0.1325 + 0.30) - 5 - 0.25 = 20 - 2.95 - 5 - 0.25 = 11.80
    // Correct: profit = 20 - 3.61 - 5 - 0.25 = 11.14
    const profit = estimateEbayProfit(20, 0.25)
    expect(profit).toBeLessThan(11.8)
  })
})
