/**
 * Unit tests for buildSessionDigest.
 * Covers: all sections present, empty sections degrade gracefully,
 *         bytes within budget, non-fatal persist failure, build_ms populated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockRollup } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRollup: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/harness/rollup', () => ({
  computeHarnessRollup: mockRollup,
}))

import { buildSessionDigest } from '@/lib/memory/session-digest'

function makeSelectBuilder(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function makeInsertBuilder() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  }
}

function setupMocks(opts: {
  ideas?: unknown[]
  decisions?: unknown[]
  events?: unknown[]
  tasks?: unknown[]
  rollupPct?: number
} = {}) {
  mockRollup.mockResolvedValue({ rollup_pct: opts.rollupPct ?? 80.7 })
  mockFrom
    .mockReturnValueOnce(makeSelectBuilder(opts.ideas ?? []))      // idea_inbox
    .mockReturnValueOnce(makeSelectBuilder(opts.decisions ?? []))  // decisions_log
    .mockReturnValueOnce(makeSelectBuilder(opts.events ?? []))     // agent_events
    .mockReturnValueOnce(makeSelectBuilder(opts.tasks ?? []))      // task_queue
    .mockReturnValueOnce(makeInsertBuilder())                      // session_digests persist
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildSessionDigest', () => {
  it('returns markdown with all 5 section headers', async () => {
    setupMocks()
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.markdown).toContain('## Session Context')
    expect(digest.markdown).toContain('### Active Ideas')
    expect(digest.markdown).toContain('### Recent Decisions')
    expect(digest.markdown).toContain('### Recent Events')
    expect(digest.markdown).toContain('### Open Tasks')
  })

  it('shows harness rollup pct in header', async () => {
    setupMocks({ rollupPct: 77.5 })
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.markdown).toContain('77.5%')
  })

  it('emits no-active-ideas fallback when idea_inbox is empty', async () => {
    setupMocks({ ideas: [] })
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.markdown).toContain('_(no active ideas)_')
  })

  it('emits none fallback for all empty sections', async () => {
    setupMocks()
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.markdown).toContain('_(none)_')
  })

  it('renders idea titles and scores when ideas exist', async () => {
    setupMocks({
      ideas: [{ id: 'i1', title: 'Big idea', score: 0.9, status: 'active' }],
    })
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.markdown).toContain('Big idea')
    expect(digest.markdown).toContain('0.90')
  })

  it('stays within default 6000-byte budget', async () => {
    const manyIdeas = Array.from({ length: 15 }, (_, i) => ({
      id: `i${i}`,
      title: `Idea number ${i} with a fairly long title that takes up space`,
      score: 0.5,
      status: 'active',
    }))
    setupMocks({ ideas: manyIdeas })
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.bytes).toBeLessThanOrEqual(6000)
  })

  it('populates bytes and build_ms', async () => {
    setupMocks()
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.bytes).toBeGreaterThan(0)
    expect(digest.build_ms).toBeGreaterThanOrEqual(0)
  })

  it('does not throw when persist insert fails', async () => {
    mockRollup.mockResolvedValue({ rollup_pct: 80 })
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce({ insert: vi.fn().mockRejectedValue(new Error('db down')) })

    await expect(buildSessionDigest({ requested_by: 'test' })).resolves.toBeDefined()
  })

  it('returns zero-pct rollup when computeHarnessRollup returns null', async () => {
    mockRollup.mockResolvedValue(null)
    mockFrom
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(makeInsertBuilder())
    const digest = await buildSessionDigest({ requested_by: 'test' })
    expect(digest.sections.rollup.harness_pct).toBe(0)
  })
})
