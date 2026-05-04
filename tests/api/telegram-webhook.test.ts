/**
 * Unit tests for app/api/telegram/webhook/route.ts.
 * Covers auth, user-id allowlist, callback_query routing, agent_events logging,
 * task_feedback write (with idempotency), and message-edit-on-tap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock telegram-buttons ─────────────────────────────────────────────────────

const {
  mockIsAllowedUser,
  mockParseCallbackData,
  mockParseGateCallbackData,
  mockParseImproveCallbackData,
  mockParsePushBashCallbackData,
} = vi.hoisted(() => ({
  mockIsAllowedUser: vi.fn(),
  mockParseCallbackData: vi.fn(),
  mockParseGateCallbackData: vi.fn(),
  mockParseImproveCallbackData: vi.fn().mockReturnValue(null), // default: not an improve callback
  mockParsePushBashCallbackData: vi.fn().mockReturnValue(null), // default: not a push_bash callback
}))

vi.mock('@/lib/harness/telegram-buttons', () => ({
  isAllowedUser: mockIsAllowedUser,
  parseCallbackData: mockParseCallbackData,
  parseGateCallbackData: mockParseGateCallbackData,
  parseImproveCallbackData: mockParseImproveCallbackData,
  parsePushBashCallbackData: mockParsePushBashCallbackData,
}))

// ── Mock deploy-gate functions ────────────────────────────────────────────────

const { mockRollbackDeployment, mockMergeToMain, mockDeleteBranch, mockSendPromotionNotification } =
  vi.hoisted(() => ({
    mockRollbackDeployment: vi.fn(),
    mockMergeToMain: vi.fn(),
    mockDeleteBranch: vi.fn(),
    mockSendPromotionNotification: vi.fn(),
  }))

vi.mock('@/lib/harness/deploy-gate', () => ({
  rollbackDeployment: mockRollbackDeployment,
  mergeToMain: mockMergeToMain,
  deleteBranch: mockDeleteBranch,
  sendPromotionNotification: mockSendPromotionNotification,
}))

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: vi.fn().mockResolvedValue({
    runId: 'mock-run-id',
    sandboxId: 'mock-sandbox',
    worktreePath: '/tmp/mock',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    timedOut: false,
    durationMs: 10,
    filesChanged: [],
    diffStat: { insertions: 0, deletions: 0, files: 0 },
    diffHash: 'abc',
    warnings: [],
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/telegram/webhook/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-webhook-secret-abc123'
const VALID_USER_ID = 987654321
const VALID_UUID = '885ff1e3-baed-4512-8e7a-8335995ea057'

// Supports the full chain used by findMatchingRow (filter/is/gte/order/limit)
// plus select().eq().maybeSingle(), update().eq(), and insert().
function makeDefaultBuilder(existingRow: { id: string } | null = null) {
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
  mockMergeToMain.mockResolvedValue({ ok: true, merge_sha: 'mergeshaabcdef' })
  mockDeleteBranch.mockResolvedValue(true)
  mockSendPromotionNotification.mockResolvedValue({ ok: true, message_id: 9999 })
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

// ── dg:promote: / dg:abort: handler helpers ───────────────────────────────────

// DB call sequence for promote/abort:
//   1: logEvent(entry) insert
//   2: logWebhookEvent insert
//   3: migration_review_sent query (returns reviewRows)
//   4: resolved rows query (returns resolvedRows) — only if review row found
//   5+: handler-specific inserts
function makeMigrationGateBuilder(reviewRows: unknown[], resolvedRows: unknown[] = []) {
  const logInsertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  const gateInsertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  let callCount = 0
  const qb = (data: unknown[]) => {
    const p = Promise.resolve({ data, error: null })
    const b: Record<string, unknown> = {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    }
    for (const m of ['select', 'eq', 'in', 'gte', 'limit', 'filter']) {
      b[m] = vi.fn().mockReturnValue(b)
    }
    return b
  }
  return {
    // Only count agent_events calls — outbound_notifications is from findMatchingRow
    // and must be handled separately so it doesn't break the promote/abort call sequence.
    mockFrom: (table: string) => {
      if (table === 'outbound_notifications') return makeDefaultBuilder()
      callCount++
      if (callCount === 1) return { insert: logInsertFn } // entry insert
      if (callCount === 2) return { insert: logInsertFn } // callback insert
      if (callCount === 3) return qb(reviewRows) // migration_review_sent query
      if (callCount === 4) return qb(resolvedRows) // resolved double-tap guard
      return { insert: gateInsertFn } // handler inserts
    },
    logInsertFn,
    gateInsertFn,
  }
}

// ── dg:promote: promote handler ───────────────────────────────────────────────

describe('POST /api/telegram/webhook — dg:promote: promote handler', () => {
  const COMMIT_SHA = 'f3f43eb1deadbeef0000000000000000000000000'
  const SHA_PREFIX = 'f3f43eb1'
  const BRANCH = 'harness/task-migration-abc'
  const TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'

  function makeReviewRow() {
    return {
      id: 'evt-review-1',
      meta: { commit_sha: COMMIT_SHA, task_id: TASK_ID, branch: BRANCH },
    }
  }

  beforeEach(() => {
    mockParseCallbackData.mockReturnValue(null)
    mockParseGateCallbackData.mockReturnValue({ action: 'promote', commitShaPrefix: SHA_PREFIX })
  })

  it('calls mergeToMain with correct branch and commit_sha', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    expect(mockMergeToMain).toHaveBeenCalledOnce()
    const [branch, _taskId, commitSha] = mockMergeToMain.mock.calls[0]
    expect(branch).toBe(BRANCH)
    expect(commitSha).toBe(COMMIT_SHA)
  })

  it('writes deploy_gate_promoted row with source=migration_review on success', async () => {
    const { mockFrom: pmf, gateInsertFn } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockMergeToMain.mockResolvedValue({ ok: true, merge_sha: 'newmergesha' })
    mockSendPromotionNotification.mockResolvedValue({ ok: false })

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    const promotedRow = gateInsertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_promoted'
    )
    expect(promotedRow).toBeDefined()
    expect(promotedRow![0].status).toBe('success')
    expect(promotedRow![0].meta.source).toBe('migration_review')
    expect(promotedRow![0].meta.commit_sha).toBe(COMMIT_SHA)
    expect(promotedRow![0].meta.merge_sha).toBe('newmergesha')
  })

  it('edits message with promoted timestamp on success', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockMergeToMain.mockResolvedValue({ ok: true, merge_sha: 'newmergesha' })
    mockSendPromotionNotification.mockResolvedValue({ ok: false })

    await POST(
      makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`, VALID_USER_ID, 'Original text'))
    )

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('promoted (migration approved) at')
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('writes deploy_gate_migration_promote_failed and keeps buttons when merge fails', async () => {
    const { mockFrom: pmf, gateInsertFn } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockMergeToMain.mockResolvedValue({ ok: false, error: 'conflict' })

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    const failRow = gateInsertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_migration_promote_failed'
    )
    expect(failRow).toBeDefined()
    expect(failRow![0].status).toBe('error')
    expect(failRow![0].meta.error).toBe('conflict')

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('promote failed')
    expect(body.text).toContain('tap to retry')
    expect(body.reply_markup).toBeUndefined()
  })

  it('does not call merge and edits with not_found when review row missing', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([])
    mockFrom.mockImplementation(pmf)

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    expect(mockMergeToMain).not.toHaveBeenCalled()
    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('promote failed: not_found')
  })

  it('double-tap guard: does not merge if already resolved', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()], [{ id: 'resolved-1' }])
    mockFrom.mockImplementation(pmf)

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    expect(mockMergeToMain).not.toHaveBeenCalled()
    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('already resolved')
  })

  it('writes notification_sent row when sendPromotionNotification returns message_id', async () => {
    const { mockFrom: pmf, gateInsertFn } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockMergeToMain.mockResolvedValue({ ok: true, merge_sha: 'newmergesha' })
    mockSendPromotionNotification.mockResolvedValue({ ok: true, message_id: 7777 })

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    const notifRow = gateInsertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_notification_sent'
    )
    expect(notifRow).toBeDefined()
    expect(notifRow![0].meta.message_id).toBe(7777)
    expect(notifRow![0].meta.source).toBe('migration_review')
  })

  it('returns 200 even when mergeToMain throws', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockMergeToMain.mockRejectedValue(new Error('unexpected'))

    const res = await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))
    expect(res.status).toBe(200)
  })

  it('calls deleteBranch with the correct branch after successful promote', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)

    await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))

    expect(mockDeleteBranch).toHaveBeenCalledOnce()
    expect(mockDeleteBranch.mock.calls[0][0]).toBe(BRANCH)
  })

  it('returns 200 even when deleteBranch throws after promote', async () => {
    const { mockFrom: pmf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(pmf)
    mockDeleteBranch.mockRejectedValue(new Error('branch delete failed'))

    const res = await POST(makeRequest(makeCallbackUpdate(`dg:promote:${SHA_PREFIX}`)))
    expect(res.status).toBe(200)
    expect(mockMergeToMain).toHaveBeenCalledOnce()
  })
})

// ── dg:abort: abort handler ───────────────────────────────────────────────────

describe('POST /api/telegram/webhook — dg:abort: abort handler', () => {
  const COMMIT_SHA = 'f3f43eb1deadbeef0000000000000000000000000'
  const SHA_PREFIX = 'f3f43eb1'
  const BRANCH = 'harness/task-migration-abc'
  const TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'

  function makeReviewRow() {
    return {
      id: 'evt-review-1',
      meta: { commit_sha: COMMIT_SHA, task_id: TASK_ID, branch: BRANCH },
    }
  }

  beforeEach(() => {
    mockParseCallbackData.mockReturnValue(null)
    mockParseGateCallbackData.mockReturnValue({ action: 'abort', commitShaPrefix: SHA_PREFIX })
  })

  it('writes deploy_gate_migration_aborted row with reason=user_abort', async () => {
    const { mockFrom: amf, gateInsertFn } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(amf)

    await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`)))

    const abortRow = gateInsertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_migration_aborted'
    )
    expect(abortRow).toBeDefined()
    expect(abortRow![0].status).toBe('success')
    expect(abortRow![0].meta.commit_sha).toBe(COMMIT_SHA)
    expect(abortRow![0].meta.reason).toBe('user_abort')
  })

  it('edits message with aborted timestamp on success', async () => {
    const { mockFrom: amf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(amf)

    await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`, VALID_USER_ID, 'Original')))

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('aborted at')
    expect(body.text).toContain('no promotion')
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('calls deleteBranch with the correct branch', async () => {
    const { mockFrom: amf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(amf)

    await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`)))

    expect(mockDeleteBranch).toHaveBeenCalledOnce()
    expect(mockDeleteBranch.mock.calls[0][0]).toBe(BRANCH)
  })

  it('does not call deleteBranch and edits with not_found when review row missing', async () => {
    const { mockFrom: amf } = makeMigrationGateBuilder([])
    mockFrom.mockImplementation(amf)

    await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`)))

    expect(mockDeleteBranch).not.toHaveBeenCalled()
    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('abort failed: not_found')
  })

  it('double-tap guard: does not abort if already resolved', async () => {
    const { mockFrom: amf, gateInsertFn } = makeMigrationGateBuilder(
      [makeReviewRow()],
      [{ id: 'already-1' }]
    )
    mockFrom.mockImplementation(amf)

    await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`)))

    const abortRow = gateInsertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_migration_aborted'
    )
    expect(abortRow).toBeUndefined()
    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.text).toContain('already resolved')
  })

  it('returns 200 even when deleteBranch throws', async () => {
    const { mockFrom: amf } = makeMigrationGateBuilder([makeReviewRow()])
    mockFrom.mockImplementation(amf)
    mockDeleteBranch.mockRejectedValue(new Error('branch delete failed'))

    const res = await POST(makeRequest(makeCallbackUpdate(`dg:abort:${SHA_PREFIX}`)))
    expect(res.status).toBe(200)
  })
})

// ── Queue-loop correlation acceptance tests ────────────────────────────────────
// Tests 4-6 from the outbound_notifications acceptance spec:
//   4. Strategy A: callback_query + correlation_id → response_received
//   5. Strategy B: reply_to_message match → response_received (see dispatch order)
//   6. Strategy C: bare message 24h fallback → response_received
// Tests 7-9: routing guards (thumbs/gate/no-match — see dispatch order block)

describe('POST /api/telegram/webhook — queue-loop correlation', () => {
  function makeOutboundBuilderQL(matchedId: string | null) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: matchedId ? { id: matchedId } : null,
      error: null,
    })
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
    return { ...chain, update, _update: update, _updateEq: updateEq }
  }

  it('strategy A: callback_query with JSON {correlation_id} → response captured with type=callback and callback_data', async () => {
    const outbound = makeOutboundBuilderQL('corr-match-id')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const CORR_ID = 'ab12cd34'
    const req = makeRequest(
      makeCallbackUpdate(JSON.stringify({ correlation_id: CORR_ID, action: 'approve' }))
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(outbound._update).toHaveBeenCalledOnce()
    const updateArg = (outbound._update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('response_received')
    expect(updateArg.response.type).toBe('callback')
    expect(updateArg.response.callback_data).toBe(
      JSON.stringify({ correlation_id: CORR_ID, action: 'approve' })
    )
    expect(typeof updateArg.response_received_at).toBe('string')
  })

  it('strategy C: bare message with no reply_to, no correlation_id → response_received via 24h fallback', async () => {
    // Strategy A skipped (no callback_query), Strategy B skipped (no reply_to_message).
    // Strategy C query fires and returns a match.
    const outbound = makeOutboundBuilderQL('strategy-c-row')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest({
      update_id: 202,
      message: {
        message_id: 300,
        chat: { id: 111 },
        from: { id: VALID_USER_ID, username: 'colinl' },
        text: 'looks good, proceed',
        // No reply_to_message
      },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(outbound._update).toHaveBeenCalledOnce()
    const updateArg = (outbound._update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('response_received')
    expect(updateArg.response.type).toBe('message')
    expect(updateArg.response.text).toBe('looks good, proceed')
    const eqArg = (outbound._updateEq as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(eqArg[1]).toBe('strategy-c-row')
  })

  it('unmatched callback_query with no outbound match → webhook_no_match NOT logged (falls to legacy handlers), returns 200', async () => {
    // When a callback_query has no outbound_notifications match, the code falls
    // through to parseCallbackData / parseGateCallbackData, not webhook_no_match.
    // webhook_no_match is only logged for plain messages that have no match.
    mockParseCallbackData.mockReturnValue(null)
    mockParseGateCallbackData.mockReturnValue(null)

    const outbound = makeOutboundBuilderQL(null)
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest(makeCallbackUpdate('unknown:payload:xyz'))
    const res = await POST(req)

    expect(res.status).toBe(200)
    const noMatchCall = agentInsert.mock.calls.find(
      (c: unknown[]) => (c[0] as { task_type: string }).task_type === 'webhook_no_match'
    )
    // Unmatched callback_query does NOT log webhook_no_match — that path is for plain messages only
    expect(noMatchCall).toBeUndefined()
    // legacy thumbs/gate do not fire either (both parsers return null)
    expect(mockRollbackDeployment).not.toHaveBeenCalled()
    expect(mockMergeToMain).not.toHaveBeenCalled()
  })
})

// ── Dispatch order: outbound_notifications > thumbs > deploy-gate > no-match ──

describe('POST /api/telegram/webhook — dispatch order', () => {
  // Builder for outbound_notifications table: returns a match or null, and
  // exposes _update so tests can assert the row was written.
  function makeOutboundBuilder(matchedId: string | null) {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: matchedId ? { id: matchedId } : null,
      error: null,
    })
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
    return { ...chain, update, _update: update, _updateEq: updateEq }
  }

  it('callback_query with JSON {correlation_id} routes to outbound_notifications, not legacy thumbs', async () => {
    // parseCallbackData default mock returns a thumbs parse — must NOT be used
    const outbound = makeOutboundBuilder('matched-row-id')
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest(makeCallbackUpdate(JSON.stringify({ correlation_id: 'corr-abc' })))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(outbound._update).toHaveBeenCalledOnce()
    const updateArg = (outbound._update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('response_received')
    expect(updateArg.response.type).toBe('callback')
    // Legacy thumbs path must NOT have run
    expect(fbBuilder._insert).not.toHaveBeenCalled()
    expect(fbBuilder._update).not.toHaveBeenCalled()
  })

  it('callback_query with legacy thumbs pattern routes to thumbs when no outbound match', async () => {
    // outbound_notifications returns no match
    const outbound = makeOutboundBuilder(null)
    const fbBuilder = makeDefaultBuilder(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      if (table === 'task_feedback') return fbBuilder
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })
    // parseCallbackData default mock returns thumbs parse (set in beforeEach)

    const req = makeRequest(makeCallbackUpdate(`tf:up:${VALID_UUID}`))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(outbound._update).not.toHaveBeenCalled()
    expect(fbBuilder._insert).toHaveBeenCalledOnce()
    const row = (fbBuilder._insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(row.feedback_type).toBe('thumbs_up')
  })

  it('callback_query with deploy-gate pattern routes to deploy-gate when no outbound match', async () => {
    mockParseCallbackData.mockReturnValue(null)
    mockParseGateCallbackData.mockReturnValue({ action: 'rollback', mergeShaPrefix: 'abcdef12' })

    const outbound = makeOutboundBuilder(null)
    // Use makeRollbackBuilder to satisfy the agent_events call sequence
    const promotedRow = {
      id: 'evt-promo-1',
      meta: { merge_sha: 'abcdef1234567890', task_id: 'task-uuid', commit_sha: 'commit1' },
    }
    const { mockFrom: rbMockFrom } = makeRollbackBuilder([promotedRow])
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      return rbMockFrom(table)
    })

    const req = makeRequest(makeCallbackUpdate('dg:rb:abcdef12'))
    await POST(req)

    expect(outbound._update).not.toHaveBeenCalled()
    expect(mockRollbackDeployment).toHaveBeenCalledOnce()
  })

  it('message with reply_to_message matching a pending row routes to outbound_notifications', async () => {
    const REPLY_TO_ID = 9999
    const outbound = makeOutboundBuilder('matched-reply-row')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = makeRequest({
      update_id: 42,
      message: {
        message_id: 1000,
        chat: { id: 111 },
        from: { id: VALID_USER_ID, username: 'colinl' },
        text: 'my reply',
        reply_to_message: { message_id: REPLY_TO_ID },
      },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(outbound._update).toHaveBeenCalledOnce()
    const updateArg = (outbound._update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('response_received')
    expect(updateArg.response.type).toBe('message')
    expect(updateArg.response.text).toBe('my reply')
  })

  it('message with no outbound match logs webhook_no_match and returns 200', async () => {
    const outbound = makeOutboundBuilder(null)
    const agentInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'outbound_notifications') return outbound
      if (table === 'agent_events') return { insert: agentInsert }
      return makeDefaultBuilder()
    })

    const req = makeRequest({
      update_id: 99,
      message: {
        message_id: 500,
        chat: { id: 111 },
        from: { id: VALID_USER_ID, username: 'colinl' },
        text: 'hello no match',
      },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const noMatchCall = agentInsert.mock.calls.find((c) => c[0].task_type === 'webhook_no_match')
    expect(noMatchCall).toBeDefined()
    expect(noMatchCall![0].status).toBe('warning')
    expect(noMatchCall![0].meta.is_callback).toBe(false)
    // Legacy thumbs/gate must NOT have run
    expect(mockRollbackDeployment).not.toHaveBeenCalled()
    expect(mockMergeToMain).not.toHaveBeenCalled()
  })
})
