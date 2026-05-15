import { describe, it, expect } from 'vitest'
import { matchReceipt, AUTO_CONFIRM_THRESHOLD } from '@/lib/receipts/match'
import type { ReceiptLine, BankTransaction } from '@/lib/receipts/match'

// ── Helper fixtures ────────────────────────────────────────────────────────────

function makeReceipt(total: number, date = '2026-05-10', vendor = 'Costco'): ReceiptLine {
  return { id: 'r1', receipt_date: date, vendor, total }
}

function makeTxn(amount: number, date = '2026-05-10', description = 'Costco Wholesale'): BankTransaction {
  return { id: 't1', date, description, amount }
}

// ── Amount tolerance tiers ─────────────────────────────────────────────────────

describe('tiered tolerance — small receipt (≤ $50)', () => {
  it('$30 receipt with exact match → high confidence', () => {
    const receipt = makeReceipt(30)
    const txn = makeTxn(-30)  // bank txns are often negative
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
    expect(candidates[0].match_confidence).toBeGreaterThan(0.5)
  })

  it('$30 receipt with $3 difference → still matches (within ±$3 flat)', () => {
    const receipt = makeReceipt(30)
    const txn = makeTxn(-33)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
  })

  it('$30 receipt with $3.01 difference → no match (outside ±$3 flat)', () => {
    const receipt = makeReceipt(30)
    const txn = makeTxn(-33.01)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(0)
  })
})

describe('tiered tolerance — mid receipt ($50.01–$500)', () => {
  it('$200 receipt with $20 difference → still matches (within ±10%)', () => {
    const receipt = makeReceipt(200)
    const txn = makeTxn(-220)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
  })

  it('$200 receipt with $21 difference → no match (outside ±10%)', () => {
    const receipt = makeReceipt(200)
    const txn = makeTxn(-221)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(0)
  })
})

describe('tiered tolerance — large receipt (> $500)', () => {
  it('$600 receipt with $30 difference → still matches (within ±5%)', () => {
    const receipt = makeReceipt(600)
    const txn = makeTxn(-630)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
  })

  it('$600 receipt with $31 difference → no match (outside ±5%)', () => {
    const receipt = makeReceipt(600)
    const txn = makeTxn(-631)
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(0)
  })
})

// ── Date window ────────────────────────────────────────────────────────────────

describe('date window — ±10 calendar days', () => {
  it('9 days apart → matches', () => {
    const receipt = makeReceipt(100, '2026-05-10')
    const txn = makeTxn(-100, '2026-05-19')
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
  })

  it('11 days apart → no match', () => {
    const receipt = makeReceipt(100, '2026-05-10')
    const txn = makeTxn(-100, '2026-05-21')
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(0)
  })

  it('10 days apart → boundary match', () => {
    const receipt = makeReceipt(100, '2026-05-10')
    const txn = makeTxn(-100, '2026-05-20')
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
  })
})

// ── Auto-confirm threshold ─────────────────────────────────────────────────────

describe('auto-confirm threshold (≥ 0.92)', () => {
  it('exact amount + same date + vendor overlap → ≥ 0.92 auto-confirmed', () => {
    const receipt = makeReceipt(100, '2026-05-10', 'Costco')
    const txn = makeTxn(-100, '2026-05-10', 'COSTCO WHOLESALE 12345')
    const candidates = matchReceipt(receipt, [txn])
    expect(candidates.length).toBe(1)
    expect(candidates[0].match_confidence).toBeGreaterThanOrEqual(AUTO_CONFIRM_THRESHOLD)
    expect(candidates[0].auto_confirmed).toBe(true)
  })

  it('amount match only (no date or vendor) → below auto-confirm', () => {
    const receipt = makeReceipt(100, '2026-05-10', 'UnknownVendor')
    const txn = makeTxn(-100, '2026-05-01', 'GENERIC TXN')
    const candidates = matchReceipt(receipt, [txn])
    if (candidates.length > 0) {
      expect(candidates[0].auto_confirmed).toBe(false)
    }
  })
})

// ── Returns top 5 ─────────────────────────────────────────────────────────────

describe('returns at most 5 candidates', () => {
  it('with 10 matching txns, returns only 5', () => {
    const receipt = makeReceipt(100, '2026-05-10')
    const txns: BankTransaction[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      date: '2026-05-10',
      description: 'MATCH',
      amount: -(100 + i * 0.01), // slight variance
    }))
    const candidates = matchReceipt(receipt, txns)
    expect(candidates.length).toBeLessThanOrEqual(5)
  })
})

// ── Sorted by confidence desc ─────────────────────────────────────────────────

describe('results sorted by confidence descending', () => {
  it('best match is first', () => {
    const receipt = makeReceipt(100, '2026-05-10', 'Costco')
    const txns: BankTransaction[] = [
      { id: 't1', date: '2026-05-15', description: 'OTHER', amount: -100 },  // far date, no vendor
      { id: 't2', date: '2026-05-10', description: 'COSTCO WHOLESALE', amount: -100 }, // exact
    ]
    const candidates = matchReceipt(receipt, txns)
    expect(candidates[0].transaction_id).toBe('t2')
    expect(candidates[0].match_confidence).toBeGreaterThan(candidates[1]?.match_confidence ?? 0)
  })
})
