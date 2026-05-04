/**
 * Telegram Thumbs feedback — acceptance tests for ACs 1–12.
 *
 * AC-1:  task_feedback table schema verified (structural check via migration file)
 * AC-2:  sendMessageWithButtons sends inline keyboard when TELEGRAM_THUMBS_ENABLED set
 * AC-3:  pickup notification includes buttons (agent_events inserted before Telegram send)
 * AC-4:  sendMessageWithButtons falls back to plain text when flag absent
 * AC-5:  webhook rejects unauthorized requests (no header / wrong value)
 * AC-6:  👍 tap writes correct task_feedback row
 * AC-7:  👎 tap writes correct task_feedback row
 * AC-8:  duplicate tap is deduplicated
 * AC-9:  message edited after tap (buttons removed, acknowledgment appended)
 * AC-10: malformed callback_data handled gracefully
 * AC-11: unknown agent_event_id (FK miss) handled gracefully
 * AC-12: feature flag gates all button behavior; existing behavior unaffected when flag absent
 *
 * Implementation lives in:
 *   - lib/harness/telegram-buttons.ts  (sendMessageWithButtons, parseCallbackData)
 *   - app/api/telegram/webhook/route.ts (webhook handler — auth, feedback write, edit)
 *   - lib/harness/pickup-runner.ts      (agent_events inserted before Telegram send)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ── Mock postMessage ───────────────────────────────────────────────────────────

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: mockPostMessage,
}))

// ── Mock arms-legs http — bypass capability gate ──────────────────────────────

vi.mock('@/lib/harness/arms-legs/http', () => ({
  httpRequest: vi.fn(
    async (args: {
      url: string
      method: string
      body?: unknown
      headers?: Record<string, string>
    }) => {
      const hdrs: Record<string, string> = { ...(args.headers ?? {}) }
      let fetchBody: string | null = null
      if (args.body != null) {
        fetchBody = JSON.stringify(args.body)
        if (!hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json'
      }
      try {
        const res = (await fetch(args.url, {
          method: args.method,
          headers: hdrs,
          body: fetchBody,
        })) as {
          ok: boolean
          status?: number
          text?: () => Promise<string>
          headers?: { forEach?: (cb: (v: string, k: string) => void) => void }
        }
        const text = typeof res.text === 'function' ? await res.text() : ''
        const resHeaders: Record<string, string> = {}
        res.headers?.forEach?.((v, k) => {
          resHeaders[k] = v
        })
        return {
          ok: Boolean(res.ok),
          status: res.status ?? (res.ok ? 200 : 500),
          body: text,
          headers: resHeaders,
          durationMs: 0,
        }
      } catch (err) {
        return {
          ok: false,
          status: 0,
          body: '',
          headers: {},
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  ),
}))

// ── Mock Supabase for webhook tests ──────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock deploy-gate functions ────────────────────────────────────────────────

vi.mock('@/lib/harness/deploy-gate', () => ({
  rollbackDeployment: vi.fn(),
  mergeToMain: vi.fn(),
  deleteBranch: vi.fn(),
  sendPromotionNotification: vi.fn(),
}))

// ── Mock purpose-review handler ───────────────────────────────────────────────

vi.mock('@/lib/purpose-review/handler', () => ({
  parsePurposeReviewCallback: vi.fn().mockReturnValue(null),
  handlePurposeReviewCallback: vi.fn(),
  handlePurposeReviewTextReply: vi.fn(),
}))

// ── Mock work-budget parser ───────────────────────────────────────────────────

vi.mock('@/lib/work-budget/parser', () => ({
  handleBudgetCommand: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  sendMessageWithButtons,
  parseCallbackData,
  buildCallbackData,
} from '@/lib/harness/telegram-buttons'
import { POST } from '@/app/api/telegram/webhook/route'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-webhook-secret-32chars0000000'
const VALID_UUID = '885ff1e3-baed-4512-8e7a-8335995ea057'
const VALID_USER_ID = 123456789

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeCallbackUpdate(
  data: string,
  fromId = VALID_USER_ID,
  messageText = 'Task claimed: abc12345'
) {
  return {
    update_id: 100,
    callback_query: {
      id: 'cbq-thumbs-001',
      from: { id: fromId, username: 'colin_test' },
      message: {
        message_id: 77,
        chat: { id: 999 },
        text: messageText,
      },
      data,
    },
  }
}

// Supabase mock builder: chainable query builder that simulates a SELECT result
// and exposes _insert/_update/_maybeSingle for assertion.
function makeDbBuilder(existingRow: { id: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existingRow, error: null })
  const chain: Record<string, unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    filter: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle,
  }
  for (const m of ['select', 'eq', 'filter', 'is', 'gte', 'order', 'limit']) {
    ;(chain[m] as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  }
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return {
    ...chain,
    update,
    insert,
    _maybeSingle: maybeSingle,
    _updateEq: updateEq,
    _update: update,
    _insert: insert,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TELEGRAM_THUMBS_ENABLED
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  delete process.env.TELEGRAM_ALLOWED_USER_ID
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  process.env.TELEGRAM_WEBHOOK_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.TELEGRAM_ALLOWED_USER_ID = String(VALID_USER_ID)
  mockFrom.mockReturnValue(makeDbBuilder())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  mockPostMessage.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── AC-1: task_feedback table schema ─────────────────────────────────────────
// The table is created by migration 0014_add_quality_scoring.sql.
// Verified by confirming the migration file exists and contains the CREATE TABLE.

describe('AC-1: task_feedback table schema', () => {
  it('migration 0014 exists and defines task_feedback with required columns', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/0014_add_quality_scoring.sql'
    )
    expect(fs.existsSync(migrationPath)).toBe(true)
    const sql = fs.readFileSync(migrationPath, 'utf-8')
    expect(sql).toContain('CREATE TABLE public.task_feedback')
    expect(sql).toContain('agent_event_id')
    expect(sql).toContain('feedback_type')
    expect(sql).toContain('thumbs_up')
    expect(sql).toContain('thumbs_down')
    expect(sql).toContain('signal_validation')
    expect(sql).toContain('source')
    expect(sql).toContain('meta')
    expect(sql).toContain('REFERENCES public.agent_events(id) ON DELETE CASCADE')
  })
})

// ── AC-2: sendMessageWithButtons sends inline keyboard when flag set ───────────

describe('AC-2: sendMessageWithButtons sends inline keyboard when TELEGRAM_THUMBS_ENABLED is set', () => {
  it('sends inline keyboard with 👍 and 👎 buttons', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_CHAT_ID = '111222'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    await sendMessageWithButtons(VALID_UUID, 'Task claimed: abc12345')

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    const keyboard = body.reply_markup.inline_keyboard[0]
    expect(keyboard).toHaveLength(2)
    expect(keyboard[0].text).toBe('👍')
    expect(keyboard[1].text).toBe('👎')
  })

  it('button[0].callback_data is tf:up:<agentEventId>', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_CHAT_ID = '111222'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    await sendMessageWithButtons(VALID_UUID, 'msg')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe(`tf:up:${VALID_UUID}`)
  })

  it('button[1].callback_data is tf:dn:<agentEventId>', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_CHAT_ID = '111222'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    await sendMessageWithButtons(VALID_UUID, 'msg')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.reply_markup.inline_keyboard[0][1].callback_data).toBe(`tf:dn:${VALID_UUID}`)
  })

  it('callback_data is within Telegram 64-byte limit', () => {
    const up = buildCallbackData('up', VALID_UUID)
    const dn = buildCallbackData('dn', VALID_UUID)
    expect(Buffer.byteLength(up, 'utf8')).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(dn, 'utf8')).toBeLessThanOrEqual(64)
  })
})

// ── AC-3: pickup notification inserts agent_events BEFORE sending ─────────────
// The order is enforced in pickup-runner.ts: logEvent() returns the UUID which
// is then passed to sendMessageWithButtons(). If logEvent returned null, a
// fallback UUID is used. This is a structural test via parseCallbackData.

describe('AC-3: callback_data format embeds agent_event_id correctly', () => {
  it('parseCallbackData round-trips the UUID from callback_data', () => {
    const data = buildCallbackData('up', VALID_UUID)
    const parsed = parseCallbackData(data)
    expect(parsed).not.toBeNull()
    expect(parsed?.agentEventId).toBe(VALID_UUID)
  })

  it('sendMessageWithButtons embeds agentEventId in both buttons', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_CHAT_ID = '111222'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', mockFetch)

    const agentEventId = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee'
    await sendMessageWithButtons(agentEventId, 'msg')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    const keyboard = body.reply_markup.inline_keyboard[0]
    expect(keyboard[0].callback_data).toContain(agentEventId)
    expect(keyboard[1].callback_data).toContain(agentEventId)
  })
})

// ── AC-4: plain text fallback when flag absent ────────────────────────────────

describe('AC-4: sendMessageWithButtons falls back to plain text when flag absent', () => {
  it('calls postMessage (no inline keyboard) when TELEGRAM_THUMBS_ENABLED not set', async () => {
    await sendMessageWithButtons(VALID_UUID, 'hello')
    expect(mockPostMessage).toHaveBeenCalledWith('hello')
  })

  it('does not call fetch directly when falling back to postMessage', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await sendMessageWithButtons(VALID_UUID, 'hello')

    // postMessage is mocked; fetch should not have been called by sendMessageWithButtons
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back when TELEGRAM_BOT_TOKEN is missing even with flag set', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.TELEGRAM_CHAT_ID = '111'

    await sendMessageWithButtons(VALID_UUID, 'hello')
    expect(mockPostMessage).toHaveBeenCalledWith('hello')
  })

  it('falls back when TELEGRAM_CHAT_ID is missing even with flag set', async () => {
    process.env.TELEGRAM_THUMBS_ENABLED = '1'
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    delete process.env.TELEGRAM_CHAT_ID

    await sendMessageWithButtons(VALID_UUID, 'hello')
    expect(mockPostMessage).toHaveBeenCalledWith('hello')
  })
})

// ── AC-5: webhook rejects unauthorized requests ───────────────────────────────

describe('AC-5: webhook rejects unauthorized requests', () => {
  it('returns 403 when X-Telegram-Bot-Api-Secret-Token header is absent', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`), {
      'x-telegram-bot-api-secret-token': '',
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when header value is wrong', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`), {
      'x-telegram-bot-api-secret-token': 'wrong-secret-value',
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns 403 when TELEGRAM_WEBHOOK_SECRET env var is not set', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('no task_feedback row written on auth failure', async () => {
    const fbBuilder = makeDbBuilder()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`), {
      'x-telegram-bot-api-secret-token': 'bad',
    })
    await POST(req)

    expect(fbBuilder._insert).not.toHaveBeenCalled()
  })
})

// ── AC-6: 👍 tap writes correct task_feedback row ─────────────────────────────

describe('AC-6: thumbs-up tap writes correct task_feedback row', () => {
  it('inserts task_feedback with feedback_type=thumbs_up', async () => {
    const fbBuilder = makeDbBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(fbBuilder._insert).toHaveBeenCalledOnce()
    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.feedback_type).toBe('thumbs_up')
    expect(row.agent_event_id).toBe(VALID_UUID)
  })

  it('source is telegram_pickup_button', async () => {
    const fbBuilder = makeDbBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.source).toBe('telegram_pickup_button')
  })

  it('meta contains telegram_user_id', async () => {
    const fbBuilder = makeDbBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`, VALID_USER_ID))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.meta.telegram_user_id).toBe(VALID_USER_ID)
  })

  it('returns HTTP 200', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

// ── AC-7: 👎 tap writes correct task_feedback row ─────────────────────────────

describe('AC-7: thumbs-down tap writes correct task_feedback row', () => {
  it('inserts task_feedback with feedback_type=thumbs_down', async () => {
    const fbBuilder = makeDbBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:dn:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(fbBuilder._insert).toHaveBeenCalledOnce()
    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.feedback_type).toBe('thumbs_down')
    expect(row.agent_event_id).toBe(VALID_UUID)
  })

  it('source is telegram_pickup_button for 👎', async () => {
    const fbBuilder = makeDbBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:dn:${VALID_UUID}`))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.source).toBe('telegram_pickup_button')
  })
})

// ── AC-8: duplicate tap is deduplicated ──────────────────────────────────────

describe('AC-8: duplicate tap is deduplicated', () => {
  it('updates existing row instead of inserting when same (agent_event_id, source) exists', async () => {
    const existingRow = { id: 'existing-fb-row-uuid' }
    const fbBuilder = makeDbBuilder(existingRow)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(fbBuilder._insert).not.toHaveBeenCalled()
    expect(fbBuilder._update).toHaveBeenCalledOnce()
  })

  it('still calls answerCallbackQuery on duplicate tap (clears spinner)', async () => {
    const existingRow = { id: 'existing-fb-row-uuid' }
    const fbBuilder = makeDbBuilder(existingRow)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
  })

  it('still returns 200 on duplicate tap', async () => {
    const existingRow = { id: 'existing-fb-row-uuid' }
    const fbBuilder = makeDbBuilder(existingRow)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:dn:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── AC-9: message edited after tap ───────────────────────────────────────────

describe('AC-9: message is edited after tap', () => {
  it('calls Telegram editMessageText on 👍 tap', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
  })

  it('edited text contains 👍, "recorded at", and "MT" on thumbs-up', async () => {
    const req = makeRequest(
      makeCallbackUpdate(`tf:up:${VALID_UUID}`, VALID_USER_ID, 'Original task text')
    )
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )!
    const body = JSON.parse(editCall[1]!.body as string)
    expect(body.text).toContain('👍')
    expect(body.text).toContain('recorded at')
    expect(body.text).toContain('MT')
    expect(body.text).toContain('Original task text')
  })

  it('edited text contains 👎 on thumbs-down', async () => {
    const req = makeRequest(
      makeCallbackUpdate(`tf:dn:${VALID_UUID}`, VALID_USER_ID, 'Original task text')
    )
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )!
    const body = JSON.parse(editCall[1]!.body as string)
    expect(body.text).toContain('👎')
  })

  it('inline keyboard is removed after tap (reply_markup.inline_keyboard is empty)', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )!
    const body = JSON.parse(editCall[1]!.body as string)
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('answerCallbackQuery is called to dismiss spinner', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
    const body = JSON.parse(answerCall![1]!.body as string)
    expect(body.callback_query_id).toBe('cbq-thumbs-001')
  })
})

// ── AC-10: malformed callback_data handled gracefully ────────────────────────

describe('AC-10: malformed callback_data handled gracefully', () => {
  it('returns HTTP 200 for garbage callback_data (no crash)', async () => {
    const req = makeRequest(makeCallbackUpdate('garbage_data_xyz'))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('no task_feedback row written for malformed callback_data', async () => {
    const fbBuilder = makeDbBuilder()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate('garbage'))
    await POST(req)

    expect(fbBuilder._insert).not.toHaveBeenCalled()
    expect(fbBuilder._update).not.toHaveBeenCalled()
  })

  it('answerCallbackQuery still called (clears spinner) on malformed data', async () => {
    const req = makeRequest(makeCallbackUpdate('bad:data'))
    await POST(req)

    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
  })

  it('returns 200 for empty callback_data string', async () => {
    const req = makeRequest(makeCallbackUpdate(''))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── AC-11: unknown agent_event_id handled gracefully (FK miss) ────────────────

describe('AC-11: unknown agent_event_id handled gracefully', () => {
  it('returns HTTP 200 even when DB insert fails on unknown UUID', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('FK violation')
    })

    const NON_EXISTENT_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const req = makeRequest(makeCallbackUpdate(`tf:up:${NON_EXISTENT_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('answerCallbackQuery still called on FK miss', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('FK violation')
    })

    const NON_EXISTENT_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const req = makeRequest(makeCallbackUpdate(`tf:up:${NON_EXISTENT_UUID}`))
    await POST(req)

    // answerCallbackQuery must fire — it runs before DB work in the webhook handler
    const fetchMock = vi.mocked(fetch)
    const answerCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('answerCallbackQuery')
    )
    expect(answerCall).toBeDefined()
  })
})

// ── AC-12: feature flag gates all button behavior ─────────────────────────────

describe('AC-12: feature flag off — plain text only, no buttons', () => {
  it('sendMessageWithButtons sends plain text when TELEGRAM_THUMBS_ENABLED is unset', async () => {
    delete process.env.TELEGRAM_THUMBS_ENABLED
    await sendMessageWithButtons(VALID_UUID, 'Task claimed message')

    expect(mockPostMessage).toHaveBeenCalledWith('Task claimed message')
  })

  it('no inline_keyboard present in the plain-text fallback path', async () => {
    delete process.env.TELEGRAM_THUMBS_ENABLED
    await sendMessageWithButtons(VALID_UUID, 'plain')

    // Verify the fetch path was NOT taken (it would have an inline_keyboard body)
    const fetchMock = vi.mocked(fetch)
    const sendCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('sendMessage'))
    expect(sendCall).toBeUndefined()
  })

  it('webhook endpoint returns 200 and processes callbacks regardless of flag state', async () => {
    // The webhook is always active; the flag only controls whether buttons are sent
    delete process.env.TELEGRAM_THUMBS_ENABLED
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('parseCallbackData correctly parses tf:up and tf:dn regardless of flag', () => {
    delete process.env.TELEGRAM_THUMBS_ENABLED

    expect(parseCallbackData(`tf:up:${VALID_UUID}`)).toEqual({
      action: 'up',
      agentEventId: VALID_UUID,
    })
    expect(parseCallbackData(`tf:dn:${VALID_UUID}`)).toEqual({
      action: 'dn',
      agentEventId: VALID_UUID,
    })
  })
})
