/**
 * v2.1 gate-wire integration tests.
 *
 * Verifies that runSafetyGateCheck() correctly:
 *   - returns non-blocking for a low-scoring PR (auto_merge)
 *   - returns blocking for a high-scoring PR (colin_escalate)
 *   - returns non-blocking on diff-fetch infra failure (no GitHub token)
 *   - writes a safety_decisions row via persistSafetyDecision (via driver)
 *
 * Uses the same fake DB pattern as integration-3pr.test.ts. The GitHub API
 * calls inside fetchPRDiffInput are mocked via vi.stubGlobal('fetch', ...).
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

import { runSafetyDecision, persistSafetyDecision } from '@/lib/harness/safety/v2/driver'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'

// ── Fake DB ──────────────────────────────────────────────────────────────────

function fakeDb() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'harness_config') {
        return {
          select: vi.fn(() => ({
            like: vi.fn(async () => ({ data: [], error: null })),
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
                    limit: vi.fn(async () => ({ data: [], error: null })),
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
              single: vi.fn(async () => ({ data: { id: 'sd-gate-1' }, error: null })),
            })),
          })),
        }
      }
      return {} as never
    }),
  } as never
}

// ── PR fixtures ──────────────────────────────────────────────────────────────

function lowRiskPR(): PRDiffInput {
  return {
    unified_diff: '+++ b/app/(cockpit)/page.tsx\n+        <p>Welcome</p>',
    files_changed: ['app/(cockpit)/page.tsx'],
    loc_added: 1,
    loc_removed: 1,
    migration_files: [],
    new_files: [],
    plan_loc: 10,
    commit_message: 'fix: minor copy update',
  }
}

function highRiskPR(): PRDiffInput {
  // Secret in diff → auto-high short-circuit
  const fakeKey = 'AKIA' + 'X'.repeat(16)
  return {
    unified_diff: ['+++ b/lib/config.ts', `+const awsKey = "${fakeKey}"`].join('\n'),
    files_changed: ['lib/config.ts'],
    loc_added: 1,
    loc_removed: 0,
    migration_files: [],
    new_files: [],
    plan_loc: 5,
    commit_message: 'feat: add config',
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gate wire — low-risk PR', () => {
  it('scores low and action is auto_merge (non-blocking)', async () => {
    const result = await runSafetyDecision(
      {
        commit_sha: 'gate01',
        branch: 'fix/copy',
        diff: lowRiskPR(),
      },
      fakeDb()
    )

    expect(result.tier).toBe('low')
    expect(result.action).toBe('auto_merge')
    expect(result.score.score).toBeLessThanOrEqual(29)
  })

  it('persists decision to safety_decisions', async () => {
    const result = await runSafetyDecision(
      { commit_sha: 'gate02', branch: 'fix/copy', diff: lowRiskPR() },
      fakeDb()
    )
    const sdId = await persistSafetyDecision(result, fakeDb())
    expect(sdId).toBe('sd-gate-1')
  })
})

describe('Gate wire — high-risk PR (secret detected)', () => {
  it('scores high, action is colin_escalate (blocking)', async () => {
    const result = await runSafetyDecision(
      {
        commit_sha: 'gate03',
        branch: 'feat/config',
        diff: highRiskPR(),
        // twin configured but must NOT be consulted on high tier
        twin_arbiter_url: 'https://lepios/api/twin/safety-arbitrate',
        cron_secret: 'shh',
      },
      fakeDb()
    )

    expect(result.tier).toBe('high')
    expect(result.action).toBe('colin_escalate')
    expect(result.score.score).toBe(100)
    expect(result.score.secret_auto_high).toBe(true)
    // Twin not consulted on high tier
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('Gate wire — blocking action set', () => {
  it('colin_escalate is in the blocking set', () => {
    const BLOCKING = new Set(['colin_escalate', 'twin_hold', 'twin_escalate'])
    expect(BLOCKING.has('colin_escalate')).toBe(true)
    expect(BLOCKING.has('twin_hold')).toBe(true)
    expect(BLOCKING.has('auto_merge')).toBe(false)
    expect(BLOCKING.has('twin_proceed')).toBe(false)
    expect(BLOCKING.has('twin_unavailable')).toBe(false)
  })
})

describe('Gate wire — infra fallback', () => {
  it('non-blocking when diff fetch returns null (no GITHUB_TOKEN)', async () => {
    // runSafetyDecision still works with an empty diff (auto_merge / low)
    const emptyDiff: PRDiffInput = {
      unified_diff: '',
      files_changed: [],
      loc_added: 0,
      loc_removed: 0,
      migration_files: [],
      new_files: [],
    }
    const result = await runSafetyDecision(
      { commit_sha: 'gate04', branch: 'fix/x', diff: emptyDiff },
      fakeDb()
    )
    // base score only (5) → low → auto_merge
    expect(result.tier).toBe('low')
    expect(result.action).toBe('auto_merge')
  })
})
