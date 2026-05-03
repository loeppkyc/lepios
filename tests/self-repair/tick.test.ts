/**
 * tests/self-repair/tick.test.ts
 *
 * Spec acceptance: §C (daily cap fires when exceeded)
 * Tests the POST /api/harness/self-repair-tick route.
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

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/harness/self-repair/detector', () => ({
  detectNextFailure: vi.fn(),
  releaseDetectorLock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/harness/self-repair/context', () => ({
  gatherContext: vi.fn(),
}))

vi.mock('@/lib/harness/self-repair/drafter', () => ({
  draftFix: vi.fn(),
}))

vi.mock('@/lib/harness/self-repair/verifier', () => ({
  verifyDraft: vi.fn(),
}))

vi.mock('@/lib/harness/self-repair/pr-opener', () => ({
  openPR: vi.fn(),
}))

vi.mock('@/lib/harness/arms-legs', () => ({
  telegram: vi.fn().mockResolvedValue({ ok: true }),
}))

// ── import mocked modules ─────────────────────────────────────────────────────

import { detectNextFailure, releaseDetectorLock } from '@/lib/harness/self-repair/detector'
import { gatherContext } from '@/lib/harness/self-repair/context'
import { draftFix } from '@/lib/harness/self-repair/drafter'
import { verifyDraft } from '@/lib/harness/self-repair/verifier'
import { openPR } from '@/lib/harness/self-repair/pr-opener'

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

function makeMockRequest(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Request
}

// Set CRON_SECRET for auth to pass
const CRON_SECRET = 'test-cron-secret-tick'

// ── import route under test ───────────────────────────────────────────────────

import { POST } from '@/app/api/harness/self-repair-tick/route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

function makeRequest() {
  return makeMockRequest({
    authorization: `Bearer ${CRON_SECRET}`,
  }) as unknown as import('next/server').NextRequest
}

// ── Returns 200 no-op when feature flag disabled ──────────────────────────────

describe('self-repair-tick: feature flag', () => {
  it('returns reason=SELF_REPAIR_ENABLED when flag is not true', async () => {
    mockFrom.mockReturnValueOnce(makeChain({ data: { value: 'false' }, error: null })) // SELF_REPAIR_ENABLED

    const req = makeRequest()
    const res = await POST(req)
    const body = (await res.json()) as { ok: boolean; reason: string }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.reason).toContain('SELF_REPAIR_ENABLED')
  })
})

// ── AC-C: daily cap exceeded ──────────────────────────────────────────────────

describe('AC-C: daily cap exceeded', () => {
  it('returns reason=daily_cap_exceeded, logs agent_event, sends Telegram', async () => {
    const { telegram } = await import('@/lib/harness/arms-legs')

    mockFrom
      .mockReturnValueOnce(makeChain({ data: { value: 'true' }, error: null })) // SELF_REPAIR_ENABLED
      .mockReturnValueOnce(makeChain({ data: { value: '3' }, error: null })) // SELF_REPAIR_DAILY_CAP
      .mockReturnValueOnce(makeChain({ count: 3, data: null, error: null })) // cap check count
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // agent_events insert

    const req = makeRequest()
    const res = await POST(req)
    const body = (await res.json()) as { ok: boolean; reason: string; cap: number }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.reason).toBe('daily_cap_exceeded')
    expect(body.cap).toBe(3)

    // Should NOT have called detectNextFailure
    expect(detectNextFailure).not.toHaveBeenCalled()

    // Should have sent Telegram notification
    expect(telegram).toHaveBeenCalled()
  })

  it('returns no_failure_detected when cap is not exceeded and no failure found', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: { value: 'true' }, error: null })) // SELF_REPAIR_ENABLED
      .mockReturnValueOnce(makeChain({ data: { value: '3' }, error: null })) // SELF_REPAIR_DAILY_CAP
      .mockReturnValueOnce(makeChain({ count: 0, data: null, error: null })) // cap check count (not exceeded)

    vi.mocked(detectNextFailure).mockResolvedValueOnce(null)

    const req = makeRequest()
    const res = await POST(req)
    const body = (await res.json()) as { ok: boolean; reason: string }

    expect(body.ok).toBe(true)
    expect(body.reason).toBe('no_failure_detected')
  })
})

// ── Auth gate ─────────────────────────────────────────────────────────────────

describe('self-repair-tick: auth gate', () => {
  it('returns 401 for missing authorization header', async () => {
    const req = makeMockRequest({}) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong secret', async () => {
    const req = makeMockRequest({
      authorization: 'Bearer wrong-secret',
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
