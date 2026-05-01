/**
 * Tests for lib/tax/gst.ts (splitGst, splitGstForward)
 * and lib/tax/constants.ts (ZERO_GST, GST_RATE, CATEGORIES).
 *
 * F21 — acceptance tests first. Covers:
 *   - Backward split (splitGst): forward, backward, ZERO_GST, zero, negative/refund
 *   - Forward split (splitGstForward): basic, ZERO_GST exemption
 *   - Property test: pretax_cents + gst_cents === total_cents for all tested amounts
 *   - Backfill correctness: 5 utility_bills rows, formula matches migration SQL
 *   - ZERO_GST membership: expected categories are exempt, others are not
 *   - CATEGORIES completeness: all ZERO_GST members appear in CATEGORIES
 */

import { describe, it, expect } from 'vitest'
import { splitGst, splitGstForward } from '@/lib/tax/gst'
import { GST_RATE, ZERO_GST, CATEGORIES } from '@/lib/tax/constants'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert dollar amount to integer cents (rounds to nearest cent). */
const toCents = (n: number) => Math.round(n * 100)

// ── splitGst — backward split ─────────────────────────────────────────────────

describe('splitGst — standard (GST-inclusive total)', () => {
  it('splits $105.00 into $100.00 pretax + $5.00 gst', () => {
    const { pretax, gst, isZeroGst } = splitGst(105.0)
    expect(pretax).toBe(100.0)
    expect(gst).toBe(5.0)
    expect(isZeroGst).toBe(false)
  })

  it('splits $10.49 correctly', () => {
    const { pretax, gst } = splitGst(10.49)
    expect(pretax).toBe(9.99)
    expect(gst).toBe(0.5)
  })

  it('splits $1.00 correctly', () => {
    const { pretax, gst } = splitGst(1.0)
    expect(pretax).toBe(0.95)
    expect(gst).toBe(0.05)
  })

  it('handles $0.00 without error', () => {
    const { pretax, gst, isZeroGst } = splitGst(0)
    expect(pretax).toBe(0)
    expect(gst).toBe(0)
    expect(isZeroGst).toBe(false)
  })

  it('preserves sign for negative amounts (refunds)', () => {
    const { pretax, gst } = splitGst(-105.0)
    expect(pretax).toBe(-100.0)
    expect(gst).toBe(-5.0)
  })

  it('preserves sign for negative amounts — $-10.49', () => {
    const { pretax, gst } = splitGst(-10.49)
    expect(pretax).toBe(-9.99)
    expect(gst).toBe(-0.5)
  })
})

describe('splitGst — ZERO_GST exemption', () => {
  it('returns gst=0 and isZeroGst=true for "Bank Charges"', () => {
    const { pretax, gst, isZeroGst } = splitGst(50.0, 'Bank Charges')
    expect(pretax).toBe(50.0)
    expect(gst).toBe(0)
    expect(isZeroGst).toBe(true)
  })

  it('returns gst=0 for "Inventory — Books (Pallets)"', () => {
    const { pretax, gst, isZeroGst } = splitGst(1000.0, 'Inventory — Books (Pallets)')
    expect(pretax).toBe(1000.0)
    expect(gst).toBe(0)
    expect(isZeroGst).toBe(true)
  })

  it('returns gst=0 for "Amazon Advertising"', () => {
    const { gst, isZeroGst } = splitGst(250.0, 'Amazon Advertising')
    expect(gst).toBe(0)
    expect(isZeroGst).toBe(true)
  })

  it('returns gst=0 for "Insurance — Liability"', () => {
    const { gst, isZeroGst } = splitGst(150.0, 'Insurance — Liability')
    expect(gst).toBe(0)
    expect(isZeroGst).toBe(true)
  })

  it('applies normal GST for a non-exempt category', () => {
    const { gst, isZeroGst } = splitGst(105.0, 'Software & Subscriptions')
    expect(gst).toBeGreaterThan(0)
    expect(isZeroGst).toBe(false)
  })

  it('applies normal GST when no category is provided', () => {
    const { gst, isZeroGst } = splitGst(105.0)
    expect(gst).toBeGreaterThan(0)
    expect(isZeroGst).toBe(false)
  })
})

// ── Property test ─────────────────────────────────────────────────────────────

describe('splitGst — no-drift property', () => {
  // For any positive total, pretax_cents + gst_cents must equal total_cents exactly.
  // This is the guarantee that justifies gst = total - pretax (cents-based subtraction)
  // instead of pretax * GST_RATE (which can drift by ±$0.01 at some amounts).
  const testAmounts = [
    0.01, 0.05, 0.1, 0.63, 0.99, 1.0, 1.01, 1.05, 2.1, 3.15, 5.25, 9.99, 10.0, 10.49, 10.5, 47.25,
    87.5, 99.99, 100.0, 123.45, 249.99, 500.0, 999.99, 1000.0, 9999.99,
  ]

  for (const total of testAmounts) {
    it(`pretax_cents + gst_cents === total_cents for $${total}`, () => {
      const { pretax, gst } = splitGst(total)
      expect(toCents(pretax) + toCents(gst)).toBe(toCents(total))
    })
  }

  it('holds for all amounts in $0.01–$10.00 range (exhaustive)', () => {
    for (let cents = 1; cents <= 1000; cents++) {
      const total = cents / 100
      const { pretax, gst } = splitGst(total)
      expect(toCents(pretax) + toCents(gst)).toBe(cents)
    }
  })
})

// ── splitGstForward — forward split ───────────────────────────────────────────

describe('splitGstForward — GST-exclusive pretax → total', () => {
  it('computes gst = 5% of pretax for $100.00', () => {
    const result = splitGstForward(100.0)
    expect(result.pretax).toBe(100.0)
    expect(result.gst).toBe(5.0)
    expect(result.total).toBe(105.0)
    expect(result.isZeroGst).toBe(false)
  })

  it('computes gst correctly for $9.99', () => {
    const result = splitGstForward(9.99)
    expect(result.gst).toBe(0.5) // 9.99 * 0.05 = 0.4995 → rounds to 0.50
    expect(result.total).toBe(10.49)
  })

  it('handles $0.00 pretax', () => {
    const result = splitGstForward(0)
    expect(result.pretax).toBe(0)
    expect(result.gst).toBe(0)
    expect(result.total).toBe(0)
  })

  it('total equals pretax + gst (always, by construction)', () => {
    const amounts = [1.0, 9.99, 47.25, 100.0, 999.99]
    for (const pretax of amounts) {
      const result = splitGstForward(pretax)
      expect(result.total).toBe(Math.round((result.pretax + result.gst) * 100) / 100)
    }
  })

  it('returns gst=0, total=pretax for ZERO_GST category', () => {
    const result = splitGstForward(200.0, 'Bank Charges')
    expect(result.gst).toBe(0)
    expect(result.total).toBe(200.0)
    expect(result.isZeroGst).toBe(true)
  })
})

// ── Backfill correctness — simulates migration 0056 ───────────────────────────

describe('utility_bills backfill formula (migration 0056)', () => {
  // Five utility_bills rows with varying amount_cad.
  // All are electricity bills (Metergy) — category "Utilities", not in ZERO_GST.
  const seedRows = [
    { amount_cad: 45.0 },
    { amount_cad: 87.5 },
    { amount_cad: 123.45 },
    { amount_cad: 0.99 },
    { amount_cad: 1000.0 },
  ]

  for (const row of seedRows) {
    it(`backfills amount_cad=$${row.amount_cad} with no drift and isZeroGst=false`, () => {
      // Utilities is not in ZERO_GST — electricity is GST-applicable
      const { pretax, gst, isZeroGst } = splitGst(row.amount_cad, 'Utilities')

      // Sum in cents must equal original amount in cents (no 1-cent drift)
      expect(toCents(pretax) + toCents(gst)).toBe(toCents(row.amount_cad))

      // Electricity is never zero-rated
      expect(isZeroGst).toBe(false)

      // pretax should be strictly less than amount_cad (GST is positive)
      expect(pretax).toBeLessThan(row.amount_cad)
      expect(gst).toBeGreaterThan(0)
    })
  }

  it('no backfill row produces NULL pretax or gst (mirrors NOT NULL migration step)', () => {
    for (const row of seedRows) {
      const { pretax, gst } = splitGst(row.amount_cad)
      expect(pretax).not.toBeNaN()
      expect(gst).not.toBeNaN()
      expect(pretax).toBeGreaterThanOrEqual(0)
      expect(gst).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── ZERO_GST membership ────────────────────────────────────────────────────────

describe('ZERO_GST membership', () => {
  const expectedExempt = [
    'Inventory — Books (Pallets)',
    'Bank Charges',
    'Insurance — Liability',
    'Insurance — Vehicle (SGI)',
    'Amazon Advertising',
    'Loan Repayment — BDC',
    'Loan Repayment — Tesla',
  ]

  const expectedGstApplicable = [
    'Software & Subscriptions',
    'Shipping & Delivery',
    'Legal & Professional Fees',
    'Vehicle — Fuel',
    'Office Expenses',
    'Cell Phone & Internet',
    'Utilities',
    'Storage Rental',
  ]

  for (const cat of expectedExempt) {
    it(`"${cat}" is in ZERO_GST`, () => {
      expect(ZERO_GST.has(cat)).toBe(true)
    })
  }

  for (const cat of expectedGstApplicable) {
    it(`"${cat}" is NOT in ZERO_GST`, () => {
      expect(ZERO_GST.has(cat)).toBe(false)
    })
  }
})

// ── CATEGORIES completeness ────────────────────────────────────────────────────

describe('CATEGORIES and ZERO_GST consistency', () => {
  it('has 32 categories (matches Streamlit CATEGORIES list)', () => {
    expect(CATEGORIES.length).toBe(32)
  })

  it('every ZERO_GST member appears in CATEGORIES', () => {
    for (const exempt of ZERO_GST) {
      expect(CATEGORIES).toContain(exempt)
    }
  })

  it('no duplicate categories', () => {
    const deduped = new Set(CATEGORIES)
    expect(deduped.size).toBe(CATEGORIES.length)
  })
})

// ── GST_RATE constant ─────────────────────────────────────────────────────────

describe('GST_RATE', () => {
  it('is 0.05 (5% Alberta rate)', () => {
    expect(GST_RATE).toBe(0.05)
  })
})
