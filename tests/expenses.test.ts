import { describe, it, expect } from 'vitest'
import {
  expandRecurring,
  summariseExpenses,
  defaultTaxRateKey,
  computeTax,
  ZERO_GST_CATEGORIES,
  TAX_RATE_ZERO,
  TAX_RATE_DEFAULT,
  type BusinessExpense,
} from '@/lib/types/expenses'

// ── expandRecurring ───────────────────────────────────────────────────────────

describe('expandRecurring — one-time', () => {
  it('returns exactly one row with the original values', () => {
    const rows = expandRecurring('2026-03-15', 100, 5, 'one-time')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ date: '2026-03-15', pretax: 100, taxAmount: 5 })
  })
})

describe('expandRecurring — monthly', () => {
  it('starting in January produces 12 rows', () => {
    const rows = expandRecurring('2026-01-15', 50, 2.5, 'monthly')
    expect(rows).toHaveLength(12)
  })

  it('starting in October produces 3 rows (Oct, Nov, Dec)', () => {
    const rows = expandRecurring('2026-10-01', 50, 2.5, 'monthly')
    expect(rows).toHaveLength(3)
    expect(rows[0].date).toBe('2026-10-01')
    expect(rows[1].date).toBe('2026-11-01')
    expect(rows[2].date).toBe('2026-12-01')
  })

  it('preserves pretax and taxAmount on each row', () => {
    const rows = expandRecurring('2026-06-10', 75, 3.75, 'monthly')
    for (const r of rows) {
      expect(r.pretax).toBe(75)
      expect(r.taxAmount).toBe(3.75)
    }
  })

  it('clamps day to end of month (day 31 in Feb → Feb 28)', () => {
    const rows = expandRecurring('2026-01-31', 100, 5, 'monthly')
    const feb = rows.find((r) => r.date.startsWith('2026-02'))
    expect(feb?.date).toBe('2026-02-28')
  })
})

describe('expandRecurring — annual', () => {
  it('always produces exactly 12 rows', () => {
    const rows = expandRecurring('2026-07-01', 120, 6, 'annual')
    expect(rows).toHaveLength(12)
  })

  it('divides pretax evenly: 120 / 12 = 10 per month', () => {
    const rows = expandRecurring('2026-01-15', 120, 6, 'annual')
    for (const r of rows) {
      expect(r.pretax).toBe(10)
      expect(r.taxAmount).toBe(0.5)
    }
  })

  it('spans all 12 months of the year', () => {
    const rows = expandRecurring('2026-03-01', 120, 0, 'annual')
    const months = rows.map((r) => r.date.slice(0, 7))
    expect(months).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ])
  })
})

// ── summariseExpenses ─────────────────────────────────────────────────────────

describe('summariseExpenses', () => {
  const base: Omit<BusinessExpense, 'id' | 'date' | 'vendor' | 'category' | 'payment_method' | 'hubdoc' | 'notes' | 'created_at' | 'updated_at'> = {
    pretax: 0, tax_amount: 0, business_use_pct: 100,
  }

  it('returns zero summary for empty array', () => {
    const s = summariseExpenses([])
    expect(s.count).toBe(0)
    expect(s.totalPretax).toBe(0)
    expect(s.totalLogged).toBe(0)
    expect(s.businessPortion).toBe(0)
  })

  it('totals pretax and tax correctly', () => {
    const expenses = [
      { ...base, id: '1', date: '2026-01-01', vendor: 'A', category: 'X', payment_method: 'TD', hubdoc: false, notes: '', created_at: '', updated_at: '', pretax: 100, tax_amount: 5 },
      { ...base, id: '2', date: '2026-01-02', vendor: 'B', category: 'X', payment_method: 'TD', hubdoc: false, notes: '', created_at: '', updated_at: '', pretax: 200, tax_amount: 10 },
    ] as BusinessExpense[]
    const s = summariseExpenses(expenses)
    expect(s.count).toBe(2)
    expect(s.totalPretax).toBe(300)
    expect(s.totalTax).toBe(15)
    expect(s.totalLogged).toBe(315)
    expect(s.businessPortion).toBe(300)
  })

  it('applies business_use_pct to businessPortion only', () => {
    const expenses = [
      { ...base, id: '1', date: '2026-01-01', vendor: 'A', category: 'X', payment_method: 'TD', hubdoc: false, notes: '', created_at: '', updated_at: '', pretax: 100, tax_amount: 0, business_use_pct: 50 },
    ] as BusinessExpense[]
    const s = summariseExpenses(expenses)
    expect(s.totalPretax).toBe(100)
    expect(s.businessPortion).toBe(50)
  })

  it('0% business_use_pct contributes 0 to businessPortion', () => {
    const expenses = [
      { ...base, id: '1', date: '2026-01-01', vendor: 'A', category: 'X', payment_method: 'TD', hubdoc: false, notes: '', created_at: '', updated_at: '', pretax: 200, tax_amount: 10, business_use_pct: 0 },
    ] as BusinessExpense[]
    const s = summariseExpenses(expenses)
    expect(s.businessPortion).toBe(0)
    expect(s.totalPretax).toBe(200)
  })
})

// ── defaultTaxRateKey ─────────────────────────────────────────────────────────

describe('defaultTaxRateKey', () => {
  it('returns zero rate for zero-GST categories', () => {
    for (const cat of ZERO_GST_CATEGORIES) {
      expect(defaultTaxRateKey(cat)).toBe(TAX_RATE_ZERO)
    }
  })

  it('returns Alberta GST default for taxable categories', () => {
    expect(defaultTaxRateKey('Software & Subscriptions')).toBe(TAX_RATE_DEFAULT)
    expect(defaultTaxRateKey('Vehicle — Fuel')).toBe(TAX_RATE_DEFAULT)
    expect(defaultTaxRateKey('Office Supplies')).toBe(TAX_RATE_DEFAULT)
  })

  it('returns zero for unknown category', () => {
    expect(defaultTaxRateKey('Unknown Category')).toBe(TAX_RATE_DEFAULT)
  })
})

// ── computeTax ────────────────────────────────────────────────────────────────

describe('computeTax', () => {
  it('computes 5% GST correctly', () => {
    expect(computeTax(100, 'GST 5% (AB / NT / NU / YT)')).toBe(5)
  })

  it('computes 0% correctly', () => {
    expect(computeTax(100, 'No tax — 0%')).toBe(0)
  })

  it('computes 13% HST correctly', () => {
    expect(computeTax(200, 'HST 13% (ON)')).toBe(26)
  })

  it('rounds to 2 decimal places', () => {
    expect(computeTax(33.33, 'GST 5% (AB / NT / NU / YT)')).toBe(1.67)
  })

  it('returns 0 for unknown rate key', () => {
    expect(computeTax(100, 'Unknown Rate')).toBe(0)
  })
})
