/**
 * Tests for lib/security/security-digest.ts
 *
 * Covers:
 *   - 0 actions → "0 actions, 0 denied ✅"
 *   - N actions, 0 denied → shows total, ✅
 *   - N actions, M denied → shows count + top caps, 🚨
 *   - Deduplicates cap names in the denied list
 *   - Caps list is limited to top 3 unique capabilities
 *   - DB error on total query → "stats unavailable" (never throws)
 *   - Thrown exception → "stats unavailable" (never throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildSecurityDigestLine } from '@/lib/security/security-digest'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCountChain(result: { count: number | null; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

function makeSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildSecurityDigestLine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 actions line when table is empty', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))

    const line = await buildSecurityDigestLine()
    expect(line).toBe('Security (24h): 0 actions, 0 denied ✅')
  })

  it('returns total count with no denials (✅) when no denied rows', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountChain({ count: 42, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))

    const line = await buildSecurityDigestLine()
    expect(line).toBe('Security (24h): 42 actions, 0 denied ✅')
  })

  it('includes denied count and capability names when denials exist', async () => {
    mockFrom.mockReturnValueOnce(makeCountChain({ count: 50, error: null })).mockReturnValueOnce(
      makeSelectChain({
        data: [{ capability: 'db.write.users' }, { capability: 'fs.delete' }],
        error: null,
      })
    )

    const line = await buildSecurityDigestLine()
    expect(line).toContain('50 actions')
    expect(line).toContain('2 denied 🚨')
    expect(line).toContain('db.write.users')
    expect(line).toContain('fs.delete')
  })

  it('deduplicates capability names in the denied list', async () => {
    mockFrom.mockReturnValueOnce(makeCountChain({ count: 10, error: null })).mockReturnValueOnce(
      makeSelectChain({
        data: [
          { capability: 'db.write.users' },
          { capability: 'db.write.users' },
          { capability: 'db.write.users' },
        ],
        error: null,
      })
    )

    const line = await buildSecurityDigestLine()
    expect(line).toContain('3 denied 🚨')
    // cap name should appear only once in the list
    expect(line.split('db.write.users').length - 1).toBe(1)
  })

  it('limits denied cap list to top 3 unique capabilities', async () => {
    mockFrom.mockReturnValueOnce(makeCountChain({ count: 100, error: null })).mockReturnValueOnce(
      makeSelectChain({
        data: [
          { capability: 'cap.a' },
          { capability: 'cap.b' },
          { capability: 'cap.c' },
          { capability: 'cap.d' },
          { capability: 'cap.e' },
        ],
        error: null,
      })
    )

    const line = await buildSecurityDigestLine()
    expect(line).toContain('5 denied 🚨')
    // only first 3 unique caps should appear
    expect(line).toContain('cap.a')
    expect(line).toContain('cap.b')
    expect(line).toContain('cap.c')
    expect(line).not.toContain('cap.d')
    expect(line).not.toContain('cap.e')
  })

  it('returns "stats unavailable" on total query DB error — never throws', async () => {
    mockFrom
      .mockReturnValueOnce(makeCountChain({ count: null, error: { message: 'DB error' } }))
      .mockReturnValueOnce(makeSelectChain({ data: [], error: null }))

    const line = await buildSecurityDigestLine()
    expect(line).toBe('Security: stats unavailable')
  })

  it('returns "stats unavailable" on thrown exception — never throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB down')
    })

    const line = await buildSecurityDigestLine()
    expect(line).toBe('Security: stats unavailable')
  })
})
