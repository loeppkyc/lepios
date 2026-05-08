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
  updated_at: string
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
    updated_at: '2026-05-08T10:00:00Z',
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

  it('uses max(updated_at) as Last data change (deterministic, idempotency-friendly)', async () => {
    // F-N14 fix: timestamp is derived from data, not Date.now(), so two
    // runs against unchanged data produce byte-identical markdown.
    const r1 = row({ failure_number: 'F-N1', updated_at: '2026-05-01T10:00:00Z', status: 'open' })
    const r2 = row({ failure_number: 'F-N2', updated_at: '2026-05-08T15:30:00Z', status: 'open' })
    setupQueries([r1, r2], [], [])
    const { content, lastDataChangeAt } = await buildMarkdown()
    expect(lastDataChangeAt).toBe('2026-05-08T15:30:00Z')
    expect(content).toContain('Last data change: 2026-05-08T15:30:00Z')
    // No "Last updated: <random ISO>" — that was the old behaviour.
    expect(content).not.toContain('Last updated:')
  })

  it('reports "never" for last_data_change when there are no rows', async () => {
    setupQueries([], [], [])
    const { content, lastDataChangeAt } = await buildMarkdown()
    expect(lastDataChangeAt).toBe('never')
    expect(content).toContain('Last data change: never')
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

// ── GitHub Contents API (F-N14 fix) ──────────────────────────────────────────

import {
  fetchExistingFile,
  commitFile,
  exportFailuresMarkdown,
} from '@/lib/failures/export-markdown'

function makeMockFetch(handlers: Array<(url: string, init?: RequestInit) => Promise<Response>>) {
  const queue = handlers.slice()
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const handler = queue.shift()
    if (!handler) throw new Error(`unexpected fetch to ${url}`)
    return handler(url, init as RequestInit | undefined)
  }
  return { fetch: fn, remaining: () => queue.length }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(status: number, body = ''): Response {
  return new Response(body, { status })
}

describe('fetchExistingFile', () => {
  it('returns sha + base64 content on 200', async () => {
    const { fetch: mockFetch } = makeMockFetch([
      async (url) => {
        expect(url).toContain('/contents/docs/claude-md/failures.md')
        expect(url).toContain('ref=main')
        return jsonResponse(200, { sha: 'abc123', content: 'aGVsbG8=\n', encoding: 'base64' })
      },
    ])
    const res = await fetchExistingFile(mockFetch, 'tok')
    expect(res).toEqual({ exists: true, sha: 'abc123', contentBase64: 'aGVsbG8=' })
  })

  it('returns exists:false on 404', async () => {
    const { fetch: mockFetch } = makeMockFetch([async () => textResponse(404, 'not found')])
    const res = await fetchExistingFile(mockFetch, 'tok')
    expect(res).toEqual({ exists: false })
  })

  it('returns error when token missing', async () => {
    const res = await fetchExistingFile(fetch, '')
    expect(res).toEqual({ error: 'GITHUB_TOKEN not set' })
  })

  it('returns error on non-2xx + non-404 response', async () => {
    const { fetch: mockFetch } = makeMockFetch([async () => textResponse(500, 'boom')])
    const res = await fetchExistingFile(mockFetch, 'tok')
    expect('error' in res ? res.error : '').toMatch(/500/)
  })
})

describe('commitFile', () => {
  it('PUTs without sha when creating a new file', async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null
    const { fetch: mockFetch } = makeMockFetch([
      async (url, init) => {
        captured = { url, body: JSON.parse(init?.body as string) as Record<string, unknown> }
        return jsonResponse(201, { commit: { sha: 'commit-sha-1' } })
      },
    ])
    const res = await commitFile('aGVsbG8=', undefined, mockFetch, 'tok')
    expect(res).toEqual({ ok: true, sha: 'commit-sha-1' })
    expect(captured!.body.sha).toBeUndefined()
    expect(captured!.body.branch).toBe('main')
    expect(captured!.body.content).toBe('aGVsbG8=')
  })

  it('PUTs with sha when updating an existing file', async () => {
    let captured: { body: Record<string, unknown> } | null = null
    const { fetch: mockFetch } = makeMockFetch([
      async (_url, init) => {
        captured = { body: JSON.parse(init?.body as string) as Record<string, unknown> }
        return jsonResponse(200, { commit: { sha: 'commit-sha-2' } })
      },
    ])
    const res = await commitFile('aGVsbG8=', 'existing-sha', mockFetch, 'tok')
    expect(res).toEqual({ ok: true, sha: 'commit-sha-2' })
    expect(captured!.body.sha).toBe('existing-sha')
  })

  it('returns error on PUT failure', async () => {
    const { fetch: mockFetch } = makeMockFetch([async () => textResponse(409, 'sha mismatch')])
    const res = await commitFile('aGVsbG8=', 'stale-sha', mockFetch, 'tok')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/409/)
  })

  it('returns error when token missing', async () => {
    const res = await commitFile('aGVsbG8=', undefined, fetch, '')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/GITHUB_TOKEN/)
  })
})

describe('exportFailuresMarkdown — orchestration', () => {
  it('skips commit when content unchanged (idempotent path — F19 hot-path)', async () => {
    setupQueries(
      [row({ failure_number: 'F-N1', status: 'open', updated_at: '2026-05-08T10:00:00Z' })],
      [],
      []
    )
    const { content } = await buildMarkdown()
    setupQueries(
      [row({ failure_number: 'F-N1', status: 'open', updated_at: '2026-05-08T10:00:00Z' })],
      [],
      []
    )
    const expectedBase64 = Buffer.from(content, 'utf-8').toString('base64')

    const { fetch: mockFetch, remaining } = makeMockFetch([
      async () =>
        jsonResponse(200, { sha: 'sha-prev', content: expectedBase64, encoding: 'base64' }),
    ])

    const res = await exportFailuresMarkdown({ fetchImpl: mockFetch, token: 'tok' })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBe(true)
    expect(res.commit_sha).toBeUndefined()
    expect(remaining()).toBe(0) // no PUT was made
  })

  it('commits when content differs from existing file', async () => {
    setupQueries([row({ failure_number: 'F-N1', status: 'open' })], [], [])
    const { fetch: mockFetch, remaining } = makeMockFetch([
      async () =>
        jsonResponse(200, { sha: 'sha-prev', content: 'b3V0LW9mLWRhdGU=', encoding: 'base64' }),
      async (url, init) => {
        expect(init?.method).toBe('PUT')
        const body = JSON.parse(init?.body as string) as Record<string, unknown>
        expect(body.sha).toBe('sha-prev')
        return jsonResponse(200, { commit: { sha: 'new-commit-sha' } })
      },
    ])
    const res = await exportFailuresMarkdown({ fetchImpl: mockFetch, token: 'tok' })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBeUndefined()
    expect(res.commit_sha).toBe('new-commit-sha')
    expect(remaining()).toBe(0)
  })

  it('creates the file when it does not exist on main (404 path)', async () => {
    setupQueries([row({ failure_number: 'F-N1', status: 'open' })], [], [])
    const { fetch: mockFetch } = makeMockFetch([
      async () => textResponse(404, 'not found'),
      async (_url, init) => {
        const body = JSON.parse(init?.body as string) as Record<string, unknown>
        expect(body.sha).toBeUndefined()
        return jsonResponse(201, { commit: { sha: 'first-commit' } })
      },
    ])
    const res = await exportFailuresMarkdown({ fetchImpl: mockFetch, token: 'tok' })
    expect(res.ok).toBe(true)
    expect(res.commit_sha).toBe('first-commit')
  })

  it('returns error when GITHUB_TOKEN is missing', async () => {
    setupQueries([], [], [])
    const res = await exportFailuresMarkdown({ token: '' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/GITHUB_TOKEN/)
  })

  it('returns error when fetchExistingFile fails', async () => {
    setupQueries([], [], [])
    const { fetch: mockFetch } = makeMockFetch([async () => textResponse(500, 'github down')])
    const res = await exportFailuresMarkdown({ fetchImpl: mockFetch, token: 'tok' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/500/)
  })
})
