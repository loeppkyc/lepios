/**
 * tests/self-repair/digest.test.ts
 *
 * Spec acceptance: §I (morning_digest line for self_repair)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── import under test (after mocks) ──────────────────────────────────────────

import { buildSelfRepairDigestLine } from '@/lib/harness/self-repair/digest'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'maybeSingle',
    'single',
    'in',
    'gte',
    'lte',
    'limit',
    'order',
    'neq',
    'not',
    'lt',
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ── AC-I: digest line format ──────────────────────────────────────────────────

describe('buildSelfRepairDigestLine', () => {
  it('returns no attempts message when no rows in last 24h', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // recent runs
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // stale PRs check

    const line = await buildSelfRepairDigestLine()
    expect(line).toBe('Self-repair (24h): no attempts')
  })

  it('returns correct counts for attempts/PRs/verify-failed/cap-exceeded', async () => {
    const rows = [
      {
        status: 'pr_opened',
        pr_url: 'https://github.com/pr/1',
        detected_at: new Date().toISOString(),
      },
      { status: 'verify_failed', pr_url: null, detected_at: new Date().toISOString() },
      { status: 'cap_exceeded', pr_url: null, detected_at: new Date().toISOString() },
      { status: 'draft_failed', pr_url: null, detected_at: new Date().toISOString() },
    ]

    mockFrom
      .mockReturnValueOnce(makeChain({ data: rows, error: null })) // recent runs
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // stale PRs check

    const line = await buildSelfRepairDigestLine()

    expect(line).toContain('4 attempts')
    expect(line).toContain('1 PRs opened')
    expect(line).toContain('1 verify-failed')
    expect(line).toContain('1 cap-exceeded')
  })

  it('appends stale PR warning when PRs unreviewed >7 days', async () => {
    const stalePr = {
      id: 'run-001',
      pr_url: 'https://github.com/pr/1',
      detected_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), // 8 days ago
    }

    mockFrom
      .mockReturnValueOnce(
        makeChain({
          data: [
            { status: 'pr_opened', pr_url: stalePr.pr_url, detected_at: new Date().toISOString() },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(makeChain({ data: [stalePr], error: null })) // stale PRs check

    const line = await buildSelfRepairDigestLine()

    expect(line).toContain('⚠️')
    expect(line).toContain('unreviewed')
    expect(line).toContain('>7d')
  })

  it('returns stats unavailable on DB error — never throws', async () => {
    mockFrom.mockReturnValueOnce(makeChain({ data: null, error: { message: 'db down' } }))

    const line = await buildSelfRepairDigestLine()
    expect(line).toBe('Self-repair: stats unavailable')
  })

  it('returns stats unavailable on thrown exception — never throws', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('connection refused')
    })

    const line = await buildSelfRepairDigestLine()
    expect(line).toBe('Self-repair: stats unavailable')
  })

  it('counts verify_timeout as verify-failed', async () => {
    const rows = [
      { status: 'verify_timeout', pr_url: null, detected_at: new Date().toISOString() },
      { status: 'verify_failed', pr_url: null, detected_at: new Date().toISOString() },
    ]

    mockFrom
      .mockReturnValueOnce(makeChain({ data: rows, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }))

    const line = await buildSelfRepairDigestLine()
    expect(line).toContain('2 verify-failed')
  })
})
