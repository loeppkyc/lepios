import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { POST } from '@/app/api/harness/telegram-send/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'
const VALID_TOKEN = 'bot-token-12345'
const VALID_CHAT_ID = '-1001234567890'
const VALID_TEXT = 'Hello from coordinator'

const TG_SUCCESS_BODY = {
  ok: true,
  result: { message_id: 42, chat: { id: -1001234567890 }, text: VALID_TEXT },
}

const VALID_BODY = { text: VALID_TEXT }

function makeRequest(body: object, headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/harness/telegram-send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
    body: JSON.stringify(body),
  })
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeTgResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = VALID_TOKEN
  process.env.TELEGRAM_CHAT_ID = VALID_CHAT_ID
  mockFrom.mockReturnValue(makeInsertBuilder())
  mockFetch.mockResolvedValue(makeTgResponse(200, TG_SUCCESS_BODY))
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: '' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('does not call fetch or write agent_events on unauthorized request', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong' })
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — validation', () => {
  it('returns 400 when text is empty string', async () => {
    const req = makeRequest({ text: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when text exceeds 4096 chars', async () => {
    const req = makeRequest({ text: 'a'.repeat(4097) })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when text is missing', async () => {
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('does not call fetch or write agent_events on validation failure', async () => {
    const req = makeRequest({ text: '' })
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Env vars ──────────────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — env vars', () => {
  it('returns 500 with clear error when TELEGRAM_BOT_TOKEN is unset', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/TELEGRAM_BOT_TOKEN/)
  })

  it('returns 500 when body omits chat_id and TELEGRAM_CHAT_ID is unset', async () => {
    delete process.env.TELEGRAM_CHAT_ID
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('does not call fetch when env vars are missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — happy path', () => {
  it('returns 200 with ok:true and message_id', async () => {
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message_id).toBe(TG_SUCCESS_BODY.result.message_id)
  })

  it('calls the correct Telegram API URL', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.telegram.org/bot${VALID_TOKEN}/sendMessage`)
  })

  it('sends correct chat_id and text in request body', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(options.body as string) as { chat_id: string; text: string }
    expect(sent.chat_id).toBe(VALID_CHAT_ID)
    expect(sent.text).toBe(VALID_TEXT)
  })

  it('logs agent_events with status=success and task_type=telegram_send', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('success')
    expect(row.task_type).toBe('telegram_send')
  })

  it('event meta contains only the last 4 chars of chat_id, not the full id', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const req = makeRequest(VALID_BODY)
    await POST(req)
    const row = b.insert.mock.calls[0][0]
    expect(row.meta.chat_id_suffix).toBe(VALID_CHAT_ID.slice(-4))
    expect(JSON.stringify(row.meta)).not.toContain(VALID_CHAT_ID)
  })

  it('event meta contains message_id and text_length', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const req = makeRequest(VALID_BODY)
    await POST(req)
    const row = b.insert.mock.calls[0][0]
    expect(row.meta.message_id).toBe(TG_SUCCESS_BODY.result.message_id)
    expect(row.meta.text_length).toBe(VALID_TEXT.length)
  })

  it('calls fetch exactly once — no retry', async () => {
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not expose TELEGRAM_BOT_TOKEN in response body', async () => {
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    const text = await res.text()
    expect(text).not.toContain(VALID_TOKEN)
  })
})

// ── chat_id fallback ──────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — chat_id fallback', () => {
  it('uses TELEGRAM_CHAT_ID env default when chat_id is omitted from body', async () => {
    const req = makeRequest({ text: VALID_TEXT })
    await POST(req)
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(options.body as string) as { chat_id: string }
    expect(sent.chat_id).toBe(VALID_CHAT_ID)
  })

  it('uses body chat_id over env default when both are present', async () => {
    const customChatId = '-9999999999'
    const req = makeRequest({ text: VALID_TEXT, chat_id: customChatId })
    await POST(req)
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(options.body as string) as { chat_id: string }
    expect(sent.chat_id).toBe(customChatId)
  })
})

// ── Upstream errors ───────────────────────────────────────────────────────────

describe('POST /api/harness/telegram-send — upstream errors', () => {
  it('returns 502 when Telegram returns 400', async () => {
    mockFetch.mockResolvedValue(
      makeTgResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })
    )
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('response body includes upstream_description on Telegram error', async () => {
    mockFetch.mockResolvedValue(
      makeTgResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })
    )
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    const body = await res.json()
    expect(body.upstream_description).toBe('Bad Request: chat not found')
  })

  it('logs agent_events with status=error on Telegram 400', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    mockFetch.mockResolvedValue(
      makeTgResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })
    )
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
  })

  it('returns 503 on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('logs agent_events with status=error on network failure', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeRequest(VALID_BODY)
    await POST(req)
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
  })

  it('calls fetch exactly once on failure — no retry', async () => {
    mockFetch.mockResolvedValue(
      makeTgResponse(400, { ok: false, description: 'Bad Request' })
    )
    const req = makeRequest(VALID_BODY)
    await POST(req)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not expose TELEGRAM_BOT_TOKEN in error response', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    const text = await res.text()
    expect(text).not.toContain(VALID_TOKEN)
  })
})
