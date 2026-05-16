/**
 * Unit tests for app/api/webhooks/square/route.ts
 * Covers: signature verification, payment.completed insert, idempotency,
 * missing env var → 503, bad signature → 403, other event types → skipped.
 *
 * B5 acceptance criteria:
 *   1. 503 when SQUARE_WEBHOOK_SIGNATURE_KEY is absent
 *   2. 403 on bad signature — never silently drops
 *   3. payment.completed → INSERT into local_sales, returns { inserted: true }
 *   4. Duplicate square_payment_id → 200 (not 409), ON CONFLICT DO NOTHING
 *   5. Other event types → 200 { received: true, skipped: true }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/webhooks/square/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_KEY = 'test-square-signature-key-abc123'
// Must match the URL constructed in route.ts when NEXT_PUBLIC_APP_URL is unset
const WEBHOOK_URL = 'https://lepios-one.vercel.app/api/webhooks/square'

function makeSignature(key: string, rawBody: string): string {
  return crypto
    .createHmac('sha256', key)
    .update(WEBHOOK_URL + rawBody)
    .digest('base64')
}

function makePaymentCompletedBody(overrides: Record<string, unknown> = {}): string {
  const base = {
    event_type: 'payment.completed',
    data: {
      object: {
        payment: {
          id: 'sq-payment-001',
          amount_money: { amount: 1500, currency: 'CAD' }, // $15.00
          tender: [{ type: 'CARD' }],
          location_id: 'LHCD123',
          created_at: '2026-05-16T18:00:00Z',
          ...overrides,
        },
      },
    },
  }
  return JSON.stringify(base)
}

function makeRequest(body: string, headerOverrides: Record<string, string> = {}): Request {
  const sig = makeSignature(TEST_KEY, body)
  return new Request('http://localhost/api/webhooks/square', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-square-hmacsha256-signature': sig,
      ...headerOverrides,
    },
    body,
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = TEST_KEY
  process.env.NEXT_PUBLIC_APP_URL = undefined as unknown as string

  // Default: insert succeeds
  const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  mockFrom.mockReturnValue({ insert: insertFn })
})

afterEach(() => {
  delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  delete process.env.NEXT_PUBLIC_APP_URL
})

// ── AC4: Missing env var → 503 ────────────────────────────────────────────────

describe('POST /api/webhooks/square — env var absent', () => {
  it('returns 503 when SQUARE_WEBHOOK_SIGNATURE_KEY is not set', async () => {
    delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('Square webhook not configured')
  })
})

// ── AC2: Signature verification → 403 on mismatch ────────────────────────────

describe('POST /api/webhooks/square — signature verification', () => {
  it('returns 403 when signature header is absent', async () => {
    const body = makePaymentCompletedBody()
    const req = makeRequest(body, { 'x-square-hmacsha256-signature': '' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when signature does not match', async () => {
    const body = makePaymentCompletedBody()
    const req = makeRequest(body, { 'x-square-hmacsha256-signature': 'bad-sig-base64==' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when body is tampered after signing', async () => {
    const body = makePaymentCompletedBody()
    const tamperedBody = body.replace('CARD', 'CASH')
    // Use the original body's signature but tampered body content
    const originalSig = makeSignature(TEST_KEY, body)
    const req = new Request('http://localhost/api/webhooks/square', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-hmacsha256-signature': originalSig,
      },
      body: tamperedBody,
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 200 when signature is valid', async () => {
    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── AC5: Other event types → skipped ─────────────────────────────────────────

describe('POST /api/webhooks/square — non-payment.completed events', () => {
  it('returns 200 with skipped:true for payment.created events', async () => {
    const body = JSON.stringify({ event_type: 'payment.created' })
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received).toBe(true)
    expect(json.skipped).toBe(true)
  })

  it('does not insert a DB row for skipped events', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = JSON.stringify({ event_type: 'refund.created' })
    const req = makeRequest(body)
    await POST(req)
    expect(insertFn).not.toHaveBeenCalled()
  })
})

// ── AC3: payment.completed → INSERT ──────────────────────────────────────────

describe('POST /api/webhooks/square — payment.completed', () => {
  it('returns 200 with inserted:true on success', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received).toBe(true)
    expect(json.inserted).toBe(true)
  })

  it('inserts into local_sales with correct fields', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('local_sales')
    expect(insertFn).toHaveBeenCalledOnce()
    const row = insertFn.mock.calls[0][0]
    expect(row.square_payment_id).toBe('sq-payment-001')
    expect(row.amount_cad).toBe(15) // 1500 cents / 100
    expect(row.currency).toBe('CAD')
    expect(row.payment_method).toBe('CARD')
    expect(row.location_id).toBe('LHCD123')
    expect(row.square_created_at).toBe('2026-05-16T18:00:00Z')
    expect(row.person_handle).toBe('colin')
  })

  it('stores raw_event as jsonb for debugging', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    await POST(req)

    const row = insertFn.mock.calls[0][0]
    expect(row.raw_event).toBeDefined()
    expect(row.raw_event.event_type).toBe('payment.completed')
  })

  it('converts CASH tender type to CASH payment_method', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody({ tender: [{ type: 'CASH' }] })
    const req = makeRequest(body)
    await POST(req)

    const row = insertFn.mock.calls[0][0]
    expect(row.payment_method).toBe('CASH')
  })

  it('maps unknown tender type to OTHER', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody({ tender: [{ type: 'WALLET' }] })
    const req = makeRequest(body)
    await POST(req)

    const row = insertFn.mock.calls[0][0]
    expect(row.payment_method).toBe('OTHER')
  })

  it('handles missing tender array — defaults to OTHER', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody({ tender: undefined })
    const req = makeRequest(body)
    await POST(req)

    const row = insertFn.mock.calls[0][0]
    expect(row.payment_method).toBe('OTHER')
  })
})

// ── AC3 idempotency: duplicate square_payment_id → 200 (not 409) ──────────────

describe('POST /api/webhooks/square — duplicate payment idempotency', () => {
  it('returns 200 (not 409) when Postgres returns unique_violation (23505)', async () => {
    const insertFn = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received).toBe(true)
    expect(json.duplicate).toBe(true)
  })

  it('does not throw on duplicate — second delivery is safe', async () => {
    let callCount = 0
    const insertFn = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: null, error: null })
      return Promise.resolve({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      })
    })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    // First delivery
    await POST(makeRequest(body))
    // Second delivery (Square retry)
    const res = await POST(makeRequest(body))

    expect(res.status).toBe(200)
  })
})

// ── F15: .trim() on signature key ─────────────────────────────────────────────

describe('POST /api/webhooks/square — F15 key whitespace tolerance', () => {
  it('still verifies correctly when env key has trailing whitespace (Vercel CLI stdin issue)', async () => {
    // Simulate Vercel CLI stdin adding trailing \r\n to the stored value
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = TEST_KEY + '\r\n'

    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const body = makePaymentCompletedBody()
    // Signature computed with CLEAN key (as Square would compute it)
    const cleanSig = makeSignature(TEST_KEY, body)
    const req = new Request('http://localhost/api/webhooks/square', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-hmacsha256-signature': cleanSig,
      },
      body,
    })

    const res = await POST(req)
    // Route trims the env key before computing HMAC, so this should match
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inserted).toBe(true)
  })
})
