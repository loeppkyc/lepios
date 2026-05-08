/**
 * Tests for lib/failures/export-markdown.ts (buildMarkdown).
 *
 * Mocked DB. Validates: grouping by status, sort order within group,
 * markdown shape, header generation, optional fields rendering.
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { buildMarkdown } from '@/lib/failures/export-markdown'

beforeEach(() => {
  mockFrom.mockReset()
})

// ── Builder helpers ─────────────────────────────────────────────────────────

type Row = {
  failure_number: string | null
  title: string
  what_happened: string
  expected_behavior: string | null
  actual_behavior: string | null
  root_cause: string | null
  fix_commit_sha: string | null
  lesson: string | null
  severity: string
  status: string
  occurrence_count: number
  last_seen_at: string
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    failure_number: 'F-N1',
    title: 'Default title',
    what_happened: 'Something happened',
    expected_behavior: null,
    actual_behavior: null,
    root_cause: null,
    fix_commit_sha: null,
    lesson: null,
    severity: 'medium',
    status: 'open',
    occurrence_count: 1,
    last_seen_at: '2026-05-08T10:00:00Z',
    ...overrides,
  }
}

function makeStatusInQuery(rows: Row[]) {
  return {
    select: () => ({
      in: () => ({
        order: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  }
}

function makeStatusEqQuery(rows: Row[]) {
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  }
}

function makeFixedSinceQuery(rows: Row[]) {
  return {
    select: () => ({
      eq: () => ({
        gte: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

// Order: open+fixing (in), recurring (eq), fixed since (eq+gte)
function setupQueries(open: Row[], recurring: Row[], fixed: Row[]) {
  mockFrom
    .mockReturnValueOnce(makeStatusInQuery(open))
    .mockReturnValueOnce(makeStatusEqQuery(recurring))
    .mockReturnValueOnce(makeFixedSinceQuery(fixed))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildMarkdown — header', () => {
  it('includes generation timestamp + source-of-truth note', async () => {
    setupQueries([], [], [])
    const { content } = await buildMarkdown()
    expect(content).toContain('# LepiOS — Failure Log')
    expect(content).toContain('Auto-generated from')
    expect(content).toContain('Source of truth')
    expect(content).toContain('CLAUDE.md §9')
  })
})

describe('buildMarkdown — grouping', () => {
  it('renders Open section when there are open failures', async () => {
    setupQueries([row({ failure_number: 'F-N1', title: 'Open one', status: 'open' })], [], [])
    const { content } = await buildMarkdown()
    expect(content).toContain('## Open (1)')
    expect(content).toContain('F-N1 — Open one')
    expect(content).not.toContain('## Recurring')
    expect(content).not.toContain('## Fixed')
  })

  it('renders Recurring section when there are recurring failures', async () => {
    setupQueries(
      [],
      [
        row({
          failure_number: 'F-N2',
          title: 'Came back',
          status: 'recurring',
          occurrence_count: 3,
        }),
      ],
      []
    )
    const { content } = await buildMarkdown()
    expect(content).toContain('## Recurring (1)')
    expect(content).toContain('F-N2 — Came back')
    expect(content).toContain('**Occurrences:** 3')
  })

  it('renders all three sections when populated', async () => {
    setupQueries(
      [row({ failure_number: 'F-N1', status: 'open' })],
      [row({ failure_number: 'F-N2', status: 'recurring' })],
      [row({ failure_number: 'F-N3', status: 'fixed' })]
    )
    const { content } = await buildMarkdown()
    expect(content).toContain('## Open (1)')
    expect(content).toContain('## Recurring (1)')
    expect(content).toContain('## Fixed (last 30 days) (1)')
  })

  it('omits empty sections', async () => {
    setupQueries([], [], [])
    const { content } = await buildMarkdown()
    expect(content).not.toContain('## Open')
    expect(content).not.toContain('## Recurring')
    expect(content).not.toContain('## Fixed')
  })
})

describe('buildMarkdown — sort within group', () => {
  it('sorts by severity DESC, then last_seen_at DESC', async () => {
    setupQueries(
      [
        row({ failure_number: 'F-N1', severity: 'low', last_seen_at: '2026-05-08T10:00:00Z' }),
        row({ failure_number: 'F-N2', severity: 'critical', last_seen_at: '2026-05-01T10:00:00Z' }),
        row({ failure_number: 'F-N3', severity: 'high', last_seen_at: '2026-05-05T10:00:00Z' }),
        row({ failure_number: 'F-N4', severity: 'high', last_seen_at: '2026-05-07T10:00:00Z' }),
      ],
      [],
      []
    )
    const { content } = await buildMarkdown()
    const idxN1 = content.indexOf('F-N1')
    const idxN2 = content.indexOf('F-N2')
    const idxN3 = content.indexOf('F-N3')
    const idxN4 = content.indexOf('F-N4')
    // critical first
    expect(idxN2).toBeLessThan(idxN3)
    expect(idxN2).toBeLessThan(idxN4)
    // among 'high', N4 (newer) before N3 (older)
    expect(idxN4).toBeLessThan(idxN3)
    // low last
    expect(idxN1).toBeGreaterThan(idxN3)
  })
})

describe('buildMarkdown — entry rendering', () => {
  it('renders required fields and date in title', async () => {
    setupQueries(
      [
        row({
          failure_number: 'F-N1',
          title: 'Test failure',
          what_happened: 'It broke',
          last_seen_at: '2026-05-08T15:00:00Z',
        }),
      ],
      [],
      []
    )
    const { content } = await buildMarkdown()
    expect(content).toContain('## F-N1 — Test failure (2026-05-08)')
    expect(content).toContain('- **What:** It broke')
    expect(content).toContain('**Severity:** medium')
  })

  it('renders Pending analysis placeholder for missing root_cause', async () => {
    setupQueries([row({ failure_number: 'F-N1', root_cause: null })], [], [])
    const { content } = await buildMarkdown()
    expect(content).toContain('**Root cause:** _Pending analysis_')
  })

  it('renders Open placeholder for missing fix_commit_sha', async () => {
    setupQueries([row({ failure_number: 'F-N1', fix_commit_sha: null })], [], [])
    const { content } = await buildMarkdown()
    expect(content).toContain('**Fix/workaround:** _Open_')
  })

  it('renders dash for missing lesson', async () => {
    setupQueries([row({ failure_number: 'F-N1', lesson: null })], [], [])
    const { content } = await buildMarkdown()
    expect(content).toContain('**Lesson:** —')
  })

  it('renders all populated fields including expected/actual', async () => {
    setupQueries(
      [
        row({
          failure_number: 'F-N1',
          title: 'Full entry',
          what_happened: 'X broke',
          expected_behavior: 'Should have done Y',
          actual_behavior: 'Did Z instead',
          root_cause: 'Bad config',
          fix_commit_sha: 'abc1234',
          lesson: 'Always validate config',
          severity: 'high',
        }),
      ],
      [],
      []
    )
    const { content } = await buildMarkdown()
    expect(content).toContain('**Expected:** Should have done Y')
    expect(content).toContain('**Actual:** Did Z instead')
    expect(content).toContain('**Root cause:** Bad config')
    expect(content).toContain('**Fix/workaround:** abc1234')
    expect(content).toContain('**Lesson:** Always validate config')
    expect(content).toContain('**Severity:** high')
  })

  it('omits Occurrences line when count = 1', async () => {
    setupQueries([row({ failure_number: 'F-N1', occurrence_count: 1 })], [], [])
    const { content } = await buildMarkdown()
    expect(content).not.toContain('**Occurrences:**')
  })
})

describe('buildMarkdown — separators', () => {
  it('puts horizontal rule between sections', async () => {
    setupQueries(
      [row({ failure_number: 'F-N1', status: 'open' })],
      [row({ failure_number: 'F-N2', status: 'recurring' })],
      [row({ failure_number: 'F-N3', status: 'fixed' })]
    )
    const { content } = await buildMarkdown()
    // Between sections we expect a `---` separator. Count rules between sections.
    const ruleCount = (content.match(/^---$/gm) ?? []).length
    expect(ruleCount).toBeGreaterThanOrEqual(2) // header + between sections
  })
})
