/**
 * Integration test — 3 sample PRs through the full Safety Agent v2 pipeline.
 *
 * Per the Sub-phase E execution spec: feed three representative PRs through
 * the runSafetyDecision orchestrator and verify each routes correctly per
 * the v2 risk-routing matrix:
 *
 *   1. Trivial typo PR        → low tier  → auto_merge
 *   2. Medium-risk schema PR  → medium    → twin path (or twin_unavailable)
 *   3. Deliberate secret leak → high      → colin_escalate
 *
 * No mocks of the v2 modules — only the boundaries (DB, fetch, browser).
 * Asserts the FULL outcome: action + tier + score + signal findings.
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

// ── Boundary fakes (DB + twin fetch) ────────────────────────────────

function fakeDb(opts: { configRows?: Array<{ key: string; value: string }> } = {}) {
  const config = opts.configRows ?? []
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
              single: vi.fn(async () => ({ data: { id: 'sd-1' }, error: null })),
            })),
          })),
        }
      }
      return {} as never
    }),
  } as never
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── PR fixtures (representative real-world shapes) ──────────────────

/** PR 1 — Trivial typo. Should score low and auto-merge. */
function trivialTypoPR(): PRDiffInput {
  return {
    unified_diff: [
      '+++ b/app/(cockpit)/page.tsx',
      '+        <p>Welcome back, Colin</p>',
      '--- a/app/(cockpit)/page.tsx',
      '-        <p>Wlecome back, Colin</p>',
    ].join('\n'),
    files_changed: ['app/(cockpit)/page.tsx'],
    loc_added: 1,
    loc_removed: 1,
    migration_files: [],
    new_files: [],
    plan_loc: 5,
    commit_message: 'fix: typo in cockpit greeting',
  }
}

/**
 * PR 2 — Medium-risk additive feature with scope creep.
 *
 * Calibration math (default weights):
 *   base 5 + migration_additive 10 + loc_delta_2x 20 = 35 → medium tier.
 *
 * RLS is correctly added (no destructive +60), so this represents a "well-
 * formed feature PR that grew larger than planned" — exactly the medium-tier
 * case the spec describes ("twin should look at this").
 */
function mediumSchemaPR(): PRDiffInput {
  const sql = `
    CREATE TABLE public.user_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      key TEXT NOT NULL,
      value JSONB
    );
    CREATE INDEX user_preferences_user_idx ON public.user_preferences(user_id);
    ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "user_preferences_owner" ON public.user_preferences
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  `
  return {
    unified_diff: '+++ b/supabase/migrations/0163_user_prefs.sql\n+CREATE TABLE',
    // 8 files touched (a larger-than-planned PR shape).
    files_changed: [
      'supabase/migrations/0163_user_prefs.sql',
      'lib/preferences/store.ts',
      'lib/preferences/types.ts',
      'lib/preferences/queries.ts',
      'app/api/preferences/route.ts',
      'app/(cockpit)/preferences/page.tsx',
      'app/(cockpit)/preferences/_components/Form.tsx',
      'app/(cockpit)/preferences/_components/List.tsx',
    ],
    loc_added: 250, // > 2x plan_loc (100)
    loc_removed: 0,
    migration_files: [{ path: 'supabase/migrations/0163_user_prefs.sql', sql }],
    new_files: [
      'supabase/migrations/0163_user_prefs.sql',
      'lib/preferences/store.ts',
      'lib/preferences/types.ts',
      'lib/preferences/queries.ts',
      'app/api/preferences/route.ts',
    ],
    plan_loc: 100,
    commit_message: 'feat: add user_preferences module',
  }
}

/** PR 3 — Deliberate secret leak. Should hit auto-high path. */
function secretLeakPR(): PRDiffInput {
  // Build the AWS-shaped fake at runtime so this source file doesn't trip
  // GitHub push protection (per F-N15 lesson).
  const fakeAws = 'AKIA' + 'X'.repeat(16)
  return {
    unified_diff: [
      '+++ b/lib/integrations/foo.ts',
      `+const k = "${fakeAws}"`,
      `+const config = { accessKey: k }`,
    ].join('\n'),
    files_changed: ['lib/integrations/foo.ts'],
    loc_added: 2,
    loc_removed: 0,
    migration_files: [],
    new_files: [],
    plan_loc: 10,
    commit_message: 'feat: add foo integration',
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Integration 3-PR — trivial typo', () => {
  it('scores low and routes to auto_merge', async () => {
    const out = await runSafetyDecision(
      {
        commit_sha: 'typo01',
        branch: 'fix/typo',
        pr_number: 9001,
        diff: trivialTypoPR(),
      },
      fakeDb()
    )

    expect(out.tier).toBe('low')
    expect(out.action).toBe('auto_merge')
    expect(out.score.score).toBeLessThanOrEqual(29) // SAFETY_THRESHOLD_LOW_MAX default
    expect(out.findings).toHaveLength(0) // no signal fired
    expect(out.score.secret_auto_high).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled() // twin not consulted on low tier
  })
})

describe('Integration 3-PR — medium-risk additive feature with scope creep', () => {
  it('detects additive migration + LOC creep + new API route, scores medium', async () => {
    const out = await runSafetyDecision(
      {
        commit_sha: 'sch001',
        branch: 'feat/user-prefs',
        pr_number: 9002,
        diff: mediumSchemaPR(),
      },
      fakeDb()
    )

    // Default weights: base 5 + migration_additive 10 + loc_delta_2x 20 +
    // api_route_netnew 15 = 50 → medium tier.
    expect(out.tier).toBe('medium')
    expect(out.findings.some((f) => f.id === 'migration_additive')).toBe(true)
    expect(out.findings.some((f) => f.id === 'loc_delta_2x')).toBe(true)
    expect(out.findings.some((f) => f.id.startsWith('api_route_netnew_'))).toBe(true)
    expect(out.score.secret_auto_high).toBe(false)
    // No missing_rls because the migration includes ENABLE RLS + CREATE POLICY.
    expect(out.findings.some((f) => f.id.startsWith('missing_rls'))).toBe(false)
  })

  it('routes through twin when twin_arbiter_url provided + twin returns proceed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decision: 'proceed', twin_confidence: 0.85 }),
    })

    const out = await runSafetyDecision(
      {
        commit_sha: 'sch001',
        branch: 'feat/user-prefs',
        pr_number: 9002,
        diff: mediumSchemaPR(),
        twin_arbiter_url: 'https://lepios/api/twin/safety-arbitrate',
        cron_secret: 'shh',
      },
      fakeDb()
    )

    expect(out.action).toBe('twin_proceed')
    expect(out.twin_decision).toBe('proceed')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('routes to twin_unavailable when twin URL absent', async () => {
    const out = await runSafetyDecision(
      {
        commit_sha: 'sch001',
        branch: 'feat/user-prefs',
        pr_number: 9002,
        diff: mediumSchemaPR(),
      },
      fakeDb()
    )
    expect(out.action).toBe('twin_unavailable')
    expect(out.twin_decision).toBe(null)
  })
})

describe('Integration 3-PR — deliberate secret leak', () => {
  it('triggers auto-high SECRET_DETECTED short-circuit', async () => {
    const out = await runSafetyDecision(
      {
        commit_sha: 'leak01',
        branch: 'feat/foo-integration',
        pr_number: 9003,
        diff: secretLeakPR(),
        twin_arbiter_url: 'https://lepios/api/twin/safety-arbitrate',
        cron_secret: 'shh',
      },
      fakeDb()
    )

    expect(out.tier).toBe('high')
    expect(out.score.score).toBe(100)
    expect(out.score.secret_auto_high).toBe(true)
    expect(out.action).toBe('colin_escalate')
    // Twin not consulted on high tier — straight to Colin.
    expect(mockFetch).not.toHaveBeenCalled()
    // Secret detection is the only contribution.
    const secretFinding = out.findings.find((f) => f.weight_key === 'SAFETY_WEIGHT_SECRET_DETECTED')
    expect(secretFinding).toBeDefined()
    expect(secretFinding?.id).toBe('aws_access_key')
  })

  it('routes to colin_escalate even with twin and E2E configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decision: 'proceed' }),
    })

    const out = await runSafetyDecision(
      {
        commit_sha: 'leak02',
        branch: 'feat/foo-integration',
        pr_number: 9003,
        diff: secretLeakPR(),
        twin_arbiter_url: 'https://lepios/api/twin/safety-arbitrate',
        cron_secret: 'shh',
      },
      fakeDb()
    )
    expect(out.action).toBe('colin_escalate')
    // Even though we mocked twin to return proceed, it should NOT have been
    // consulted because tier=high short-circuits twin.
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('Integration 3-PR — full-pipeline summary', () => {
  it('all three PRs route to expected actions in one batch', async () => {
    const trivial = await runSafetyDecision(
      { commit_sha: 'a', branch: 'b', diff: trivialTypoPR() },
      fakeDb()
    )
    const schema = await runSafetyDecision(
      { commit_sha: 'a', branch: 'b', diff: mediumSchemaPR() },
      fakeDb()
    )
    const leak = await runSafetyDecision(
      { commit_sha: 'a', branch: 'b', diff: secretLeakPR() },
      fakeDb()
    )

    expect([trivial.action, schema.action, leak.action]).toEqual([
      'auto_merge',
      'twin_unavailable',
      'colin_escalate',
    ])
    expect([trivial.tier, schema.tier, leak.tier]).toEqual(['low', 'medium', 'high'])
  })
})
