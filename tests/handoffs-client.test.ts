/**
 * Unit tests for lib/handoffs/client.ts public functions.
 *
 * Mocks @/lib/supabase/service so no real Supabase connection is needed.
 * formatHandoffsForPrompt is a pure function — tested without mocks.
 *
 * RLS and real persistence require a live Supabase connection —
 * see scripts/backfill-handoffs.ts for end-to-end verification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock service client ───────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { saveHandoff, getRecentHandoffs, getHandoff, formatHandoffsForPrompt } from '@/lib/handoffs/client'
import type { SessionHandoff } from '@/lib/handoffs/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const minimalHandoff: SessionHandoff = {
  schema_version: 1,
  session_id: 'test-session-001',
  occurred_at: '2026-04-19T10:00:00Z',
  goal: 'Test the handoff system',
  status: 'completed',
  decisions: [],
  completed: [],
  deferred: [],
  unresolved: [],
  architectural_changes: [],
  next_steps: [],
}

const richHandoff: SessionHandoff = {
  schema_version: 1,
  session_id: 'test-session-002',
  occurred_at: '2026-04-19T12:00:00Z',
  goal: 'Ship the betting tile with Kelly criterion',
  status: 'partial',
  sprint: 2,
  decisions: [
    { decision: 'Use OR-mode FTS', rationale: 'AND-mode returned zero results', reversible: false, affected_files: ['lib/knowledge/client.ts'] },
    { decision: 'Defer Chunk 3.5', rationale: 'UX gap found at first use', reversible: true },
  ],
  completed: [
    { task: 'lib/kelly.ts', artifact: 'lib/kelly.ts', verified: true },
    { task: 'API routes', verified: false },
  ],
  deferred: [
    { task: 'Chunk 3.5 Today\'s Games', rationale: 'Sports API not yet ported', blocking: true },
    { task: 'Historical bet audit', rationale: 'Data integrity unknown', blocking: false },
  ],
  unresolved: [
    { issue: 'BACKLOG-3: No GitHub remote', impact: 'low', suggested_action: 'gh repo create' },
    { issue: 'BACKLOG-5: React #418 hydration mismatch', impact: 'medium' },
  ],
  architectural_changes: [
    { change: 'Kelly layer added', files_affected: ['lib/kelly.ts', 'lib/betting-signals.ts'] },
  ],
  next_steps: [
    { action: 'Scope Chunk 3.5', priority: 'p0', prerequisite: 'sports API diagnosis' },
    { action: 'Ship Chunk 4', priority: 'p1' },
  ],
  score: {
    in_scope: 95,
    notes: 'All planned chunks shipped',
    deferred_items: [{ item: 'Chunk 3.5', rationale: 'Discovered at first use' }],
  },
  notes: 'First real use of betting tile',
}

// ── Builder factories ─────────────────────────────────────────────────────────

function makeInsertBuilder(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  const upsert = vi.fn().mockReturnValue({ select })
  return { insert, upsert, select, single }
}

function makeSelectBuilder(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single,
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── saveHandoff ───────────────────────────────────────────────────────────────

describe('saveHandoff', () => {
  it('returns row id on success (insert mode)', async () => {
    const b = makeInsertBuilder({ data: { id: 'hof-123' }, error: null })
    mockFrom.mockReturnValue(b)

    const id = await saveHandoff(minimalHandoff)

    expect(id).toBe('hof-123')
    expect(mockFrom).toHaveBeenCalledWith('session_handoffs')
    expect(b.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'test-session-001',
        goal: 'Test the handoff system',
        status: 'completed',
        schema_version: 1,
      }),
    )
  })

  it('calls upsert (not insert) when opts.upsert=true', async () => {
    const b = makeInsertBuilder({ data: { id: 'hof-456' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveHandoff(minimalHandoff, { upsert: true })

    expect(b.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'test-session-001' }),
      { onConflict: 'session_id' },
    )
    expect(b.insert).not.toHaveBeenCalled()
  })

  it('returns null on Supabase error — never throws', async () => {
    const b = makeInsertBuilder({ data: null, error: { message: 'unique violation' } })
    mockFrom.mockReturnValue(b)

    const id = await saveHandoff(minimalHandoff)
    expect(id).toBeNull()
  })

  it('stores sprint=null when not provided', async () => {
    const b = makeInsertBuilder({ data: { id: 'h' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveHandoff(minimalHandoff) // minimalHandoff has no sprint
    expect(b.insert.mock.calls[0][0].sprint).toBeNull()
  })

  it('stores sprint number when provided', async () => {
    const b = makeInsertBuilder({ data: { id: 'h' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveHandoff({ ...minimalHandoff, sprint: 4 })
    expect(b.insert.mock.calls[0][0].sprint).toBe(4)
  })
})

// ── getRecentHandoffs ─────────────────────────────────────────────────────────

describe('getRecentHandoffs', () => {
  it('returns deserialized handoffs ordered newest-first', async () => {
    const rows = [
      { payload: richHandoff },
      { payload: minimalHandoff },
    ]
    const b = makeSelectBuilder({ data: rows, error: null })
    mockFrom.mockReturnValue(b)

    const result = await getRecentHandoffs(2)

    expect(result).toHaveLength(2)
    expect(result[0].session_id).toBe('test-session-002')
    expect(b.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(b.limit).toHaveBeenCalledWith(2)
  })

  it('defaults to limit=3', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    await getRecentHandoffs()
    expect(b.limit).toHaveBeenCalledWith(3)
  })

  it('returns empty array on Supabase error — never throws', async () => {
    const b = makeSelectBuilder({ data: null, error: { message: 'fail' } })
    mockFrom.mockReturnValue(b)

    const result = await getRecentHandoffs()
    expect(result).toEqual([])
  })
})

// ── getHandoff ────────────────────────────────────────────────────────────────

describe('getHandoff', () => {
  it('returns handoff payload for matching session_id', async () => {
    const b = makeSelectBuilder({ data: { payload: richHandoff }, error: null })
    mockFrom.mockReturnValue(b)

    const result = await getHandoff('test-session-002')

    expect(result).not.toBeNull()
    expect(result!.session_id).toBe('test-session-002')
    expect(b.eq).toHaveBeenCalledWith('session_id', 'test-session-002')
  })

  it('returns null when not found', async () => {
    const b = makeSelectBuilder({ data: null, error: { code: 'PGRST116' } })
    mockFrom.mockReturnValue(b)

    const result = await getHandoff('nonexistent')
    expect(result).toBeNull()
  })
})

// ── formatHandoffsForPrompt ───────────────────────────────────────────────────
// Pure function — no mocks needed.

describe('formatHandoffsForPrompt', () => {
  it('returns empty string for empty array', () => {
    expect(formatHandoffsForPrompt([])).toBe('')
  })

  it('includes session_id and goal in output', () => {
    const output = formatHandoffsForPrompt([minimalHandoff])
    expect(output).toContain('test-session-001')
    expect(output).toContain('Test the handoff system')
  })

  it('includes sprint number when present', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    expect(output).toContain('Sprint 2')
  })

  it('includes status in uppercase', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    expect(output).toContain('PARTIAL')
  })

  it('renders decisions with reversibility marker', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    expect(output).toContain('OR-mode FTS')
    expect(output).toContain('_(irreversible)_')
    expect(output).not.toMatch(/Defer Chunk 3\.5.*irreversible/) // reversible=true, no marker
  })

  it('renders completed count and verified count', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    // 2 completed tasks, 1 verified
    expect(output).toContain('2 tasks (1 verified)')
  })

  it('renders only critical/high unresolved items, skips medium/low', () => {
    const withHighImpact: SessionHandoff = {
      ...richHandoff,
      unresolved: [
        { issue: 'Critical auth bypass found', impact: 'critical' },
        { issue: 'BACKLOG-3: No GitHub remote', impact: 'low' },
      ],
    }
    const output = formatHandoffsForPrompt([withHighImpact])
    // critical should appear
    expect(output).toContain('Critical auth bypass found')
    // low should NOT appear
    expect(output).not.toContain('BACKLOG-3')
  })

  it('renders blocking deferred items', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    expect(output).toContain("Today's Games")
    // non-blocking deferred (Historical bet audit) should NOT appear
    expect(output).not.toContain('Historical bet audit')
  })

  it('renders next_steps sorted by priority', () => {
    const output = formatHandoffsForPrompt([richHandoff])
    const p0Pos = output.indexOf('[P0]')
    const p1Pos = output.indexOf('[P1]')
    expect(p0Pos).toBeLessThan(p1Pos)
  })

  it('handles multiple handoffs — newest first heading', () => {
    const output = formatHandoffsForPrompt([richHandoff, minimalHandoff])
    const pos002 = output.indexOf('test-session-002')
    const pos001 = output.indexOf('test-session-001')
    expect(pos002).toBeLessThan(pos001)
  })

  it('produces output within 2000-token budget (chars / 3.5 heuristic)', () => {
    // Three handoffs — worst-case token check
    const output = formatHandoffsForPrompt([richHandoff, richHandoff, minimalHandoff])
    const estimatedTokens = Math.round(output.length / 3.5)
    expect(estimatedTokens).toBeLessThan(2000)
  })
})
