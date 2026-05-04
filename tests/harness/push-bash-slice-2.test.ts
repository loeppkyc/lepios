/**
 * push_bash_automation Slice 2 — Acceptance tests
 *
 * AC-1  through AC-4:  Callback builder/parser unit tests (pure)
 * AC-5  through AC-7:  Executor confirm tier — inline keyboard send
 * AC-8  through AC-11: Webhook handlers — approve/deny idempotency
 * AC-12:               HTTP shape test for confirm tier
 * AC-13:               Slice 1 tests still pass (verified by running push-bash.test.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (hoisted before any imports) ─────────────────────────────────────────

const { mockRunInSandbox, mockFrom, mockTelegram, mockEditTelegramMessage } = vi.hoisted(() => {
  const mockRunInSandbox = vi.fn()
  const mockFrom = vi.fn()
  const mockTelegram = vi.fn().mockResolvedValue({ ok: true })
  // editTelegramMessage is defined inside the route file using fetch —
  // we mock fetch globally to intercept editMessageText calls
  const mockEditTelegramMessage = vi.fn().mockResolvedValue(undefined)
  return { mockRunInSandbox, mockFrom, mockTelegram, mockEditTelegramMessage }
})

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: mockRunInSandbox,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/harness/arms-legs', () => ({
  telegram: mockTelegram,
}))

vi.mock('@/lib/harness/arms-legs/telegram', () => ({
  telegram: mockTelegram,
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { buildPushBashCallback, parsePushBashCallbackData } from '@/lib/harness/telegram-buttons'
import { executeDecision } from '@/lib/harness/push-bash/executor'
import { POST } from '@/app/api/harness/push-bash/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const SAMPLE_UUID = '12345678-1234-1234-1234-123456789abc'
const SAMPLE_UUID2 = 'aaaabbbb-cccc-dddd-eeee-ffff00001111'
const VALID_SECRET = 'test-push-bash-secret'

function makeRequest(body: unknown, secret: string | null = VALID_SECRET): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['Authorization'] = `Bearer ${secret}`
  return new Request('http://localhost/api/harness/push-bash', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/** Build a DB chain that supports .insert().select().single() */
function makeInsertChain(id = 'test-decision-uuid') {
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

/** Build a DB chain that supports .update().eq().catch() */
function makeUpdateChain() {
  const catchFn = vi.fn().mockResolvedValue(undefined)
  const eq = vi.fn().mockReturnValue({ catch: catchFn })
  const update = vi.fn().mockReturnValue({ eq })
  return { update, eq, catch: catchFn }
}

/** Build a DB chain that supports .select().eq().maybeSingle() */
function makeSelectChain(data: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, maybeSingle }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_ALERTS_BOT_TOKEN = 'test-alerts-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ALERTS_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── AC-1: approve round-trip ───────────────────────────────────────────────────

describe('AC-1: buildPushBashCallback + parsePushBashCallbackData — approve round-trip', () => {
  it('parses approve callback back to original values', () => {
    const encoded = buildPushBashCallback('approve', SAMPLE_UUID)
    const result = parsePushBashCallbackData(encoded)
    expect(result).not.toBeNull()
    expect(result?.action).toBe('approve')
    expect(result?.decisionId).toBe(SAMPLE_UUID)
  })
})

// ── AC-2: deny round-trip ─────────────────────────────────────────────────────

describe('AC-2: parsePushBashCallbackData — deny round-trip', () => {
  it('parses deny callback back to original values', () => {
    const encoded = buildPushBashCallback('deny', SAMPLE_UUID)
    const result = parsePushBashCallbackData(encoded)
    expect(result).not.toBeNull()
    expect(result?.action).toBe('deny')
    expect(result?.decisionId).toBe(SAMPLE_UUID)
  })
})

// ── AC-3: rejects non-pb prefixes ─────────────────────────────────────────────

describe('AC-3: parsePushBashCallbackData — rejects non-pb prefixes', () => {
  it('returns null for tf: prefix', () => {
    expect(parsePushBashCallbackData(`tf:up:${SAMPLE_UUID}`)).toBeNull()
  })

  it('returns null for dg:rb: prefix', () => {
    expect(parsePushBashCallbackData('dg:rb:abcd1234')).toBeNull()
  })

  it('returns null for improve_ prefix', () => {
    expect(parsePushBashCallbackData('improve_approve_all:x')).toBeNull()
  })
})

// ── AC-4: rejects malformed UUID ──────────────────────────────────────────────

describe('AC-4: parsePushBashCallbackData — rejects malformed UUID', () => {
  it('returns null for non-UUID third segment', () => {
    expect(parsePushBashCallbackData('pb:approve:not-a-uuid')).toBeNull()
  })

  it('returns null for short UUID', () => {
    expect(parsePushBashCallbackData('pb:approve:12345678-1234-1234-1234')).toBeNull()
  })
})

// ── AC-5: confirm executor sends replyMarkup with approve + deny buttons ───────

describe('AC-5: confirm executor sends replyMarkup with approve + deny buttons', () => {
  it('telegram called once with 2-button inline_keyboard, callback_data parses correctly', async () => {
    // DB insert chain
    const { insert } = makeInsertChain(SAMPLE_UUID)
    // DB update chain (for telegram_message_id)
    const updateChain = makeUpdateChain()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { insert, ...updateChain }
      }
      return { insert }
    })

    // telegram returns no messageId so update won't fire
    mockTelegram.mockResolvedValueOnce({ ok: true })

    await executeDecision('git commit -m "test"', { tier: 'confirm', reason: 'Needs review' })

    expect(mockTelegram).toHaveBeenCalledTimes(1)
    const callArgs = mockTelegram.mock.calls[0]
    const options = callArgs[1] as {
      replyMarkup: { inline_keyboard: { text: string; callback_data: string }[][] }
    }
    expect(options.replyMarkup).toBeDefined()
    const keyboard = options.replyMarkup.inline_keyboard[0]
    expect(keyboard).toHaveLength(2)

    // Verify callback_data parses correctly
    const approveData = parsePushBashCallbackData(keyboard[0].callback_data)
    expect(approveData?.action).toBe('approve')
    expect(approveData?.decisionId).toBe(SAMPLE_UUID)

    const denyData = parsePushBashCallbackData(keyboard[1].callback_data)
    expect(denyData?.action).toBe('deny')
    expect(denyData?.decisionId).toBe(SAMPLE_UUID)
  })
})

// ── AC-6: confirm executor stores telegram_message_id when returned ────────────

describe('AC-6: confirm executor stores telegram_message_id when returned', () => {
  it('DB UPDATE called with telegram_message_id = 42 when telegram returns messageId', async () => {
    const { insert } = makeInsertChain(SAMPLE_UUID)
    const updateChain = makeUpdateChain()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { insert, ...updateChain }
      }
      return { insert }
    })

    mockTelegram.mockResolvedValueOnce({ ok: true, messageId: 42 })

    await executeDecision('git commit -m "test"', { tier: 'confirm', reason: 'Needs review' })

    expect(updateChain.update).toHaveBeenCalledWith({ telegram_message_id: 42 })
  })
})

// ── AC-7: confirm executor non-fatal when telegram returns no messageId ─────────

describe('AC-7: confirm executor non-fatal when telegram returns no messageId', () => {
  it('no exception thrown and returns pending status when no messageId in response', async () => {
    const { insert } = makeInsertChain(SAMPLE_UUID)
    mockFrom.mockReturnValue({ insert })

    mockTelegram.mockResolvedValueOnce({ ok: true })

    const result = await executeDecision('git commit -m "test"', {
      tier: 'confirm',
      reason: 'Needs review',
    })

    expect(result.status).toBe('pending')
  })
})

// ── AC-8: handlePushBashApprove — pending row → runs sandbox, updates to approved

describe('AC-8: handlePushBashApprove via webhook — pending row → sandbox + approved', () => {
  it('DB UPDATE called with status=approved, editMessageText receives ✅ approved text', async () => {
    // Mock fetch for answerCallbackQuery and editMessageText
    const fetchCalls: { url: string; body: unknown }[] = []
    const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      fetchCalls.push({ url: url as string, body: JSON.parse(opts.body as string) })
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    })
    vi.stubGlobal('fetch', mockFetch)

    // Mock sandbox result
    mockRunInSandbox.mockResolvedValue({
      runId: SAMPLE_UUID2,
      sandboxId: 'push_bash_automation:sb',
      worktreePath: '/tmp/worktrees/sb',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
      durationMs: 100,
      filesChanged: [],
      diffStat: { insertions: 0, deletions: 0, files: 0 },
      diffHash: 'abc',
      warnings: [],
    })

    // DB select chain returns pending row
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: SAMPLE_UUID, cmd: 'git status', status: 'pending' },
      error: null,
    })
    const selectEq = vi.fn().mockReturnValue({ maybeSingle })
    const selectFn = vi.fn().mockReturnValue({ eq: selectEq })

    // DB update chain for approved status
    const updateCatch = vi.fn().mockResolvedValue(undefined)
    const updateEq = vi.fn().mockReturnValue({ catch: updateCatch })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })

    // Also need insert chain for agent_events (logWebhookEvent)
    const insertSingle = vi.fn().mockResolvedValue({ data: { id: 'evt-id' }, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insertFn = vi.fn().mockReturnValue({ select: insertSelect })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { select: selectFn, update: updateFn }
      }
      if (table === 'outbound_notifications') {
        // findMatchingRow calls: no match
        const ms = vi.fn().mockResolvedValue({ data: null, error: null })
        const eq2 = vi
          .fn()
          .mockReturnValue({
            maybeSingle: ms,
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: ms,
                filter: vi.fn().mockReturnValue({ maybeSingle: ms }),
              }),
          })
        const sel = vi.fn().mockReturnValue({ eq: eq2 })
        return { select: sel }
      }
      // agent_events + task_queue + task_feedback
      return {
        insert: insertFn,
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi
                      .fn()
                      .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
                  }),
              }),
          }),
      }
    })

    // Simulate webhook POST for approve callback
    const webhookBody = {
      update_id: 1,
      callback_query: {
        id: 'cq-id',
        from: { id: Number(process.env.TELEGRAM_ALLOWED_USER_ID ?? '99999') },
        message: {
          message_id: 100,
          chat: { id: 111 },
          text: '⏸ push_bash confirm\n`git status`\nNeeds review',
        },
        data: buildPushBashCallback('approve', SAMPLE_UUID),
      },
    }

    process.env.TELEGRAM_WEBHOOK_SECRET = 'wh-secret'
    process.env.TELEGRAM_ALLOWED_USER_ID = '99999'

    const req = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wh-secret',
      },
      body: JSON.stringify(webhookBody),
    })

    const { POST: webhookPOST } = await import('@/app/api/telegram/webhook/route')
    const res = await webhookPOST(req as Parameters<typeof webhookPOST>[0])
    expect(res.status).toBe(200)

    // Verify DB update was called with approved status
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', exit_code: 0 })
    )

    // Verify editMessageText was called with ✅ approved text
    const editCall = fetchCalls.find(
      (c) => typeof c.url === 'string' && c.url.includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const editBody = editCall!.body as { text: string }
    expect(editBody.text).toContain('✅ approved')

    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.TELEGRAM_ALLOWED_USER_ID
    vi.unstubAllGlobals()
  })
})

// ── AC-9: handlePushBashApprove — idempotency guard ───────────────────────────

describe('AC-9: handlePushBashApprove — idempotency guard', () => {
  it('sandbox not called and editMessageText contains "already resolved" when row already approved', async () => {
    const fetchCalls: { url: string; body: unknown }[] = []
    const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      fetchCalls.push({ url: url as string, body: JSON.parse(opts.body as string) })
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    })
    vi.stubGlobal('fetch', mockFetch)

    // DB select returns already-approved row
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: SAMPLE_UUID, cmd: 'git status', status: 'approved' },
      error: null,
    })
    const selectEq = vi.fn().mockReturnValue({ maybeSingle })
    const selectFn = vi.fn().mockReturnValue({ eq: selectEq })
    const updateFn = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { select: selectFn, update: updateFn }
      }
      if (table === 'outbound_notifications') {
        const ms = vi.fn().mockResolvedValue({ data: null })
        const eq2 = vi
          .fn()
          .mockReturnValue({
            maybeSingle: ms,
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: ms,
                filter: vi.fn().mockReturnValue({ maybeSingle: ms }),
              }),
          })
        return { select: vi.fn().mockReturnValue({ eq: eq2 }) }
      }
      return {
        insert: vi
          .fn()
          .mockReturnValue({
            select: vi
              .fn()
              .mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'e' } }) }),
          }),
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi
                      .fn()
                      .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
                  }),
              }),
          }),
      }
    })

    process.env.TELEGRAM_WEBHOOK_SECRET = 'wh-secret'
    process.env.TELEGRAM_ALLOWED_USER_ID = '99999'

    const webhookBody = {
      update_id: 2,
      callback_query: {
        id: 'cq-id2',
        from: { id: 99999 },
        message: {
          message_id: 101,
          chat: { id: 111 },
          text: '⏸ push_bash confirm\n`git status`\nNeeds review',
        },
        data: buildPushBashCallback('approve', SAMPLE_UUID),
      },
    }

    const req = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wh-secret',
      },
      body: JSON.stringify(webhookBody),
    })

    const { POST: webhookPOST } = await import('@/app/api/telegram/webhook/route')
    const res = await webhookPOST(req as Parameters<typeof webhookPOST>[0])
    expect(res.status).toBe(200)

    // Sandbox should NOT be called
    expect(mockRunInSandbox).not.toHaveBeenCalled()

    // editMessageText should contain "already resolved"
    const editCall = fetchCalls.find(
      (c) => typeof c.url === 'string' && c.url.includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const editBody = editCall!.body as { text: string }
    expect(editBody.text).toContain('already resolved')

    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.TELEGRAM_ALLOWED_USER_ID
    vi.unstubAllGlobals()
  })
})

// ── AC-10: handlePushBashDeny — pending row → marks denied ───────────────────

describe('AC-10: handlePushBashDeny — pending row → marks denied, edits message', () => {
  it('DB UPDATE called with status=denied, editMessageText contains 🚫 denied', async () => {
    const fetchCalls: { url: string; body: unknown }[] = []
    const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      fetchCalls.push({ url: url as string, body: JSON.parse(opts.body as string) })
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    })
    vi.stubGlobal('fetch', mockFetch)

    // DB select returns pending row
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: SAMPLE_UUID, status: 'pending' },
      error: null,
    })
    const selectEq = vi.fn().mockReturnValue({ maybeSingle })
    const selectFn = vi.fn().mockReturnValue({ eq: selectEq })

    const updateCatch = vi.fn().mockResolvedValue(undefined)
    const updateEq = vi.fn().mockReturnValue({ catch: updateCatch })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { select: selectFn, update: updateFn }
      }
      if (table === 'outbound_notifications') {
        const ms = vi.fn().mockResolvedValue({ data: null })
        const eq2 = vi
          .fn()
          .mockReturnValue({
            maybeSingle: ms,
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: ms,
                filter: vi.fn().mockReturnValue({ maybeSingle: ms }),
              }),
          })
        return { select: vi.fn().mockReturnValue({ eq: eq2 }) }
      }
      return {
        insert: vi
          .fn()
          .mockReturnValue({
            select: vi
              .fn()
              .mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'e' } }) }),
          }),
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi
                      .fn()
                      .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
                  }),
              }),
          }),
      }
    })

    process.env.TELEGRAM_WEBHOOK_SECRET = 'wh-secret'
    process.env.TELEGRAM_ALLOWED_USER_ID = '99999'

    const webhookBody = {
      update_id: 3,
      callback_query: {
        id: 'cq-id3',
        from: { id: 99999 },
        message: {
          message_id: 102,
          chat: { id: 111 },
          text: '⏸ push_bash confirm\n`git status`\nNeeds review',
        },
        data: buildPushBashCallback('deny', SAMPLE_UUID),
      },
    }

    const req = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wh-secret',
      },
      body: JSON.stringify(webhookBody),
    })

    const { POST: webhookPOST } = await import('@/app/api/telegram/webhook/route')
    const res = await webhookPOST(req as Parameters<typeof webhookPOST>[0])
    expect(res.status).toBe(200)

    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'denied' }))

    const editCall = fetchCalls.find(
      (c) => typeof c.url === 'string' && c.url.includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const editBody = editCall!.body as { text: string }
    expect(editBody.text).toContain('🚫 denied')

    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.TELEGRAM_ALLOWED_USER_ID
    vi.unstubAllGlobals()
  })
})

// ── AC-11: handlePushBashDeny — idempotency guard ─────────────────────────────

describe('AC-11: handlePushBashDeny — idempotency guard', () => {
  it('UPDATE not called again and editMessageText contains "already resolved" when row already denied', async () => {
    const fetchCalls: { url: string; body: unknown }[] = []
    const mockFetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      fetchCalls.push({ url: url as string, body: JSON.parse(opts.body as string) })
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    })
    vi.stubGlobal('fetch', mockFetch)

    // DB select returns already-denied row
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: SAMPLE_UUID, status: 'denied' },
      error: null,
    })
    const selectEq = vi.fn().mockReturnValue({ maybeSingle })
    const selectFn = vi.fn().mockReturnValue({ eq: selectEq })
    const updateFn = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { select: selectFn, update: updateFn }
      }
      if (table === 'outbound_notifications') {
        const ms = vi.fn().mockResolvedValue({ data: null })
        const eq2 = vi
          .fn()
          .mockReturnValue({
            maybeSingle: ms,
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: ms,
                filter: vi.fn().mockReturnValue({ maybeSingle: ms }),
              }),
          })
        return { select: vi.fn().mockReturnValue({ eq: eq2 }) }
      }
      return {
        insert: vi
          .fn()
          .mockReturnValue({
            select: vi
              .fn()
              .mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'e' } }) }),
          }),
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi
                      .fn()
                      .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
                  }),
              }),
          }),
      }
    })

    process.env.TELEGRAM_WEBHOOK_SECRET = 'wh-secret'
    process.env.TELEGRAM_ALLOWED_USER_ID = '99999'

    const webhookBody = {
      update_id: 4,
      callback_query: {
        id: 'cq-id4',
        from: { id: 99999 },
        message: {
          message_id: 103,
          chat: { id: 111 },
          text: '⏸ push_bash confirm\n`git status`\nNeeds review',
        },
        data: buildPushBashCallback('deny', SAMPLE_UUID),
      },
    }

    const req = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wh-secret',
      },
      body: JSON.stringify(webhookBody),
    })

    const { POST: webhookPOST } = await import('@/app/api/telegram/webhook/route')
    const res = await webhookPOST(req as Parameters<typeof webhookPOST>[0])
    expect(res.status).toBe(200)

    // update should NOT have been called with status: 'denied' again
    const deniedUpdateCalls = (updateFn.mock.calls as unknown[][]).filter((args) => {
      const arg = args[0] as { status?: string }
      return arg?.status === 'denied'
    })
    expect(deniedUpdateCalls).toHaveLength(0)

    const editCall = fetchCalls.find(
      (c) => typeof c.url === 'string' && c.url.includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const editBody = editCall!.body as { text: string }
    expect(editBody.text).toContain('already resolved')

    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.TELEGRAM_ALLOWED_USER_ID
    vi.unstubAllGlobals()
  })
})

// ── AC-12: POST /api/harness/push-bash — confirm tier HTTP shape ──────────────

describe('AC-12: POST /api/harness/push-bash — confirm tier returns HTTP 200 with shape', () => {
  it('response has { tier: "confirm", status: "pending", decisionId: string }', async () => {
    const { insert } = makeInsertChain('confirm-decision-uuid')
    // update chain for telegram_message_id — mockTelegram returns no messageId so won't fire
    const updateChain = makeUpdateChain()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'push_bash_decisions') {
        return { insert, ...updateChain }
      }
      return { insert }
    })

    mockTelegram.mockResolvedValueOnce({ ok: true })

    const req = makeRequest({ cmd: 'git commit -m "test"' })
    const res = await POST(req as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.tier).toBe('confirm')
    expect(body.status).toBe('pending')
    expect(typeof body.decisionId).toBe('string')
    expect(body.decisionId.length).toBeGreaterThan(0)
  })
})
