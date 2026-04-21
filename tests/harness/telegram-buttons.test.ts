/**
 * Unit tests for lib/harness/telegram-buttons.ts.
 * Mocks @/lib/orchestrator/telegram and globalThis.fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock postMessage ───────────────────────────────────────────────────────────

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: mockPostMessage,
}))

import {
  buildCallbackData,
  parseCallbackData,
  isAllowedUser,
  sendMessageWithButtons,
} from '@/lib/harness/telegram-buttons'

// ── Setup ─────────────────────────────────────────────────────────────────────

const VALID_UUID = '885ff1e3-baed-4512-8e7a-8335995ea057'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TELEGRAM_THUMBS_ENABLED
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  delete process.env.TELEGRAM_ALLOWED_USER_ID
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── buildCallbackData ─────────────────────────────────────────────────────────

describe('buildCallbackData', () => {
  it('formats thumbs-up as tf:up:<uuid>', () => {
    expect(buildCallbackData('up', VALID_UUID)).toBe(`tf:up:${VALID_UUID}`)
  })

  it('formats thumbs-down as tf:dn:<uuid>', () => {
    expect(buildCallbackData('dn', VALID_UUID)).toBe(`tf:dn:${VALID_UUID}`)
  })

  it('resulting string is within Telegram 64-byte limit', () => {
    const result = buildCallbackData('up', VALID_UUID)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(64)
  })
})

// ── parseCallbackData ─────────────────────────────────────────────────────────

describe('parseCallbackData', () => {
  it('parses valid thumbs-up data', () => {
    expect(parseCallbackData(`tf:up:${VALID_UUID}`)).toEqual({
      action: 'up',
      agentEventId: VALID_UUID,
    })
  })

  it('parses valid thumbs-down data', () => {
    expect(parseCallbackData(`tf:dn:${VALID_UUID}`)).toEqual({
      action: 'dn',
      agentEventId: VALID_UUID,
    })
  })

  it('returns null for wrong prefix', () => {
    expect(parseCallbackData(`xx:up:${VALID_UUID}`)).toBeNull()
  })

  it('returns null for invalid action', () => {
    expect(parseCallbackData(`tf:bad:${VALID_UUID}`)).toBeNull()
  })

  it('returns null when UUID is not a valid UUID format', () => {
    expect(parseCallbackData('tf:up:not-a-uuid')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(parseCallbackData('garbage')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCallbackData('')).toBeNull()
  })

  it('round-trips through buildCallbackData', () => {
    const encoded = buildCallbackData('dn', VALID_UUID)
    expect(parseCallbackData(encoded)).toEqual({ action: 'dn', agentEventId: VALID_UUID })
  })
})

// ── isAllowedUser ─────────────────────────────────────────────────────────────

describe('isAllowedUser', () => {
  it('returns true when user id matches TELEGRAM_ALLOWED_USER_ID', () => {
    process.env.TELEGRAM_ALLOWED_USER_ID = '123456789'
    expect(isAllowedUser(123456789)).toBe(true)
  })

  it('returns false when user id does not match', () => {
    process.env.TELEGRAM_ALLOWED_USER_ID = '123456789'
    expect(isAllowedUser(999999999)).toBe(false)
  })

  it('returns false when TELEGRAM_ALLOWED_USER_ID is not set', () => {
    expect(isAllowedUser(123456789)).toBe(false)
  })

  it('does not match partial numeric strings', () => {
    process.env.TELEGRAM_ALLOWED_USER_ID = '123'
    expect(isAllowedUser(1234)).toBe(false)
  })
})

// ── sendMessageWithButtons ────────────────────────────────────────────────────

describe('sendMessageWithButtons', () => {
  it('falls back to postMessage when TELEGRAM_THUMBS_ENABLED is not set', async () => {
    mockPostMessage.mockResolvedValue(undefined)

    await sendMessageWithButtons(VALID_UUID, 'hello world')

    expect(mockPostMessage).toHaveBeenCalledOnce()
    expect(mockPostMessage).toHaveBeenCalledWith('hello world')
  })

  it('falls back to postMessage when flag set but TELEGRAM_BOT_TOKEN is missing', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_CHAT_ID = '111'
    mockPostMessage.mockResolvedValue(undefined)

    await sendMessageWithButtons(VALID_UUID, 'hello')

    expect(mockPostMessage).toHaveBeenCalledWith('hello')
  })

  it('falls back to postMessage when flag set but TELEGRAM_CHAT_ID is missing', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    mockPostMessage.mockResolvedValue(undefined)

    await sendMessageWithButtons(VALID_UUID, 'hello')

    expect(mockPostMessage).toHaveBeenCalledWith('hello')
  })

  it('calls Telegram sendMessage API with inline_keyboard when flag and config are set', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111222'

    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await sendMessageWithButtons(VALID_UUID, 'task claimed message')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    expect(body.chat_id).toBe('111222')
    expect(body.text).toBe('task claimed message')
    expect(body.reply_markup.inline_keyboard[0]).toEqual([
      { text: '👍', callback_data: `tf:up:${VALID_UUID}` },
      { text: '👎', callback_data: `tf:dn:${VALID_UUID}` },
    ])
  })

  it('does not call postMessage when using Telegram API path', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await sendMessageWithButtons(VALID_UUID, 'text')

    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  it('throws when Telegram API returns non-200', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }))

    await expect(sendMessageWithButtons(VALID_UUID, 'text')).rejects.toThrow('Telegram API error 429')
  })
})
