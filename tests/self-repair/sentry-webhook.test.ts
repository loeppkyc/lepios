/**
 * tests/self-repair/sentry-webhook.test.ts
 *
 * Unit tests for app/api/webhooks/sentry/route.ts
 * Covers all 9 acceptance criteria (AC-1 through AC-9).
 *
 * No real Sentry API calls. Mock createServiceClient to avoid DB access.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Import route handler (after mocks) ────────────────────────────────────────

import { POST } from '@/app/api/webhooks/sentry/route'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-sentry-secret-abc'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHmac(body: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function makeIssuePayload(overrides: { action?: string; level?: string } = {}): object {
  return {
    action: overrides.action ?? 'created',
    data: {
      issue: {
        id: '1234567890',
        title: 'TypeError: Cannot read properties of undefined',
        culprit: 'lib/harness/push-bash/executor.ts in executeDecision',
        shortId: 'LEPIOS-42',
        level: overrides.level ?? 'error',
        platform: 'node',
        permalink: 'https://sentry.io/organizations/lepios/issues/1234567890/',
        project: {
          id: 'proj-1',
          name: 'lepios',
          slug: 'lepios',
        },
      },
    },
  }
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/sentry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SENTRY_WEBHOOK_SECRET = TEST_SECRET
  mockInsert.mockResolvedValue({ data: null, error: null })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/sentry', () => {
  // AC-1: Missing SENTRY_WEBHOOK_SECRET → 500
  it('AC-1: returns 500 when SENTRY_WEBHOOK_SECRET is not set', async () => {
    delete process.env.SENTRY_WEBHOOK_SECRET

    const body = JSON.stringify(makeIssuePayload())
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  // AC-2: Bad signature → 403
  it('AC-2: returns 403 when signature is wrong', async () => {
    const body = JSON.stringify(makeIssuePayload())
    const req = makeRequest(body, { 'sentry-hook-signature': 'abc123wrongsignature' })
    const res = await POST(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  // AC-3: Missing signature header → 403
  it('AC-3: returns 403 when sentry-hook-signature header is absent', async () => {
    const body = JSON.stringify(makeIssuePayload())
    const req = makeRequest(body) // no signature header
    const res = await POST(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  // AC-4: action !== 'created' → 200, no DB write
  it('AC-4: skips and does not write DB when action is not "created"', async () => {
    const body = JSON.stringify(makeIssuePayload({ action: 'resolved' }))
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, skipped: true })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  // AC-5: level === 'warning' → 200, no DB write
  it('AC-5: skips and does not write DB when level is "warning"', async () => {
    const body = JSON.stringify(makeIssuePayload({ action: 'created', level: 'warning' }))
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, skipped: true })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  // AC-6: level === 'error', action === 'created' → 200, agent_events written
  it('AC-6: writes agent_events row when action=created and level=error', async () => {
    const body = JSON.stringify(makeIssuePayload({ action: 'created', level: 'error' }))
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(mockInsert).toHaveBeenCalledTimes(1)

    const [insertArg] = mockInsert.mock.calls[0] as [Record<string, unknown>]
    expect(insertArg.action).toBe('sentry_error')
    expect(insertArg.status).toBe('error')

    const meta = insertArg.meta as Record<string, unknown>
    expect(meta).toHaveProperty('sentry_issue_id', '1234567890')
    expect(meta).toHaveProperty('title', 'TypeError: Cannot read properties of undefined')
    expect(meta).toHaveProperty('culprit', 'lib/harness/push-bash/executor.ts in executeDecision')
    expect(meta).toHaveProperty(
      'permalink',
      'https://sentry.io/organizations/lepios/issues/1234567890/'
    )
    expect(meta).toHaveProperty('project_slug', 'lepios')
  })

  // AC-7: level === 'fatal', action === 'created' → 200, agent_events written
  it('AC-7: writes agent_events row when action=created and level=fatal', async () => {
    const body = JSON.stringify(makeIssuePayload({ action: 'created', level: 'fatal' }))
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    expect(mockInsert).toHaveBeenCalledTimes(1)
    const [insertArg] = mockInsert.mock.calls[0] as [Record<string, unknown>]
    expect(insertArg.action).toBe('sentry_error')
    expect(insertArg.status).toBe('error')
  })

  // AC-8: DB write failure → still returns 200
  it('AC-8: returns 200 even when DB insert throws', async () => {
    mockInsert.mockRejectedValue(new Error('DB connection refused'))

    const body = JSON.stringify(makeIssuePayload({ action: 'created', level: 'error' }))
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
  })

  // AC-9: Invalid JSON body → 400
  it('AC-9: returns 400 when body is not valid JSON', async () => {
    const body = 'not json'
    const req = makeRequest(body, { 'sentry-hook-signature': makeHmac(body) })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
