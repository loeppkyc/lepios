/**
 * Tests for lib/tax/sanity-check.ts
 *
 * Covers (F21 — acceptance tests first):
 *   - Exact baseline values → clean, no warnings
 *   - All-zero input → clean (no data state)
 *   - GST ratio drift >25% from baseline → warning
 *   - GST ratio drift ≤25% from baseline → no warning
 *   - CPP/income tax zero when sales populated → warning
 *   - GST zero when sales populated → warning
 *   - CPP/income tax ratio drift >25% → warning
 *   - Sales zero when tax values populated → warning
 *   - Returned ratios are correct (rounded to 6 sig figs)
 *   - Multiple warnings can fire simultaneously
 */

import { describe, it, expect } from 'vitest'
import { checkTaxProjection } from '@/lib/tax/sanity-check'

// Baseline anchors (from Colin's last full year)
const BASE_SALES = 800_000
const BASE_GST = 20_000 // 2.5% of sales
const BASE_CPP = 2_100 // 0.2625% of sales

describe('checkTaxProjection — baseline values', () => {
  it('returns no warnings on exact baseline inputs', () => {
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings).toHaveLength(0)
  })

  it('returns correct ratios on exact baseline inputs', () => {
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.ratios.gstRatio).toBeCloseTo(0.025, 6)
    expect(result.ratios.cppTaxRatio).toBeCloseTo(0.002625, 6)
  })
})

describe('checkTaxProjection — all-zero (no data state)', () => {
  it('returns no warnings when all inputs are zero', () => {
    const result = checkTaxProjection({ totalSales: 0, gstNetOfItcs: 0, cppIncomeTax: 0 })
    expect(result.warnings).toHaveLength(0)
  })

  it('returns null ratios when totalSales is zero', () => {
    const result = checkTaxProjection({ totalSales: 0, gstNetOfItcs: 0, cppIncomeTax: 0 })
    expect(result.ratios.gstRatio).toBeNull()
    expect(result.ratios.cppTaxRatio).toBeNull()
  })
})

describe('checkTaxProjection — GST ratio drift', () => {
  it('warns when GST ratio is >25% above baseline', () => {
    // Baseline GST ratio = 2.5%; >25% drift means >3.125%
    const highGst = Math.round(BASE_SALES * 0.0315) // 3.15% → 26% above baseline
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: highGst,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('gst'))).toBe(true)
  })

  it('warns when GST ratio is >25% below baseline', () => {
    // >25% below baseline means < 1.875%
    const lowGst = Math.round(BASE_SALES * 0.0185) // 1.85% → 26% below baseline
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: lowGst,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('gst'))).toBe(true)
  })

  it('does not warn when GST ratio is within 25% of baseline', () => {
    // Exactly 20% above baseline → no warning
    const okGst = Math.round(BASE_SALES * 0.03) // 3.0% → 20% above baseline
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: okGst,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('gst ratio'))).toBe(false)
  })
})

describe('checkTaxProjection — CPP/income tax ratio drift', () => {
  it('warns when CPP/income tax ratio is >25% above baseline', () => {
    // Baseline CPP ratio = 0.2625%; >25% means > 0.328125%
    const highCpp = Math.round(BASE_SALES * 0.0033) // 0.33% → 25.7% above
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: highCpp,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('cpp'))).toBe(true)
  })

  it('does not warn when CPP/income tax ratio is within 25% of baseline', () => {
    const okCpp = Math.round(BASE_SALES * 0.003) // 0.30% → 14.3% above baseline
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: okCpp,
    })
    expect(
      result.warnings.some(
        (w) => w.toLowerCase().includes('cpp') && w.toLowerCase().includes('ratio')
      )
    ).toBe(false)
  })
})

describe('checkTaxProjection — null/zero when others populated', () => {
  it('warns when CPP/income tax is zero but sales are populated', () => {
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: 0,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('cpp'))).toBe(true)
  })

  it('warns when GST is zero but sales are populated', () => {
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: 0,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('gst'))).toBe(true)
  })

  it('warns when sales are zero but tax values are populated', () => {
    const result = checkTaxProjection({
      totalSales: 0,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.warnings.some((w) => w.toLowerCase().includes('sales'))).toBe(true)
  })
})

describe('checkTaxProjection — multiple simultaneous warnings', () => {
  it('fires both GST and CPP warnings when both ratios drift', () => {
    const result = checkTaxProjection({
      totalSales: BASE_SALES,
      gstNetOfItcs: 0, // zero → null/zero warning
      cppIncomeTax: 0, // zero → null/zero warning
    })
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })
})

describe('checkTaxProjection — ratios computed correctly', () => {
  it('returns computed gstRatio when sales > 0', () => {
    const result = checkTaxProjection({
      totalSales: 1_000_000,
      gstNetOfItcs: 25_000,
      cppIncomeTax: BASE_CPP,
    })
    expect(result.ratios.gstRatio).toBeCloseTo(0.025, 6)
  })

  it('returns computed cppTaxRatio when sales > 0', () => {
    const result = checkTaxProjection({
      totalSales: 1_000_000,
      gstNetOfItcs: BASE_GST,
      cppIncomeTax: 3_000,
    })
    expect(result.ratios.cppTaxRatio).toBeCloseTo(0.003, 6)
  })
})
