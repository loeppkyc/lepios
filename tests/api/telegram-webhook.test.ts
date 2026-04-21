/**
 * Unit tests for app/api/telegram/webhook/route.ts (skeleton).
 * Covers auth, user-id allowlist, callback_query routing, and agent_events logging.
 * task_feedback writes are not yet implemented — added next session.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock telegram-buttons ─────────────────────────────────────────────────────

const { mockIsAllowedUser, mockParseCallbackData } = vi.hoisted(() => ({
  mockIsAllowedUser: vi.fn(),
  mockParseCallbackData: vi.fn(),
}))

vi.mock('@/lib/harness/telegram-buttons', () => ({
  isAllowedUser: mockIsAllowedUser,
  parseCallbackData: mockParseCallbackData,
}))

// ── Mock Supabase (agent_events insert) ───────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/telegram/webhook/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-webhook-secret-abc123'
const VALID_USER_ID = 987654321
const VALID_UUID = '885ff1e3-baed-4512-8e7a-8335995ea057'

function makeRequest(body: object, headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': VALID_SECRET,
      ...headerOverrides,
    },
    body: JSON.stringify(body),
  })
}

function makeCallbackUpdate(data: string, fromId = VALID_USER_ID) {
  return {
    update_id: 1,
    callback_query: {
      id: 'cq-id-001',
      from: { id: fromId, username: 'colinl' },
      message: { message_id: 42, chat: { id: 111 } },
      data,
    },
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  mockIsAllowedUser.mockReturnValue(true)
  mockParseCallbackData.mockReturnValue({ action: 'up', agentEventId: VALID_UUID })
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ data: null, error: null }) })
  // answerCallbackQuery calls fetch
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
})

// ── Auth — webhook secret ─────────────────────────────────────────────────────

describe('POST /api/telegram/webhook — auth', () => {
  it('returns 403 when secret header is absent', async () => {
    const req = makeRequest({ update_id: 1 }, { 'x-telegram-bot-api-secret-token': '' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when secret header does not match', async () => {
    const req = makeRequest({ update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when TELEGRAM_WEBHOOK_SECRET env var is not set', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const req = makeRequest({ update_id: 1 }, { 'x-telegram-bot-api-secret-token': VALID_SECRET })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('does not write agent_events on unauthorized requests', async () => {
    const req = makeRequest({ update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'wrong' })
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Non-callback_query updates ────────────────────────────────────────────────

describe('POST /api/telegram/webhook — non-callback_query', () => {
  it('returns 200 and drops message updates', async () => {
    const req = makeRequest({ update_id: 1, message: { text: 'hello' } })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('does not call isAllowedUser on non-callback updates', async () => {
    const req = makeRequest({ update_id: 1, message: { text: 'hello' } })
    await POST(req)
    expect(mockIsAllowedUser).not.toHaveBeenCalled()
  })
})

// ── User ID allowlist ─────────────────────────────────────────────────────────

describe('POST /api/telegram/webhook — user ID allowlist', () => {
  it('returns 403 when user is not allowed', async () => {
    mockIsAllowedUser.mockReturnValue(false)
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`, 99999))
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('calls answerCallbackQuery even when user is rejected (clears spinner)', async () => {
    mockIsAllowedUser.mockReturnValue(false)
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
  })

  it('does not write agent_events when user is rejected', async () => {
    mockIsAllowedUser.mockReturnValue(false)
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Valid callback_query — happy path ─────────────────────────────────────────

describe('POST /api/telegram/webhook — valid callback_query', () => {
  it('returns 200 for authorized tap with valid callback_data', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('calls answerCallbackQuery with the callback_query id', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
    const body = JSON.parse(answerCall![1]!.body as string)
    expect(body.callback_query_id).toBe('cq-id-001')
  })

  it('writes agent_events row with success status on valid parse', async () => {
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = insertFn.mock.calls[0]?.[0]
    expect(row.task_type).toBe('telegram_callback')
    expect(row.status).toBe('success')
    expect(row.meta.agent_event_id).toBe(VALID_UUID)
  })

  it('writes agent_events row with warning status on unparseable callback_data', async () => {
    mockParseCallbackData.mockReturnValue(null)
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({ insert: insertFn })

    const req = makeRequest(makeCallbackUpdate('garbage'))
    await POST(req)
    await Promise.resolve()

    const row = insertFn.mock.calls[0]?.[0]
    expect(row.status).toBe('warning')
    expect(row.meta.agent_event_id).toBeNull()
  })

  it('still returns 200 even if agent_events insert throws', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db crash') })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── Malformed JSON body ───────────────────────────────────────────────────────

describe('POST /api/telegram/webhook — malformed body', () => {
  it('returns 400 for non-JSON body', async () => {
    const req = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': VALID_SECRET,
      },
      body: 'not json at all',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
