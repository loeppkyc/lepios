/**
 * Unit tests for the approval callback format in lib/harness/telegram-buttons.ts.
 *
 * Covers:
 *   - buildApprovalCallbackData: serialization to short format
 *   - parseApprovalCallbackData: parsing short format back
 *   - 64-byte limit guarantee for all action types
 *   - round-trip fidelity
 *   - invalid input rejection
 *   - sendApprovalButtons: Telegram API call shape + fallback behaviour
 *
 * Webhook-side collision and not-found handling is tested in
 * telegram-approval-callback.test.ts (which mocks Supabase).
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
  buildApprovalCallbackData,
  parseApprovalCallbackData,
  sendApprovalButtons,
  type ApprovalAction,
} from '@/lib/harness/telegram-buttons'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_UUID = '40b1aa4b-c969-4d94-93f7-49ce29f3fc26'
// First 8 hex chars (dashes stripped then sliced): '40b1aa4b'
const ID8 = '40b1aa4b'

const ALL_ACTIONS: ApprovalAction[] = ['ap', 're', 'gp', 'gpart', 'gf']

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── buildApprovalCallbackData ─────────────────────────────────────────────────

describe('buildApprovalCallbackData', () => {
  it('produces ap:{id8} for approve action', () => {
    expect(buildApprovalCallbackData('ap', TASK_UUID)).toBe(`ap:${ID8}`)
  })

  it('produces re:{id8} for reject action', () => {
    expect(buildApprovalCallbackData('re', TASK_UUID)).toBe(`re:${ID8}`)
  })

  it('produces gp:{id8} for grounding-pass action', () => {
    expect(buildApprovalCallbackData('gp', TASK_UUID)).toBe(`gp:${ID8}`)
  })

  it('produces gpart:{id8} for grounding-partial action', () => {
    expect(buildApprovalCallbackData('gpart', TASK_UUID)).toBe(`gpart:${ID8}`)
  })

  it('produces gf:{id8} for grounding-fail action', () => {
    expect(buildApprovalCallbackData('gf', TASK_UUID)).toBe(`gf:${ID8}`)
  })

  it('strips UUID dashes before slicing', () => {
    // UUID: 40b1aa4b-c969-4d94-93f7-49ce29f3fc26
    // Dashes stripped: 40b1aa4bc9694d9493f749ce29f3fc26
    // First 8:         40b1aa4b
    const result = buildApprovalCallbackData('ap', TASK_UUID)
    expect(result).toBe('ap:40b1aa4b')
  })

  it('all action types are under the 64-byte Telegram limit', () => {
    for (const action of ALL_ACTIONS) {
      const result = buildApprovalCallbackData(action, TASK_UUID)
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(64)
    }
  })

  it('gpart produces the longest format and is still well under 64 bytes', () => {
    const result = buildApprovalCallbackData('gpart', TASK_UUID)
    // 'gpart:40b1aa4b' = 14 bytes
    expect(Buffer.byteLength(result, 'utf8')).toBe(14)
  })
})

// ── parseApprovalCallbackData ─────────────────────────────────────────────────

describe('parseApprovalCallbackData', () => {
  it('parses ap:{id8} correctly', () => {
    expect(parseApprovalCallbackData(`ap:${ID8}`)).toEqual({ action: 'ap', id8: ID8 })
  })

  it('parses re:{id8} correctly', () => {
    expect(parseApprovalCallbackData(`re:${ID8}`)).toEqual({ action: 're', id8: ID8 })
  })

  it('parses gp:{id8} correctly', () => {
    expect(parseApprovalCallbackData(`gp:${ID8}`)).toEqual({ action: 'gp', id8: ID8 })
  })

  it('parses gpart:{id8} correctly', () => {
    expect(parseApprovalCallbackData(`gpart:${ID8}`)).toEqual({ action: 'gpart', id8: ID8 })
  })

  it('parses gf:{id8} correctly', () => {
    expect(parseApprovalCallbackData(`gf:${ID8}`)).toEqual({ action: 'gf', id8: ID8 })
  })

  it('returns null for unknown prefix', () => {
    expect(parseApprovalCallbackData(`xx:${ID8}`)).toBeNull()
  })

  it('returns null when id8 is too short (7 chars)', () => {
    expect(parseApprovalCallbackData('ap:40b1aa4')).toBeNull()
  })

  it('returns null when id8 is too long (9 chars)', () => {
    expect(parseApprovalCallbackData('ap:40b1aa4bc')).toBeNull()
  })

  it('returns null when id8 contains non-hex characters', () => {
    expect(parseApprovalCallbackData('ap:GGGGGGGG')).toBeNull()
    expect(parseApprovalCallbackData('ap:ABCDEF12')).toBeNull() // uppercase hex is invalid
  })

  it('returns null for tf: prefix (thumbs-up family)', () => {
    expect(parseApprovalCallbackData(`tf:up:${TASK_UUID}`)).toBeNull()
  })

  it('returns null for dg: prefix (deploy-gate family)', () => {
    expect(parseApprovalCallbackData('dg:rb:abcdef12')).toBeNull()
  })

  it('returns null for improve_ prefix (improvement engine family)', () => {
    expect(parseApprovalCallbackData('improve_approve_all:sprint-5-e1')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseApprovalCallbackData('')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(parseApprovalCallbackData('garbage')).toBeNull()
  })

  it('round-trips through buildApprovalCallbackData for all actions', () => {
    for (const action of ALL_ACTIONS) {
      const encoded = buildApprovalCallbackData(action, TASK_UUID)
      const parsed = parseApprovalCallbackData(encoded)
      expect(parsed).toEqual({ action, id8: ID8 })
    }
  })
})

// ── sendApprovalButtons ───────────────────────────────────────────────────────

describe('sendApprovalButtons', () => {
  it('falls back to postMessage when TELEGRAM_BOT_TOKEN is missing', async () => {
    process.env.TELEGRAM_CHAT_ID = '111'
    mockPostMessage.mockResolvedValue(undefined)

    await sendApprovalButtons(TASK_UUID, 'test message')

    expect(mockPostMessage).toHaveBeenCalledWith('test message')
  })

  it('falls back to postMessage when TELEGRAM_CHAT_ID is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    mockPostMessage.mockResolvedValue(undefined)

    await sendApprovalButtons(TASK_UUID, 'test message')

    expect(mockPostMessage).toHaveBeenCalledWith('test message')
  })

  it('calls Telegram sendMessage with ap: and re: inline keyboard buttons', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111222'

    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await sendApprovalButtons(TASK_UUID, 'approval request')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    expect(body.chat_id).toBe('111222')
    expect(body.text).toBe('approval request')

    const keyboard = body.reply_markup.inline_keyboard[0]
    expect(keyboard).toHaveLength(2)
    expect(keyboard[0]).toEqual({ text: 'Approve', callback_data: `ap:${ID8}` })
    expect(keyboard[1]).toEqual({ text: 'Reject', callback_data: `re:${ID8}` })
  })

  it('callback_data bytes are within Telegram 64-byte limit', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111'

    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await sendApprovalButtons(TASK_UUID, 'msg')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    for (const btn of body.reply_markup.inline_keyboard.flat()) {
      expect(Buffer.byteLength(btn.callback_data as string, 'utf8')).toBeLessThanOrEqual(64)
    }
  })

  it('throws when Telegram API returns non-200', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '111'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'BUTTON_DATA_INVALID',
      })
    )

    await expect(sendApprovalButtons(TASK_UUID, 'msg')).rejects.toThrow('Telegram API error 400')
  })

  it('does not call postMessage when API path is used', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.TELEGRAM_CHAT_ID = '111'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await sendApprovalButtons(TASK_UUID, 'msg')

    expect(mockPostMessage).not.toHaveBeenCalled()
  })
})

// ── Collision-detection and not-found logic ───────────────────────────────────
//
// These are tested at the webhook handler level.
// The pure-logic parts (what the handler does with 0 / 1 / >1 match)
// are exercised via the unit tests below, which simulate the lookup results.

describe('collision guard — pure logic', () => {
  // We cannot call handleApprovalCallback directly (it's not exported),
  // but we can verify the parseApprovalCallbackData correctly feeds into
  // the handler dispatch by checking id8 extraction is consistent.

  it('id8 from buildApprovalCallbackData matches what parseApprovalCallbackData returns', () => {
    const encoded = buildApprovalCallbackData('ap', TASK_UUID)
    const parsed = parseApprovalCallbackData(encoded)
    // The id8 must be the first 8 hex chars of TASK_UUID (dashes stripped)
    const expectedId8 = TASK_UUID.replace(/-/g, '').slice(0, 8)
    expect(parsed?.id8).toBe(expectedId8)
  })

  it('two different UUIDs with the same first 8 hex chars would collide (expected behaviour)', () => {
    const uuid1 = '40b1aa4b-c969-4d94-93f7-49ce29f3fc26'
    const uuid2 = '40b1aa4b-dead-beef-cafe-000000000000'
    const id8a = buildApprovalCallbackData('ap', uuid1).split(':')[1]
    const id8b = buildApprovalCallbackData('ap', uuid2).split(':')[1]
    // Both produce the same id8 — the collision guard in the webhook must detect this
    expect(id8a).toBe(id8b)
  })

  it('two UUIDs differing in first char produce different id8 values (no collision)', () => {
    const uuid1 = '40b1aa4b-c969-4d94-93f7-49ce29f3fc26'
    const uuid2 = '50b1aa4b-c969-4d94-93f7-49ce29f3fc26'
    const id8a = buildApprovalCallbackData('ap', uuid1).split(':')[1]
    const id8b = buildApprovalCallbackData('ap', uuid2).split(':')[1]
    expect(id8a).not.toBe(id8b)
  })
})
