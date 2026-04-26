/**
 * Tests for app/api/cron/task-pickup/route.ts
 *
 * Covers P1 (G2): checkPurposeReviewTimeouts is wired and called on every
 * pickup run. Verifies:
 *   - purpose_review_timeouts count included in response
 *   - A timeout task (awaiting_review > 72h) is swept and counted
 *   - A timeout-check failure does not break pickup (caught, returns 0)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock runPickup ────────────────────────────────────────────────────────────

const { mockRunPickup } = vi.hoisted(() => ({ mockRunPickup: vi.fn() }))

vi.mock('@/lib/harness/pickup-runner', () => ({
  runPickup: mockRunPickup,
}))

// ── Mock runStallCheck ────────────────────────────────────────────────────────

const { mockRunStallCheck } = vi.hoisted(() => ({ mockRunStallCheck: vi.fn() }))

vi.mock('@/lib/harness/stall-check', () => ({
  runStallCheck: mockRunStallCheck,
}))

// ── Mock checkPurposeReviewTimeouts ───────────────────────────────────────────

const { mockCheckPurposeReviewTimeouts } = vi.hoisted(() => ({
  mockCheckPurposeReviewTimeouts: vi.fn(),
}))

vi.mock('@/lib/purpose-review/timeout', () => ({
  checkPurposeReviewTimeouts: mockCheckPurposeReviewTimeouts,
}))

import { GET } from '@/app/api/cron/task-pickup/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-pickup-secret'

function makeRequest(secret = CRON_SECRET): Request {
  return new Request('http://localhost/api/cron/task-pickup', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  })
}

const PICKUP_OK = {
  ok: true,
  claimed: true,
  task_id: 'task-uuid-123',
  run_id: 'run-abc',
}

const STALL_OK = {
  alerts_fired: 0,
  alerts_deduped: 0,
  triggers_checked: [],
  errors: [],
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  process.env.TASK_PICKUP_ENABLED = '1'
  mockRunPickup.mockResolvedValue(PICKUP_OK)
  mockRunStallCheck.mockResolvedValue(STALL_OK)
  mockCheckPurposeReviewTimeouts.mockResolvedValue(0)
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TASK_PICKUP_ENABLED
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('GET /api/cron/task-pickup — auth', () => {
  it('returns 401 when Authorization header is wrong', async () => {
    const req = makeRequest('wrong-secret')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ── Purpose review timeout wiring (P1 — G2) ──────────────────────────────────

describe('GET /api/cron/task-pickup — purpose review timeout wiring', () => {
  it('calls checkPurposeReviewTimeouts on every pickup run', async () => {
    await GET(makeRequest())
    expect(mockCheckPurposeReviewTimeouts).toHaveBeenCalledTimes(1)
  })

  it('includes purpose_review_timeouts=0 in response when no timeouts swept', async () => {
    mockCheckPurposeReviewTimeouts.mockResolvedValue(0)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.purpose_review_timeouts).toBe(0)
  })

  it('includes purpose_review_timeouts=N when N tasks were swept', async () => {
    mockCheckPurposeReviewTimeouts.mockResolvedValue(2)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.purpose_review_timeouts).toBe(2)
  })

  it('returns purpose_review_timeouts=0 and does not fail when checkPurposeReviewTimeouts throws', async () => {
    mockCheckPurposeReviewTimeouts.mockRejectedValue(new Error('DB unavailable'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purpose_review_timeouts).toBe(0)
    // Pickup should still complete
    expect(body.ok).toBe(true)
  })

  it('still runs stall check and pickup even if timeout check throws', async () => {
    mockCheckPurposeReviewTimeouts.mockRejectedValue(new Error('boom'))
    await GET(makeRequest())
    expect(mockRunStallCheck).toHaveBeenCalledTimes(1)
    expect(mockRunPickup).toHaveBeenCalledTimes(1)
  })
})

// ── Disabled guard ────────────────────────────────────────────────────────────

describe('GET /api/cron/task-pickup — disabled guard', () => {
  it('returns ok=false when TASK_PICKUP_ENABLED is not set', async () => {
    delete process.env.TASK_PICKUP_ENABLED
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('task-pickup-disabled')
  })
})
