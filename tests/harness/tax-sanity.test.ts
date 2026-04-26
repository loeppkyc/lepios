/**
 * Tests for lib/harness/tax-sanity.ts
 *
 * Covers:
 *   - No snapshot → "no snapshot yet" line
 *   - Clean snapshot → clean ✅ line with ratios
 *   - Snapshot with warnings → warning count + bullet list
 *   - DB error → "unavailable" fallback, never throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildTaxSanityLine } from '@/lib/harness/tax-sanity'

// ── Chain builder ─────────────────────────────────────────────────────────────

type SingleResult = { data: Record<string, number> | null; error: null }

function makeSingleChain(result: SingleResult) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildTaxSanityLine — no snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns "no snapshot yet" when table is empty', async () => {
    mockFrom.mockReturnValue(makeSingleChain({ data: null, error: null }))
    const result = await buildTaxSanityLine()
    expect(result).toBe('Tax sanity: no snapshot yet')
  })
})

describe('buildTaxSanityLine — clean snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns clean ✅ line with ratios on baseline values', async () => {
    mockFrom.mockReturnValue(
      makeSingleChain({
        data: { total_sales: 800_000, gst_net_of_itcs: 20_000, cpp_income_tax: 2_100 },
        error: null,
      })
    )
    const result = await buildTaxSanityLine()
    expect(result).toContain('✅')
    expect(result).toContain('GST 2.50%')
    expect(result).toContain('CPP+tax 0.263%')
    expect(result).not.toContain('⚠️')
  })
})

describe('buildTaxSanityLine — warnings present', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns warning count line when GST ratio drifts', async () => {
    // 4% GST → 60% above baseline (2.5%), well past 25% threshold
    mockFrom.mockReturnValue(
      makeSingleChain({
        data: { total_sales: 800_000, gst_net_of_itcs: 32_000, cpp_income_tax: 2_100 },
        error: null,
      })
    )
    const result = await buildTaxSanityLine()
    expect(result).toContain('⚠️')
    expect(result).toMatch(/\d+ warning/)
    expect(result).toContain('• ')
  })

  it('includes bullet lines for each warning', async () => {
    // Both GST zero AND CPP zero → 2 warnings
    mockFrom.mockReturnValue(
      makeSingleChain({
        data: { total_sales: 800_000, gst_net_of_itcs: 0, cpp_income_tax: 0 },
        error: null,
      })
    )
    const result = await buildTaxSanityLine()
    const bulletCount = (result.match(/• /g) ?? []).length
    expect(bulletCount).toBeGreaterThanOrEqual(2)
  })
})

describe('buildTaxSanityLine — DB error (never throws)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns fallback string when DB throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('connection refused')
    })
    const result = await buildTaxSanityLine()
    expect(result).toBe('Tax sanity: unavailable')
  })

  it('returns fallback string when query rejects', async () => {
    const badChain: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'limit']) {
      badChain[m] = vi.fn().mockReturnValue(badChain)
    }
    badChain['single'] = vi.fn().mockRejectedValue(new Error('db error'))
    mockFrom.mockReturnValue(badChain)
    const result = await buildTaxSanityLine()
    expect(result).toBe('Tax sanity: unavailable')
  })
})
