/**
 * Unit tests for app/api/telegram/webhook/route.ts.
 * Covers auth, user-id allowlist, callback_query routing, agent_events logging,
 * task_feedback write (with idempotency), and message-edit-on-tap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock telegram-buttons ─────────────────────────────────────────────────────

const { mockIsAllowedUser, mockParseCallbackData, mockParseGateCallbackData } = vi.hoisted(() => ({
  mockIsAllowedUser: vi.fn(),
  mockParseCallbackData: vi.fn(),
  mockParseGateCallbackData: vi.fn(),
}))

vi.mock('@/lib/harness/telegram-buttons', () => ({
  isAllowedUser: mockIsAllowedUser,
  parseCallbackData: mockParseCallbackData,
  parseGateCallbackData: mockParseGateCallbackData,
}))

// ── Mock deploy-gate rollbackDeployment ───────────────────────────────────────

const { mockRollbackDeployment } = vi.hoisted(() => ({
  mockRollbackDeployment: vi.fn(),
}))

vi.mock('@/lib/harness/deploy-gate', () => ({
  rollbackDeployment: mockRollbackDeployment,
}))

// ── Mock Supabase ─────────────────────────────────────────────────────────────

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

// Supports select().eq().eq().maybeSingle(), update().eq(), and insert() —
// needed because writeFeedback now calls all three paths on task_feedback.
function makeDefaultBuilder(existingRow: { id: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existingRow, error: null })
  const chain: Record<string, unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  }
  ;(chain.select as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  ;(chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(chain)

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

function makeCallbackUpdate(data: string, fromId = VALID_USER_ID, messageText = 'Task claimed') {
  return {
    update_id: 1,
    callback_query: {
      id: 'cq-id-001',
      from: { id: fromId, username: 'colinl' },
      message: { message_id: 42, chat: { id: 111 }, text: messageText },
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
  mockParseGateCallbackData.mockReturnValue(null)
  mockRollbackDeployment.mockResolvedValue({ ok: true, revert_sha: 'revertabc' })
  // Default builder handles all table operations without crashing
  mockFrom.mockReturnValue(makeDefaultBuilder())
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

  it('only writes entry/early-return observe rows on unauthorized requests (no callback row)', async () => {
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })
    const req = makeRequest({ update_id: 1 }, { 'x-telegram-bot-api-secret-token': 'wrong' })
    await POST(req)
    // entry + early-return rows are written; no telegram_callback row
    expect(agentInsert).toHaveBeenCalled()
    const taskTypes = agentInsert.mock.calls.map((c) => c[0].task_type)
    expect(taskTypes).not.toContain('telegram_callback')
    expect(taskTypes).toContain('telegram_webhook_entry')
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

  it('only writes entry/early-return observe rows when user is rejected (no callback row)', async () => {
    mockIsAllowedUser.mockReturnValue(false)
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    const taskTypes = agentInsert.mock.calls.map((c) => c[0].task_type)
    expect(taskTypes).not.toContain('telegram_callback')
    expect(taskTypes).toContain('telegram_webhook_entry')
  })
})

// ── Valid callback_query — agent_events logging ───────────────────────────────

describe('POST /api/telegram/webhook — agent_events logging', () => {
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
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    expect(agentInsert).toHaveBeenCalled()
    // calls[0] = telegram_webhook_entry; calls[1] = telegram_callback
    const row = agentInsert.mock.calls.find((c) => c[0].task_type === 'telegram_callback')?.[0]
    expect(row).toBeDefined()
    expect(row.task_type).toBe('telegram_callback')
    expect(row.status).toBe('success')
    expect(row.meta.agent_event_id).toBe(VALID_UUID)
  })

  it('writes agent_events row with warning status on unparseable callback_data', async () => {
    mockParseCallbackData.mockReturnValue(null)
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate('garbage'))
    await POST(req)
    await Promise.resolve()

    const row = agentInsert.mock.calls.find((c) => c[0].task_type === 'telegram_callback')?.[0]
    expect(row).toBeDefined()
    expect(row.status).toBe('warning')
    expect(row.meta.agent_event_id).toBeNull()
  })

  it('still returns 200 even if agent_events insert throws', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') throw new Error('db crash')
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── task_feedback write ───────────────────────────────────────────────────────

describe('POST /api/telegram/webhook — task_feedback write', () => {
  it('inserts task_feedback row with feedback_type=thumbs_up on 👍 tap', async () => {
    mockParseCallbackData.mockReturnValue({ action: 'up', agentEventId: VALID_UUID })
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    expect(fbBuilder._insert).toHaveBeenCalledOnce()
    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.feedback_type).toBe('thumbs_up')
    expect(row.agent_event_id).toBe(VALID_UUID)
  })

  it('inserts task_feedback row with feedback_type=thumbs_down on 👎 tap', async () => {
    mockParseCallbackData.mockReturnValue({ action: 'dn', agentEventId: VALID_UUID })
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:dn:${VALID_UUID}`))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.feedback_type).toBe('thumbs_down')
  })

  it('sets source=telegram_pickup_button', async () => {
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.source).toBe('telegram_pickup_button')
  })

  it('meta contains telegram_user_id, message_id, callback_query_id', async () => {
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.meta.telegram_user_id).toBe(VALID_USER_ID)
    expect(row.meta.message_id).toBe(42)
    expect(row.meta.callback_query_id).toBe('cq-id-001')
  })

  it('updates existing row when same (agent_event_id, source) already exists', async () => {
    const existingRow = { id: 'existing-feedback-uuid' }
    const fbBuilder = makeDefaultBuilder(existingRow)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    mockParseCallbackData.mockReturnValue({ action: 'dn', agentEventId: VALID_UUID })
    const req = makeRequest(makeCallbackUpdate(`tf:dn:${VALID_UUID}`))
    await POST(req)

    expect(fbBuilder._update).toHaveBeenCalledOnce()
    expect(fbBuilder._insert).not.toHaveBeenCalled()
    const updateArg = (fbBuilder._update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.feedback_type).toBe('thumbs_down')
    const eqArg = (fbBuilder._updateEq as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(eqArg[0]).toBe('id')
    expect(eqArg[1]).toBe('existing-feedback-uuid')
  })

  it('does not write task_feedback when callback_data is unparseable', async () => {
    mockParseCallbackData.mockReturnValue(null)
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate('garbage'))
    await POST(req)

    expect(fbBuilder._insert).not.toHaveBeenCalled()
    expect(fbBuilder._update).not.toHaveBeenCalled()
  })

  it('still returns 200 when writeFeedback throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('db crash')
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── Message edit on tap ───────────────────────────────────────────────────────

describe('POST /api/telegram/webhook — message edit on tap', () => {
  it('calls editMessageText after a valid tap', async () => {
    const req = makeRequest(
      makeCallbackUpdate(`tf:up:${VALID_UUID}`, VALID_USER_ID, 'Original message')
    )
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
  })

  it('edit text contains 👍 and "recorded at" on thumbs-up tap', async () => {
    mockParseCallbackData.mockReturnValue({ action: 'up', agentEventId: VALID_UUID })
    const req = makeRequest(
      makeCallbackUpdate(`tf:up:${VALID_UUID}`, VALID_USER_ID, 'Original message')
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
    expect(body.text).toContain('Original message')
  })

  it('edit text contains 👎 on thumbs-down tap', async () => {
    mockParseCallbackData.mockReturnValue({ action: 'dn', agentEventId: VALID_UUID })
    const req = makeRequest(
      makeCallbackUpdate(`tf:dn:${VALID_UUID}`, VALID_USER_ID, 'Original message')
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

  it('edit removes inline keyboard (reply_markup.inline_keyboard is empty)', async () => {
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

  it('edit targets correct chat_id and message_id', async () => {
    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )!
    const body = JSON.parse(editCall[1]!.body as string)
    expect(body.chat_id).toBe(111)
    expect(body.message_id).toBe(42)
  })

  it('does not call editMessageText when callback_data is unparseable', async () => {
    mockParseCallbackData.mockReturnValue(null)
    const req = makeRequest(makeCallbackUpdate('garbage'))
    await POST(req)
    await Promise.resolve()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeUndefined()
  })

  it('still returns 200 when editMessageText fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('editMessageText')) return Promise.reject(new Error('timeout'))
        return Promise.resolve({ ok: true })
      })
    )

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('answerCallbackQuery fires before editMessageText', async () => {
    const callOrder: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('answerCallbackQuery')) callOrder.push('answer')
        if ((url as string).includes('editMessageText')) callOrder.push('edit')
        return Promise.resolve({ ok: true })
      })
    )

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)
    await Promise.resolve()

    const answerIdx = callOrder.indexOf('answer')
    const editIdx = callOrder.indexOf('edit')
    expect(answerIdx).toBeGreaterThanOrEqual(0)
    expect(editIdx).toBeGreaterThanOrEqual(0)
    expect(answerIdx).toBeLessThan(editIdx)
  })
})

// ── Message edit await — twin of 451d1cc ─────────────────────────────────────

describe('POST /api/telegram/webhook — message edit await', () => {
  it('logs telegram_edit_fail to agent_events when editMessageText fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('editMessageText'))
          return Promise.reject(new Error('network timeout'))
        return Promise.resolve({ ok: true })
      })
    )

    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const editFailCall = agentInsert.mock.calls.find(
      (args: unknown[][]) => (args[0] as { task_type: string }).task_type === 'telegram_edit_fail'
    )
    expect(editFailCall).toBeDefined()
    const row = editFailCall![0] as Record<string, unknown>
    expect(row.status).toBe('error')
    expect(row.task_type).toBe('telegram_edit_fail')
  })

  it('error row meta contains message_id, action, and error string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('editMessageText'))
          return Promise.reject(new Error('rate limited'))
        return Promise.resolve({ ok: true })
      })
    )

    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    const editFailCall = agentInsert.mock.calls.find(
      (args: unknown[][]) => (args[0] as { task_type: string }).task_type === 'telegram_edit_fail'
    )
    const row = editFailCall![0] as { meta: Record<string, unknown> }
    expect(row.meta.message_id).toBe(42)
    expect(row.meta.action).toBe('up')
    expect(String(row.meta.error)).toContain('rate limited')
  })

  it('returns ok:true even when editMessageText fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('editMessageText')) return Promise.reject(new Error('timeout'))
        return Promise.resolve({ ok: true })
      })
    )

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('feedback row is written before edit — edit failure does not block vote', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('editMessageText')) return Promise.reject(new Error('timeout'))
        return Promise.resolve({ ok: true })
      })
    )

    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    await POST(req)

    expect(fbBuilder._insert).toHaveBeenCalledOnce()
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

// ── dg:rb: rollback callbacks ─────────────────────────────────────────────────

function makeRollbackBuilder(promotedRows: unknown[], rolledBackRows: unknown[] = []) {
  // logInsertFn: used by telegram_webhook_entry (call 1) and logWebhookEvent (call 2)
  // rollbackInsertFn: used by the rollback/rollback-failed event write (call 5+)
  const logInsertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  const rollbackInsertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  let callCount = 0
  const builder = (data: unknown[]) => {
    const p = Promise.resolve({ data, error: null })
    const b: Record<string, unknown> = {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    }
    for (const m of ['select', 'eq', 'gte', 'limit', 'filter']) {
      b[m] = vi.fn().mockReturnValue(b)
    }
    return b
  }
  return {
    mockFrom: (table: string) => {
      if (table === 'agent_events') {
        callCount++
        // Call 1: logEvent(telegram_webhook_entry) insert
        if (callCount === 1) return { insert: logInsertFn }
        // Call 2: logWebhookEvent insert
        if (callCount === 2) return { insert: logInsertFn }
        // Call 3: promoted rows lookup
        if (callCount === 3) return builder(promotedRows)
        // Call 4: rolled_back guard
        if (callCount === 4) return builder(rolledBackRows)
        // Call 5+: rollback/rollback-failed event insert
        return { insert: rollbackInsertFn }
      }
      return makeDefaultBuilder()
    },
    logInsertFn,
    rollbackInsertFn,
  }
}

describe('POST /api/telegram/webhook — dg:rb: rollback handler', () => {
  const MERGE_SHA_PREFIX = 'abcdef12'

  beforeEach(() => {
    // Switch to gate callback mode
    mockParseCallbackData.mockReturnValue(null)
    mockParseGateCallbackData.mockReturnValue({
      action: 'rollback',
      mergeShaPrefix: MERGE_SHA_PREFIX,
    })
  })

  it('calls rollbackDeployment with correct merge_sha and task_id', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(mockRollbackDeployment).toHaveBeenCalledOnce()
    const [mergeSha, taskId] = mockRollbackDeployment.mock.calls[0]
    expect(mergeSha).toBe('abcdef1234567890')
    expect(taskId).toBe('task-uuid-abc')
  })

  it('edits message to show rolled back timestamp on success', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)
    mockRollbackDeployment.mockResolvedValue({ ok: true, revert_sha: 'revert123' })

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12', VALID_USER_ID, 'Original text'))
    await POST(req)

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('↩️ rolled back at')
    expect(body.text).toContain('Original text')
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('edits message to show rollback failed when rollback returns error', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)
    mockRollbackDeployment.mockResolvedValue({ ok: false, error: 'main_moved_on' })

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12', VALID_USER_ID, 'Original'))
    await POST(req)

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('❌ rollback failed: main_moved_on')
  })

  it('double-tap guard: does not call rollbackDeployment if already rolled back', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const existingRollback = [{ id: 'evt-rb-1' }]
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow], existingRollback)
    mockFrom.mockImplementation(rbMockFrom)

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(mockRollbackDeployment).not.toHaveBeenCalled()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('↩️ already rolled back')
  })

  it('edits message with not_found error when no promoted row matches prefix', async () => {
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([]) // no promoted rows
    mockFrom.mockImplementation(rbMockFrom)

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(mockRollbackDeployment).not.toHaveBeenCalled()

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('❌ rollback failed: not_found')
  })

  it('writes deploy_gate_rolled_back row on successful rollback', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom, rollbackInsertFn } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)
    mockRollbackDeployment.mockResolvedValue({ ok: true, revert_sha: 'revert123' })

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(rollbackInsertFn).toHaveBeenCalledOnce()
    const row = rollbackInsertFn.mock.calls[0][0]
    expect(row.task_type).toBe('deploy_gate_rolled_back')
    expect(row.status).toBe('success')
    expect(row.meta.merge_sha).toBe('abcdef1234567890')
    expect(row.meta.revert_sha).toBe('revert123')
  })

  it('writes deploy_gate_rollback_failed row when rollback fails', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom, rollbackInsertFn } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)
    mockRollbackDeployment.mockResolvedValue({ ok: false, error: 'api_error' })

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(rollbackInsertFn).toHaveBeenCalledOnce()
    const row = rollbackInsertFn.mock.calls[0][0]
    expect(row.task_type).toBe('deploy_gate_rollback_failed')
    expect(row.status).toBe('error')
    expect(row.meta.error).toBe('api_error')
  })

  it('still returns 200 even when rollback throws', async () => {
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid-abc', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation(rbMockFrom)
    mockRollbackDeployment.mockRejectedValue(new Error('unexpected crash'))

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
