import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET } from '@/app/api/harness/notifications-drain/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret'

type PendingRow = {
  id: string
  channel: string
  chat_id: string | null
  payload: Record<string, unknown>
  attempts: number
}

function makeAuthorizedRequest(): Request {
  return new Request('http://localhost/api/harness/notifications-drain', {
    method: 'GET',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
}

// Builds a thenable chain for the drain's select query.
// Each chainable method returns `this`; `await chain` resolves to { data, error }.
function makeSelectChain(rows: PendingRow[]) {
  const result = { data: rows, error: null }
  const chain: Record<string, unknown> = {
    then: (fn: Parameters<Promise<unknown>['then']>[0], rej?: Parameters<Promise<unknown>['then']>[1]) =>
      Promise.resolve(result).then(fn, rej),
    catch: (fn: Parameters<Promise<unknown>['catch']>[0]) => Promise.resolve(result).catch(fn),
    finally: (fn: Parameters<Promise<unknown>['finally']>[0]) => Promise.resolve(result).finally(fn),
  }
  for (const m of ['select', 'eq', 'lt', 'order', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  return chain
}

// Wires mockFrom: first call → select chain, subsequent calls → update builder.
// Returns update/updateEq spies for assertions.
function setupDrainMock(rows: PendingRow[]) {
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const selectChain = makeSelectChain(rows)

  let fromCallCount = 0
  mockFrom.mockImplementation(() => {
    fromCallCount++
    return fromCallCount === 1 ? selectChain : { update }
  })

  return { update, updateEq }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_CHAT_ID = '111222333'
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 9001 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('GET /api/harness/notifications-drain — auth', () => {
  it('returns 401 when Authorization header is absent', async () => {
    setupDrainMock([])
    const req = new Request('http://localhost/api/harness/notifications-drain')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ── Queue processing ──────────────────────────────────────────────────────────

describe('GET /api/harness/notifications-drain — queue processing', () => {
  it('pending→sent: status=sent, sent_at populated, message_id merged into payload', async () => {
    const row: PendingRow = {
      id: 'row-1',
      channel: 'telegram',
      chat_id: '444555666',
      payload: { text: 'Hello Colin', parse_mode: 'Markdown' },
      attempts: 0,
    }
    const { update, updateEq } = setupDrainMock([row])

    const res = await GET(makeAuthorizedRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, drained: 1, failed: 0 })

    expect(update).toHaveBeenCalledOnce()
    const updatePayload = update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload.status).toBe('sent')
    expect(typeof updatePayload.sent_at).toBe('string')
    // Telegram-returned message_id (9001) merged into payload for strategy B correlation
    expect((updatePayload.payload as Record<string, unknown>).message_id).toBe(9001)
    // Original fields preserved alongside message_id
    expect((updatePayload.payload as Record<string, unknown>).text).toBe('Hello Colin')
    // eq('id', ...) targets the correct row
    expect(updateEq.mock.calls[0]).toEqual(['id', 'row-1'])
  })

  it('transient Telegram failure → attempts+1, last_error set, status key absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }))
    )

    const row: PendingRow = {
      id: 'row-2',
      channel: 'telegram',
      chat_id: '444555666',
      payload: { text: 'Retry me' },
      attempts: 1,
    }
    const { update } = setupDrainMock([row])

    const res = await GET(makeAuthorizedRequest())
    const body = await res.json()

    expect(body).toMatchObject({ ok: true, drained: 0, failed: 1 })
    const updatePayload = update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload.attempts).toBe(2) // 1 + 1
    expect(String(updatePayload.last_error)).toContain('429')
    // status key must be absent — row stays 'pending' via DB default
    expect('status' in updatePayload).toBe(false)
  })

  it('5 failed attempts → status=failed in update payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
    )

    const row: PendingRow = {
      id: 'row-3',
      channel: 'telegram',
      chat_id: '444555666',
      payload: { text: 'Final attempt' },
      attempts: 4, // 4 + 1 = 5 = MAX_ATTEMPTS → failed
    }
    const { update } = setupDrainMock([row])

    const res = await GET(makeAuthorizedRequest())
    const body = await res.json()

    expect(body.failed).toBe(1)
    const updatePayload = update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload.attempts).toBe(5)
    expect(updatePayload.status).toBe('failed')
    expect(updatePayload.last_error).toBeDefined()
  })

  it('empty queue returns {drained:0, failed:0} without calling Telegram API', async () => {
    setupDrainMock([])

    const res = await GET(makeAuthorizedRequest())
    const body = await res.json()

    expect(body).toEqual({ ok: true, drained: 0, failed: 0 })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('null chat_id falls back to TELEGRAM_CHAT_ID env var for sendMessage', async () => {
    const row: PendingRow = {
      id: 'row-4',
      channel: 'telegram',
      chat_id: null,
      payload: { text: 'Fallback chat' },
      attempts: 0,
    }
    setupDrainMock([row])

    await GET(makeAuthorizedRequest())

    const sendCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      (url as string).includes('sendMessage')
    )
    expect(sendCall).toBeDefined()
    const sentBody = JSON.parse(sendCall![1]!.body as string)
    expect(sentBody.chat_id).toBe('111222333') // TELEGRAM_CHAT_ID env default
  })

  it('payload fields (text, parse_mode, reply_markup) are forwarded to Telegram sendMessage', async () => {
    const row: PendingRow = {
      id: 'row-5',
      channel: 'telegram',
      chat_id: '999888777',
      payload: {
        text: 'Approve or reject?',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: '{"action":"approve"}' }]] },
      },
      attempts: 0,
    }
    setupDrainMock([row])

    await GET(makeAuthorizedRequest())

    const sendCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      (url as string).includes('sendMessage')
    )
    expect(sendCall).toBeDefined()
    const sentBody = JSON.parse(sendCall![1]!.body as string)
    expect(sentBody.chat_id).toBe('999888777')
    expect(sentBody.text).toBe('Approve or reject?')
    expect(sentBody.parse_mode).toBe('HTML')
    expect(sentBody.reply_markup).toBeDefined()
  })
})
