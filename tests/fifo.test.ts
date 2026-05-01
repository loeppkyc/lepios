import { describe, it, expect } from 'vitest'
import { computeInventoryValue } from '@/lib/cogs/fifo'
import type { CogsEntryForFifo } from '@/lib/cogs/fifo'

// ── Helpers ───────────────────────────────────────────────────────────────────

function entry(asin: string, unit_cost_cad: number, quantity: number, purchased_at: string): CogsEntryForFifo {
  return { asin, unit_cost_cad, quantity, purchased_at }
}

function qty(map: [string, number][]): Map<string, number> {
  return new Map(map)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeInventoryValue', () => {
  it('single cost layer — exact match', () => {
    const entries = [entry('B0ABC12345', 10, 5, '2026-01-01')]
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 5]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(50)
    expect(result.byAsin['B0ABC12345'].unitsCosted).toBe(5)
    expect(result.byAsin['B0ABC12345'].unitsUncosted).toBe(0)
    expect(result.total).toBe(50)
  })

  it('single cost layer — fulfillable < purchased (partial consumption)', () => {
    const entries = [entry('B0ABC12345', 10, 20, '2026-01-01')]
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 5]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(50)
    expect(result.byAsin['B0ABC12345'].unitsCosted).toBe(5)
    expect(result.byAsin['B0ABC12345'].unitsUncosted).toBe(0)
  })

  it('multi-layer FIFO — oldest layers consumed first', () => {
    const entries = [
      entry('B0ABC12345', 8, 3, '2026-01-01'),
      entry('B0ABC12345', 12, 4, '2026-02-01'),
    ]
    // 3 units @ $8 + 2 units @ $12 = $24 + $24 = $48
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 5]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(48)
    expect(result.byAsin['B0ABC12345'].unitsCosted).toBe(5)
    expect(result.byAsin['B0ABC12345'].unitsUncosted).toBe(0)
  })

  it('multi-layer FIFO — fulfillable exceeds all cost layers (uncosted units)', () => {
    const entries = [entry('B0ABC12345', 10, 3, '2026-01-01')]
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 5]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(30)
    expect(result.byAsin['B0ABC12345'].unitsCosted).toBe(3)
    expect(result.byAsin['B0ABC12345'].unitsUncosted).toBe(2)
  })

  it('zero stock — ASIN skipped entirely', () => {
    const entries = [entry('B0ABC12345', 10, 5, '2026-01-01')]
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 0]]))
    expect(result.byAsin['B0ABC12345']).toBeUndefined()
    expect(result.total).toBe(0)
  })

  it('ASIN with no cost entries — all units uncosted', () => {
    const result = computeInventoryValue([], qty([['B0ABC12345', 3]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(0)
    expect(result.byAsin['B0ABC12345'].unitsCosted).toBe(0)
    expect(result.byAsin['B0ABC12345'].unitsUncosted).toBe(3)
  })

  it('book ASIN (digit-first) computed but excluded from total', () => {
    const entries = [
      entry('B0ABC12345', 10, 5, '2026-01-01'),
      entry('0743273567', 1, 10, '2026-01-01'),
    ]
    const result = computeInventoryValue(
      entries,
      qty([['B0ABC12345', 5], ['0743273567', 8]])
    )
    expect(result.byAsin['0743273567'].value).toBe(8)
    expect(result.total).toBe(50) // only B0ABC12345
  })

  it('multiple non-book ASINs — total sums all', () => {
    const entries = [
      entry('B0AAA00001', 5, 10, '2026-01-01'),
      entry('B0BBB00002', 20, 3, '2026-01-01'),
    ]
    const result = computeInventoryValue(
      entries,
      qty([['B0AAA00001', 10], ['B0BBB00002', 3]])
    )
    expect(result.total).toBe(50 + 60)
  })

  it('layers sorted oldest-first regardless of input order', () => {
    // newer entry first in input; FIFO must sort and consume older one first
    const entries = [
      entry('B0ABC12345', 20, 5, '2026-03-01'),
      entry('B0ABC12345', 5, 5, '2026-01-01'),
    ]
    // FIFO: 3 units @ $5 (older) = $15
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 3]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(15)
  })

  it('total rounded to 2 decimal places', () => {
    const entries = [entry('B0ABC12345', 1 / 3, 1, '2026-01-01')]
    const result = computeInventoryValue(entries, qty([['B0ABC12345', 1]]))
    expect(result.byAsin['B0ABC12345'].value).toBe(0.33)
    expect(result.total).toBe(0.33)
  })
})
