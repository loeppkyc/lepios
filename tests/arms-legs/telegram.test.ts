/**
 * Unit tests for lib/harness/arms-legs/telegram.ts
 *
 * Mocks httpRequest from arms-legs/http so these tests are isolated from
 * capability checks and fetch — those paths are covered by http.test.ts.
 *
 * Coverage:
 *   - Sends message via httpRequest with correct capability + URL
 *   - Returns messageId on success
 *   - Returns ok:false + error (no throw) on failure
 *   - Routes to correct bot token for 'builder' vs 'alerts'
 *   - Returns error when env vars are missing (no httpRequest call)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock httpRequest ──────────────────────────────────────────────────────────

const { mockHttpRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
}))

vi.mock('@/lib/harness/arms-legs/http', () => ({
  httpRequest: mockHttpRequest,
}))

import { telegram } from '@/lib/harness/arms-legs/telegram'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BUILDER_TOKEN = 'builder-token-abc123'
const ALERTS_TOKEN = 'alerts-token-xyz789'
const CHAT_ID = '-100987654321'

const TG_SUCCESS_BODY = JSON.stringify({
  ok: true,
  result: { message_id: 99 },
})

function makeHttpOk(body = TG_SUCCESS_BODY) {
  return {
    ok: true,
    status: 200,
    body,
    headers: {},
    durationMs: 42,
  }
}

function makeHttpFail(status = 400, error?: string) {
  return {
    ok: false,
    status,
    body: '{"ok":false,"description":"Bad Request"}',
    headers: {},
    durationMs: 10,
    error,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_BOT_TOKEN = BUILDER_TOKEN
  process.env.TELEGRAM_ALERTS_BOT_TOKEN = ALERTS_TOKEN
  process.env.TELEGRAM_CHAT_ID = CHAT_ID
  mockHttpRequest.mockResolvedValue(makeHttpOk())
})

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ALERTS_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('telegram — happy path', () => {
  it('calls httpRequest with capability net.outbound.telegram', async () => {
    await telegram('Hello world')

    expect(mockHttpRequest).toHaveBeenCalledOnce()
    const [args] = mockHttpRequest.mock.calls[0] as [{ capability: string }]
    expect(args.capability).toBe('net.outbound.telegram')
  })

  it('calls httpRequest with POST method to api.telegram.org', async () => {
    await telegram('Hello world')

    const [args] = mockHttpRequest.mock.calls[0] as [{ url: string; method: string }]
    expect(args.method).toBe('POST')
    expect(args.url).toMatch(/^https:\/\/api\.telegram\.org\/bot/)
    expect(args.url).toContain('/sendMessage')
  })

  it('uses TELEGRAM_BOT_TOKEN for builder bot by default', async () => {
    await telegram('Hello')

    const [args] = mockHttpRequest.mock.calls[0] as [{ url: string }]
    expect(args.url).toContain(BUILDER_TOKEN)
    expect(args.url).not.toContain(ALERTS_TOKEN)
  })

  it('uses TELEGRAM_ALERTS_BOT_TOKEN when bot=alerts', async () => {
    await telegram('Alert!', { bot: 'alerts' })

    const [args] = mockHttpRequest.mock.calls[0] as [{ url: string }]
    expect(args.url).toContain(ALERTS_TOKEN)
    expect(args.url).not.toContain(BUILDER_TOKEN)
  })

  it('sends message text and chat_id in body', async () => {
    await telegram('Test message')

    const [args] = mockHttpRequest.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(args.body['chat_id']).toBe(CHAT_ID)
    expect(args.body['text']).toBe('Test message')
  })

  it('returns ok:true and messageId on success', async () => {
    const result = await telegram('Hello')

    expect(result.ok).toBe(true)
    expect(result.messageId).toBe(99)
    expect(result.error).toBeUndefined()
  })

  it('uses custom chatId when provided', async () => {
    const customChatId = '-999888777'
    await telegram('Hello', { chatId: customChatId })

    const [args] = mockHttpRequest.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(args.body['chat_id']).toBe(customChatId)
  })

  it('defaults agentId to harness', async () => {
    await telegram('Hello')

    const [args] = mockHttpRequest.mock.calls[0] as [{ agentId: string }]
    expect(args.agentId).toBe('harness')
  })

  it('passes custom agentId through to httpRequest', async () => {
    await telegram('Hello', { agentId: 'coordinator' })

    const [args] = mockHttpRequest.mock.calls[0] as [{ agentId: string }]
    expect(args.agentId).toBe('coordinator')
  })

  it('includes parse_mode in body when provided', async () => {
    await telegram('*bold*', { parseMode: 'Markdown' })

    const [args] = mockHttpRequest.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(args.body['parse_mode']).toBe('Markdown')
  })

  it('omits parse_mode from body when not provided', async () => {
    await telegram('plain text')

    const [args] = mockHttpRequest.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(args.body['parse_mode']).toBeUndefined()
  })
})

// ── Failure — no throw ────────────────────────────────────────────────────────

describe('telegram — failure returns error, does not throw', () => {
  it('returns ok:false when httpRequest returns ok:false', async () => {
    mockHttpRequest.mockResolvedValue(makeHttpFail(400))

    const result = await telegram('Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.messageId).toBeUndefined()
  })

  it('includes status in error message when httpRequest fails without error field', async () => {
    mockHttpRequest.mockResolvedValue(makeHttpFail(403))

    const result = await telegram('Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
  })

  it('propagates error string from httpRequest when present', async () => {
    mockHttpRequest.mockResolvedValue(makeHttpFail(0, 'ECONNREFUSED'))

    const result = await telegram('Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('does not throw even when httpRequest returns an error', async () => {
    mockHttpRequest.mockResolvedValue(makeHttpFail(500, 'Server error'))

    await expect(telegram('Hello')).resolves.not.toThrow()
  })
})

// ── Missing env vars ──────────────────────────────────────────────────────────

describe('telegram — missing env vars', () => {
  it('returns ok:false when TELEGRAM_BOT_TOKEN is unset', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN

    const result = await telegram('Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/TELEGRAM_BOT_TOKEN/)
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('returns ok:false when TELEGRAM_ALERTS_BOT_TOKEN is unset for alerts bot', async () => {
    delete process.env.TELEGRAM_ALERTS_BOT_TOKEN

    const result = await telegram('Alert!', { bot: 'alerts' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/TELEGRAM_ALERTS_BOT_TOKEN/)
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('returns ok:false when TELEGRAM_CHAT_ID is unset and no chatId provided', async () => {
    delete process.env.TELEGRAM_CHAT_ID

    const result = await telegram('Hello')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/TELEGRAM_CHAT_ID/)
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('succeeds when TELEGRAM_CHAT_ID is unset but chatId is provided', async () => {
    delete process.env.TELEGRAM_CHAT_ID

    const result = await telegram('Hello', { chatId: '-111222333' })

    expect(result.ok).toBe(true)
    expect(mockHttpRequest).toHaveBeenCalledOnce()
  })
})
