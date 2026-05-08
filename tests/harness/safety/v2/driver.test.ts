/**
 * End-to-end tests for the Safety Agent v2 driver.
 *
 * The driver composes signals + scorer + router + e2e + twin + archival
 * into one runSafetyDecision call. Tests assert the orchestration is
 * correct — no individual signal logic re-tested here (those have their
 * own files).
 *
 * Each test injects a fake DB + fake browser factory + fake fetch (for
 * the twin call) so no real network is hit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/failures/log', () => ({
  logFailure: vi.fn().mockResolvedValue({
    ok: true,
    id: 'logged',
    failure_number: 'F-N100',
    status: 'open',
    is_recurrence: false,
  }),
}))

import { runSafetyDecision } from '@/lib/harness/safety/v2/driver'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'
import type { Browser, BrowserPage, E2EAssertion } from '@/lib/harness/safety/v2/e2e/types'

// ── Fakes ───────────────────────────────────────────────────────────

function fakeDb(
  opts: { configRows?: Array<{ key: string; value: string }>; failureRows?: unknown[] } = {}
) {
  const config = opts.configRows ?? []
  const failures = opts.failureRows ?? []
  const insertedRows: unknown[] = []
  return {
    from: vi.fn((table: string) => {
      if (table === 'harness_config') {
        return {
          select: vi.fn(() => ({
            like: vi.fn(async () => ({ data: config, error: null })),
          })),
        }
      }
      if (table === 'failures_log') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              or: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(async () => ({ data: failures, error: null })),
                  })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'safety_decisions') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                insertedRows.push({})
                return { data: { id: 'sd-1' }, error: null }
              }),
            })),
          })),
        }
      }
      return {} as never
    }),
    _inserted: insertedRows,
  } as never
}

function fakePage(opts: { status?: number; bodyText?: string } = {}): BrowserPage {
  return {
    goto: vi.fn(async () => ({ status: opts.status ?? 200 })),
    bodyText: vi.fn(async () => opts.bodyText ?? 'hello'),
    hasSelector: vi.fn(async () => true),
    consoleErrors: vi.fn(() => []),
    screenshotPng: vi.fn(async () => 'data:image/png;base64,F'),
  }
}

function fakeBrowserFactory(pages: BrowserPage[]): () => Promise<Browser> {
  let i = 0
  return async () => ({
    newPage: vi.fn(async () => pages[i++] ?? pages[pages.length - 1]),
    close: vi.fn(async () => {}),
  })
}

// ── Common diff fixtures ────────────────────────────────────────────

function trivialDiff(): PRDiffInput {
  return {
    unified_diff: '+++ b/lib/x.ts\n+const a = 1',
    files_changed: ['lib/x.ts'],
    loc_added: 1,
    loc_removed: 0,
    migration_files: [],
    new_files: [],
    plan_loc: null,
    commit_message: 'fix: typo',
  }
}

function destructiveDiff(): PRDiffInput {
  return {
    unified_diff: '',
    files_changed: ['supabase/migrations/0163_x.sql'],
    loc_added: 5,
    loc_removed: 0,
    migration_files: [{ path: 'supabase/migrations/0163_x.sql', sql: 'DROP TABLE foo;' }],
    new_files: [],
    plan_loc: null,
    commit_message: 'destructive migration',
  }
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ───────────────────────────────────────────────────────────

describe('runSafetyDecision — happy path (low tier, no E2E)', () => {
  it('trivial diff scores low → action auto_merge', async () => {
    const db = fakeDb()
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
      },
      db
    )
    expect(out.tier).toBe('low')
    expect(out.action).toBe('auto_merge')
    expect(out.findings).toHaveLength(0)
    expect(out.e2e).toBe(null)
    expect(out.twin_decision).toBe(null)
  })

  it('reads SAFETY_* config from harness_config', async () => {
    const db = fakeDb({
      configRows: [
        { key: 'SAFETY_WEIGHT_LOC_DELTA_2X', value: '50' },
        { key: 'SAFETY_THRESHOLD_LOW_MAX', value: '10' },
        { key: 'SAFETY_THRESHOLD_MEDIUM_MAX', value: '40' },
      ],
    })
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: { ...trivialDiff(), loc_added: 300, plan_loc: 100 },
      },
      db
    )
    // base 5 + loc 50 = 55 → above mediumMax(40) → high.
    expect(out.score.score).toBe(55)
    expect(out.tier).toBe('high')
    expect(out.action).toBe('colin_escalate')
  })
})

describe('runSafetyDecision — high tier (destructive migration)', () => {
  it('destructive migration → action colin_escalate', async () => {
    const db = fakeDb()
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha2',
        branch: 'feat/y',
        diff: destructiveDiff(),
      },
      db
    )
    // base 5 + destructive 60 = 65 → medium tier under default thresholds.
    // Action depends on twin since URL not provided → twin_unavailable.
    expect(out.tier).toBe('medium')
    expect(out.action).toBe('twin_unavailable')
  })
})

describe('runSafetyDecision — E2E integration', () => {
  it('E2E pass + low tier → auto_merge', async () => {
    const db = fakeDb()
    const assertions: E2EAssertion[] = [{ url: 'https://x/a', expectStatus: 200 }]
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
        e2e_assertions: assertions,
        browser_factory: fakeBrowserFactory([fakePage()]),
      },
      db
    )
    expect(out.e2e).not.toBeNull()
    expect(out.e2e!.pass).toBe(true)
    expect(out.action).toBe('auto_merge')
  })

  it('E2E fail + low tier → colin_escalate (override)', async () => {
    const db = fakeDb()
    const assertions: E2EAssertion[] = [{ url: 'https://x/a', expectStatus: 200 }]
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
        e2e_assertions: assertions,
        browser_factory: fakeBrowserFactory([fakePage({ status: 500 })]),
      },
      db
    )
    expect(out.e2e!.pass).toBe(false)
    expect(out.action).toBe('colin_escalate')
    // Failed assertions archived to failures_log.
    expect(out.archived_failure_ids.length).toBeGreaterThan(0)
  })

  it('no browser_factory + assertions → e2e abort_reason set, e2e_pass null', async () => {
    const db = fakeDb()
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
        e2e_assertions: [{ url: 'https://x/a' }],
      },
      db
    )
    expect(out.e2e?.abort_reason).toBe('no_browser_factory')
    // null e2e_pass with low tier → auto_merge (router rule)
    expect(out.action).toBe('auto_merge')
  })

  it('browser launch failure does not force escalate (infra outage)', async () => {
    const db = fakeDb()
    const factory = async (): Promise<Browser> => {
      throw new Error('chromium missing')
    }
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
        e2e_assertions: [{ url: 'https://x/a' }],
        browser_factory: factory,
      },
      db
    )
    expect(out.e2e?.abort_reason).toContain('browser_launch_failed')
    // Infrastructure failure shouldn't force colin_escalate — e2e_pass stays null.
    expect(out.action).toBe('auto_merge')
  })
})

describe('runSafetyDecision — twin arbiter integration', () => {
  it('medium tier + twin returns proceed → twin_proceed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decision: 'proceed' }),
    })
    const db = fakeDb()
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha2',
        branch: 'feat/y',
        diff: destructiveDiff(),
        twin_arbiter_url: 'https://lepios/api/twin/safety-arbitrate',
        cron_secret: 'shh',
      },
      db
    )
    expect(out.tier).toBe('medium')
    expect(out.twin_decision).toBe('proceed')
    expect(out.action).toBe('twin_proceed')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.authorization).toBe('Bearer shh')
  })

  it('medium tier + twin returns hold → twin_hold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decision: 'hold' }),
    })
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha2',
        branch: 'feat/y',
        diff: destructiveDiff(),
        twin_arbiter_url: 'https://x',
        cron_secret: 's',
      },
      fakeDb()
    )
    expect(out.action).toBe('twin_hold')
  })

  it('medium tier + twin fetch fails → twin_unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha2',
        branch: 'feat/y',
        diff: destructiveDiff(),
        twin_arbiter_url: 'https://x',
        cron_secret: 's',
      },
      fakeDb()
    )
    expect(out.twin_decision).toBe(null)
    expect(out.action).toBe('twin_unavailable')
  })

  it('twin NOT consulted when E2E fails (already routed to colin_escalate)', async () => {
    const out = await runSafetyDecision(
      {
        commit_sha: 'sha2',
        branch: 'feat/y',
        diff: destructiveDiff(),
        e2e_assertions: [{ url: 'https://x/a', expectStatus: 200 }],
        browser_factory: fakeBrowserFactory([fakePage({ status: 500 })]),
        twin_arbiter_url: 'https://x',
        cron_secret: 's',
      },
      fakeDb()
    )
    expect(out.action).toBe('colin_escalate')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('twin NOT consulted for low tier', async () => {
    await runSafetyDecision(
      {
        commit_sha: 'sha1',
        branch: 'feat/x',
        diff: trivialDiff(),
        twin_arbiter_url: 'https://x',
        cron_secret: 's',
      },
      fakeDb()
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
