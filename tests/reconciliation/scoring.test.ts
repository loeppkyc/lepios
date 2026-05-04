import { describe, it, expect } from 'vitest'
import { scoreMatch, greedyPair } from '@/lib/reconciliation/scoring'

// ── scoreMatch ────────────────────────────────────────────────────────────────

describe('scoreMatch — amount tolerance', () => {
  it('exact amount, same day → 0 (bonuses floor at 0)', () => {
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-01', '')).toBe(0)
  })

  it('amount diff within tolerance → positive score', () => {
    // receipt=100, diff=1, tolerance=15; score=1*10+0-2(near)=8
    expect(scoreMatch(100, '2026-01-01', '', 101, '2026-01-01', '')).toBe(8)
  })

  it('amount diff exceeds tolerance → 999', () => {
    // receipt=10, tolerance=max(min(1.5,20),2)=2; diff=5>2
    expect(scoreMatch(10, '2026-01-01', '', 15, '2026-01-01', '')).toBe(999)
  })

  it('large receipt ($200) — tolerance capped at $20, diff=20 passes (not strictly greater)', () => {
    // tolerance=20, diff=20 — not > 20; score=20*10+0-2(near)=198
    expect(scoreMatch(200, '2026-01-01', '', 220, '2026-01-01', '')).toBe(198)
  })

  it('large receipt ($200) — diff=21 exceeds $20 cap → 999', () => {
    expect(scoreMatch(200, '2026-01-01', '', 221, '2026-01-01', '')).toBe(999)
  })

  it('small receipt ($5) — minimum tolerance $2 applies', () => {
    // receipt=5, 15%=0.75 < 2, so tolerance=2; diff=1.5 ≤ 2 → scores
    expect(scoreMatch(5, '2026-01-01', '', 6.5, '2026-01-01', '')).toBeLessThan(999)
  })

  it('small receipt ($5) — diff=2.01 exceeds $2 floor tolerance → 999', () => {
    expect(scoreMatch(5, '2026-01-01', '', 7.01, '2026-01-01', '')).toBe(999)
  })
})

describe('scoreMatch — date window', () => {
  it('date diff exactly 10 days → passes (boundary is strict >10)', () => {
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-11', '')).toBeLessThan(999)
  })

  it('date diff 11 days → 999', () => {
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-12', '')).toBe(999)
  })

  it('dayDiff ≤ 3 grants -2 near-date bonus', () => {
    // diff=0, dayDiff=2: base=0+2*0.5=1, -2(near), -3(exact)=-4 → 0
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-03', '')).toBe(0)
  })

  it('dayDiff=9, exact amount — no near-date bonus', () => {
    // diff=0, dayDiff=9: base=0+9*0.5=4.5, -3(exact)=1.5
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-10', '')).toBeCloseTo(1.5)
  })

  it('invalid receipt date → 999', () => {
    expect(scoreMatch(10, 'not-a-date', '', 10, '2026-01-01', '')).toBe(999)
  })

  it('invalid expense date → 999', () => {
    expect(scoreMatch(10, '2026-01-01', '', 10, 'bad', '')).toBe(999)
  })
})

describe('scoreMatch — exact amount bonus', () => {
  it('amountDiff < 0.01 grants -3 bonus', () => {
    // diff=0.009, dayDiff=0: base=0.09, -2(near), -3(exact)=-4.91 → 0
    expect(scoreMatch(10, '2026-01-01', '', 10.009, '2026-01-01', '')).toBe(0)
  })

  it('amountDiff = 0.01 does NOT trigger exact bonus', () => {
    // diff=0.01, dayDiff=0: base=0.1, -2(near), no exact bonus → 0 (floored)
    expect(scoreMatch(10, '2026-01-01', '', 10.01, '2026-01-01', '')).toBe(0)
  })
})

describe('scoreMatch — vendor bonuses', () => {
  it('2+ matching words (length>3) → -8 bonus', () => {
    // diff=0, dayDiff=0: base=-5 (near+exact), -8 vendor → floored at 0
    expect(scoreMatch(10, '2026-01-01', 'Amazon Canada', 10, '2026-01-01', 'amazon canada')).toBe(0)
  })

  it('1 matching word → -5 bonus', () => {
    expect(scoreMatch(10, '2026-01-01', 'Amazon stuff', 10, '2026-01-01', 'amazon misc')).toBe(0)
  })

  it('expense vendor contains first 6 chars of receipt vendor → -5 bonus', () => {
    expect(scoreMatch(10, '2026-01-01', 'Costco wholesale', 10, '2026-01-01', 'costco')).toBe(0)
  })

  it('4-char prefix match → -2 bonus', () => {
    // receipt vendor "Cost", expense has "cost" — 4-char overlap
    // diff=0, dayDiff=5 (no near bonus): base=0+5*0.5=2.5, -3(exact), -2(prefix4) = -2.5 → 0
    expect(scoreMatch(10, '2026-01-01', 'Cost Inc', 10, '2026-01-06', 'cost ltd')).toBe(0)
  })

  it('no vendor match — no bonus', () => {
    // diff=0, dayDiff=5: base=2.5, -3(exact)=-0.5 → 0
    expect(scoreMatch(10, '2026-01-01', 'Apple', 10, '2026-01-06', 'Google')).toBe(0)
  })

  it('empty receipt vendor — no vendor scoring attempted', () => {
    expect(scoreMatch(10, '2026-01-01', '', 10, '2026-01-01', 'Amazon')).toBe(0)
  })

  it('score is never negative', () => {
    const s = scoreMatch(
      10,
      '2026-01-01',
      'Amazon Canada Store',
      10,
      '2026-01-01',
      'amazon canada store'
    )
    expect(s).toBeGreaterThanOrEqual(0)
  })
})

// ── greedyPair ────────────────────────────────────────────────────────────────

describe('greedyPair', () => {
  it('empty input → no matches', () => {
    expect(greedyPair([])).toEqual({ autoMatches: [], needsReview: 0 })
  })

  it('single high-confidence pair (score ≤ 1.0) → auto-matched', () => {
    const result = greedyPair([{ score: 0.5, receiptId: 'r1', expenseId: 'e1' }])
    expect(result.autoMatches).toEqual([{ receiptId: 'r1', expenseId: 'e1' }])
    expect(result.needsReview).toBe(0)
  })

  it('score exactly 1.0 → auto-matched (boundary inclusive)', () => {
    const result = greedyPair([{ score: 1.0, receiptId: 'r1', expenseId: 'e1' }])
    expect(result.autoMatches).toHaveLength(1)
  })

  it('score just above 1.0 → needs review, not auto-matched', () => {
    const result = greedyPair([{ score: 1.01, receiptId: 'r1', expenseId: 'e1' }])
    expect(result.autoMatches).toHaveLength(0)
    expect(result.needsReview).toBe(1)
  })

  it('score exactly 3.0 → needs review (boundary inclusive)', () => {
    const result = greedyPair([{ score: 3.0, receiptId: 'r1', expenseId: 'e1' }])
    expect(result.needsReview).toBe(1)
  })

  it('score > 3.0 → neither auto-matched nor review', () => {
    const result = greedyPair([{ score: 5.0, receiptId: 'r1', expenseId: 'e1' }])
    expect(result.autoMatches).toHaveLength(0)
    expect(result.needsReview).toBe(0)
  })

  it('two receipts for same expense — best score wins, second is not double-counted', () => {
    const result = greedyPair([
      { score: 0.5, receiptId: 'r1', expenseId: 'e1' },
      { score: 0.8, receiptId: 'r2', expenseId: 'e1' },
    ])
    expect(result.autoMatches).toEqual([{ receiptId: 'r1', expenseId: 'e1' }])
    expect(result.needsReview).toBe(0) // r2 has no unclaimed expense left
  })

  it('same receipt claimed at most once — best score wins', () => {
    const result = greedyPair([
      { score: 0.5, receiptId: 'r1', expenseId: 'e2' },
      { score: 0.2, receiptId: 'r1', expenseId: 'e1' },
    ])
    expect(result.autoMatches).toHaveLength(1)
    expect(result.autoMatches[0]).toEqual({ receiptId: 'r1', expenseId: 'e1' })
  })

  it('unsorted input — greedy applies lowest score first regardless of input order', () => {
    const result = greedyPair([
      { score: 0.8, receiptId: 'r1', expenseId: 'e1' },
      { score: 0.3, receiptId: 'r1', expenseId: 'e2' },
    ])
    expect(result.autoMatches[0]).toEqual({ receiptId: 'r1', expenseId: 'e2' })
  })

  it('mixed: one auto, one review, one no-match', () => {
    const result = greedyPair([
      { score: 0.5, receiptId: 'r1', expenseId: 'e1' },
      { score: 2.0, receiptId: 'r2', expenseId: 'e2' },
      { score: 8.0, receiptId: 'r3', expenseId: 'e3' },
    ])
    expect(result.autoMatches).toHaveLength(1)
    expect(result.needsReview).toBe(1)
  })

  it('receipt already auto-matched is not counted again as review', () => {
    // r1 auto-matches to e1 (score 0.5), then r1→e2 at score 2.0 is skipped (r1 claimed)
    const result = greedyPair([
      { score: 0.5, receiptId: 'r1', expenseId: 'e1' },
      { score: 2.0, receiptId: 'r1', expenseId: 'e2' },
    ])
    expect(result.autoMatches).toHaveLength(1)
    expect(result.needsReview).toBe(0)
  })
})
