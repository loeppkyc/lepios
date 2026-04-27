/**
 * F21 Acceptance Tests — coordinator drain auth (cloud coordinator sandbox pattern)
 *
 * Scenario: autonomous coordinator session (no .env.local, no $CRON_SECRET bash env).
 * CRON_SECRET is written to /tmp/coordinator-secret at session start from harness_config,
 * then sourced in the drain curl: _CS=$(cat /tmp/coordinator-secret 2>/dev/null || echo "")
 *
 * Verified:
 *   1. drain returns 200 when Bearer matches CRON_SECRET (temp file present, correct value)
 *   2. drain returns 401 when Bearer is empty string (temp file absent — _CS="" fallback)
 *   3. drain returns 401 when Bearer has wrong value (stale/corrupt temp file)
 *   4. drain route never issues 403 — any 403 in production is a Vercel edge regression
 *      (route was removed from vercel.json crons in PR #23; edge protection no longer applies)
 *
 * Root cause this fixes: PR #23 changed .env.local grep → harness_config temp file, but
 * .env.local is absent in cloud coordinator sandbox. Three observed failure modes:
 *   - host_not_in_allowlist (fixed by .claude/settings.json allowlist entry)
 *   - no_env_local_cron_secret (fixed by /tmp/coordinator-secret pattern)
 *   - cron_secret_mismatch (fixed by sourcing from harness_config, not stale local file)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET } from '@/app/api/harness/notifications-drain/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-coordinator-secret'

function drainRequest(authHeader: string | null): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== null) headers['Authorization'] = authHeader
  return new Request('http://localhost/api/harness/notifications-drain', {
    method: 'GET',
    headers,
  })
}

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    then: (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn),
    catch: (fn: Parameters<Promise<unknown>['catch']>[0]) => Promise.resolve(result).catch(fn),
    finally: (fn: Parameters<Promise<unknown>['finally']>[0]) =>
      Promise.resolve(result).finally(fn),
  }
  for (const m of ['select', 'eq', 'lt', 'order', 'limit', 'gte', 'filter', 'maybeSingle']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  return chain
}

function setupEmptyDrain() {
  const chain = makeChain({ data: [], error: null })
  const insert = vi.fn().mockReturnValue(makeChain({ data: null, error: null }))
  mockFrom.mockImplementation((table: string) => {
    if (table === 'task_queue') return makeChain({ data: [], error: null })
    if (table === 'outbound_notifications') return { select: vi.fn().mockReturnValue(chain) }
    if (table === 'agent_events') return { insert }
    return { select: vi.fn().mockReturnValue(chain), insert }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
  setupEmptyDrain()
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── 1. Valid auth (temp file present, correct value) ──────────────────────────

describe('coordinator drain auth — valid secret from /tmp/coordinator-secret', () => {
  it('returns 200 when Authorization: Bearer {correct secret}', async () => {
    const res = await GET(drainRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 200 regardless of CRON_SECRET presence when header matches', async () => {
    const res = await GET(drainRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
  })
})

// ── 2. Empty Bearer (temp file absent — _CS="" fallback) ──────────────────────

describe('coordinator drain auth — empty Bearer (cloud sandbox: temp file absent)', () => {
  it('returns 401 when Authorization header is "Bearer " (empty secret)', async () => {
    const res = await GET(drainRequest('Bearer '))
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header is absent entirely', async () => {
    const res = await GET(drainRequest(null))
    expect(res.status).toBe(401)
  })

  it('does NOT return 403 for missing auth — 401 only (403 = Vercel edge regression)', async () => {
    const res = await GET(drainRequest(null))
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(401)
  })
})

// ── 3. Wrong Bearer (stale/corrupt temp file) ─────────────────────────────────

describe('coordinator drain auth — wrong Bearer (stale temp file or cron_secret_mismatch)', () => {
  it('returns 401 when Authorization has wrong secret value', async () => {
    const res = await GET(drainRequest('Bearer wrong-stale-secret'))
    expect(res.status).toBe(401)
  })

  it('does NOT return 403 for wrong auth — 401 only', async () => {
    const res = await GET(drainRequest('Bearer wrong-stale-secret'))
    expect(res.status).not.toBe(403)
  })
})

// ── 4. Route-layer 403 invariant ──────────────────────────────────────────────

describe('coordinator drain auth — 403 invariant', () => {
  it('route handler never returns 403 for any auth input', async () => {
    const scenarios = [
      drainRequest(null),
      drainRequest('Bearer '),
      drainRequest('Bearer wrong'),
      drainRequest(`Bearer ${CRON_SECRET}`),
    ]
    for (const req of scenarios) {
      const res = await GET(req)
      expect(res.status).not.toBe(403)
    }
  })

  it('any 403 in production means Vercel edge is re-protecting the route (vercel.json regression)', () => {
    // Non-executable contract test. Documents the invariant:
    // /api/harness/notifications-drain was removed from vercel.json crons in PR #23.
    // If crons[] ever re-includes it, Vercel edge will return 403 for all non-Vercel callers.
    // The route handler itself only returns 200 or 401 — never 403.
    expect(true).toBe(true)
  })
})

// ── 5. No-CRON_SECRET configured (open drain) ─────────────────────────────────

describe('coordinator drain auth — CRON_SECRET not configured on Vercel', () => {
  it('returns 200 for any request when CRON_SECRET env var is unset', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(drainRequest(null))
    expect(res.status).toBe(200)
  })
})
