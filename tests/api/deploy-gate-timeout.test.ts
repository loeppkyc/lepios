/**
 * Unit tests for app/api/cron/deploy-gate-timeout/route.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/cron/deploy-gate-timeout/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'
const MERGE_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'
const MESSAGE_ID = 263

function makeRequest(headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/deploy-gate-timeout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
  })
}

function makeNotification(
  ageMins: number,
  overrides: Partial<{ merge_sha: string; task_id: string; message_id: number }> = {}
) {
  return {
    id: 'notif-row-1',
    meta: {
      merge_sha: overrides.merge_sha ?? MERGE_SHA,
      task_id: overrides.task_id ?? TASK_ID,
      message_id: overrides.message_id ?? MESSAGE_ID,
    },
    occurred_at: new Date(Date.now() - ageMins * 60 * 1000).toISOString(),
  }
}

function makeQueryBuilder(
  data: unknown[],
  error: unknown = null,
  insertFn?: ReturnType<typeof vi.fn>
) {
  const p = Promise.resolve({ data, error })
  const b: Record<string, unknown> = {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  }
  if (insertFn) b.insert = insertFn
  for (const m of ['select', 'eq', 'lt', 'gte', 'in', 'order', 'limit', 'filter']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  return b
}

// Every mockFrom() call returns an object that handles BOTH query chains (.select()...)
// and inserts (.insert()). The queue feeds data for query calls; insert calls share insertFn
// but ignore the queued data. This means insert calls "consume" queue slots, but since
// migration review queries always return [] in these tests (migrationReviewRows=[]), any
// slot beyond resolvedRows resolves to [] regardless, which is correct.
function setupMocks(
  notifRows: unknown[],
  resolvedRows: unknown[] = [],
  migrationReviewRows: unknown[] = [],
  resolvedMigrationRows: unknown[] = []
) {
  const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  const queue: unknown[][] = [notifRows, resolvedRows, migrationReviewRows, resolvedMigrationRows]
  let callIdx = 0
  mockFrom.mockImplementation(() => {
    const data = (callIdx < queue.length ? queue[callIdx] : []) as unknown[]
    callIdx++
    return makeQueryBuilder(data, null, insertFn)
  })
  return { insertFn }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.TELEGRAM_CHAT_ID = '111222'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/cron/deploy-gate-timeout — auth', () => {
  it('returns 401 when secret does not match', async () => {
    setupMocks([])
    const req = makeRequest({ Authorization: 'Bearer wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 500 when no CRON_SECRET configured (F22 fail-closed)', async () => {
    delete process.env.CRON_SECRET
    setupMocks([])
    const req = makeRequest({ Authorization: '' })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns 200 when correct secret provided', async () => {
    setupMocks([])
    const req = makeRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── No pending timeouts ───────────────────────────────────────────────────────

describe('POST /api/cron/deploy-gate-timeout — no pending', () => {
  it('returns no-pending-timeouts when notification query returns empty', async () => {
    setupMocks([])
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('no-pending-timeouts')
  })

  it('returns no-pending-timeouts when notification is younger than 10 min (simulated via empty query result)', async () => {
    // DB query uses .lt('occurred_at', cutoff) — young rows won't be returned
    // Simulate by returning empty from the mock
    setupMocks([])
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('no-pending-timeouts')
  })

  it('returns all-resolved when notification already rolled back', async () => {
    const notif = makeNotification(15)
    const { insertFn } = setupMocks(
      [notif],
      [{ meta: { merge_sha: MERGE_SHA } }] // simulate a deploy_gate_rolled_back row
    )
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('all-resolved')
    expect(insertFn).not.toHaveBeenCalled()
  })

  it('returns all-resolved when notification already timed out', async () => {
    const notif = makeNotification(15)
    const { insertFn } = setupMocks(
      [notif],
      [{ meta: { merge_sha: MERGE_SHA } }] // simulate a deploy_gate_override_timeout row
    )
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.reason).toBe('all-resolved')
    expect(insertFn).not.toHaveBeenCalled()
  })
})

// ── Processing ────────────────────────────────────────────────────────────────

describe('POST /api/cron/deploy-gate-timeout — processing', () => {
  it('writes deploy_gate_override_timeout row with correct fields', async () => {
    const notif = makeNotification(15)
    const { insertFn } = setupMocks([notif])
    await POST(makeRequest())

    expect(insertFn).toHaveBeenCalled()
    const timeoutRow = insertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_override_timeout'
    )?.[0]
    expect(timeoutRow).toBeDefined()
    expect(timeoutRow.status).toBe('success')
    expect(timeoutRow.meta.merge_sha).toBe(MERGE_SHA)
    expect(timeoutRow.meta.task_id).toBe(TASK_ID)
    expect(timeoutRow.meta.default_action).toBe('keep')
    expect(timeoutRow.meta.notification_sent_at).toBe(notif.occurred_at)
    expect(timeoutRow.meta.resolved_at).toBeDefined()
    expect(timeoutRow.meta.message_id).toBe(MESSAGE_ID)
    expect(timeoutRow.tags).toContain('chunk_g')
  })

  it('edits Telegram message with correct message_id, text, and empty keyboard', async () => {
    setupMocks([makeNotification(15)])
    await POST(makeRequest())

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.chat_id).toBe('111222')
    expect(body.message_id).toBe(MESSAGE_ID)
    expect(body.text).toContain('kept in production')
    expect(body.text).toContain('override window closed')
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('returns processed count and results array', async () => {
    setupMocks([makeNotification(15)])
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results[0]).toContain('timed-out-keep')
    expect(body.results[0]).toContain(MERGE_SHA.slice(0, 8))
  })

  it('skips edit when message_id is absent from meta', async () => {
    const notif = {
      id: 'notif-no-msg',
      meta: { merge_sha: MERGE_SHA, task_id: TASK_ID }, // no message_id
      occurred_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    }
    const { insertFn } = setupMocks([notif])
    await POST(makeRequest())

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeUndefined()
    // Timeout row still written
    expect(insertFn).toHaveBeenCalledOnce()
    expect(insertFn.mock.calls[0][0].task_type).toBe('deploy_gate_override_timeout')
  })
})

// ── Telegram edit failure ─────────────────────────────────────────────────────

describe('POST /api/cron/deploy-gate-timeout — edit failure', () => {
  it('logs telegram_edit_fail and returns 200 when edit fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      })
    )
    const { insertFn } = setupMocks([makeNotification(15)])
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    const taskTypes = insertFn.mock.calls.map((c) => c[0].task_type)
    expect(taskTypes).toContain('deploy_gate_override_timeout')
    expect(taskTypes).toContain('telegram_edit_fail')
  })

  it('includes merge_sha and message_id in telegram_edit_fail meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      })
    )
    const { insertFn } = setupMocks([makeNotification(15)])
    await POST(makeRequest())

    const editFailRow = insertFn.mock.calls.find(
      (c) => c[0].task_type === 'telegram_edit_fail'
    )?.[0]
    expect(editFailRow).toBeDefined()
    expect(editFailRow.meta.merge_sha).toBe(MERGE_SHA)
    expect(editFailRow.meta.message_id).toBe(MESSAGE_ID)
    expect(editFailRow.meta.error).toContain('500')
  })

  it('continues processing subsequent notifications even when one edit fails', async () => {
    const sha2 = 'bbbbbb2200000000000000000000000000000000'
    const notifs = [
      makeNotification(15, { merge_sha: MERGE_SHA }),
      makeNotification(15, { merge_sha: sha2, message_id: 264 }),
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      })
    )

    const { insertFn } = setupMocks(notifs)

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(2)

    const taskTypes = insertFn.mock.calls.map((c) => c[0].task_type)
    const timeoutCount = taskTypes.filter((t) => t === 'deploy_gate_override_timeout').length
    const editFailCount = taskTypes.filter((t) => t === 'telegram_edit_fail').length
    expect(timeoutCount).toBe(2)
    expect(editFailCount).toBe(2)
  })
})

// ── Multiple pending ──────────────────────────────────────────────────────────

describe('POST /api/cron/deploy-gate-timeout — multiple pending', () => {
  it('processes multiple expired notifications without duplication', async () => {
    const notifications = Array.from({ length: 5 }, (_, i) => ({
      id: `notif-${i}`,
      meta: {
        merge_sha: `sha${i}`.padEnd(40, '0'),
        task_id: TASK_ID,
        message_id: 100 + i,
      },
      occurred_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    }))

    const { insertFn } = setupMocks(notifications)

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(5)
    expect(body.results).toHaveLength(5)

    // Each notification gets exactly one timeout row
    const timeoutWrites = insertFn.mock.calls.filter(
      (c) => c[0].task_type === 'deploy_gate_override_timeout'
    )
    expect(timeoutWrites).toHaveLength(5)

    // No duplicates — all merge_shas are distinct in the writes
    const writtenShas = timeoutWrites.map((c) => c[0].meta.merge_sha as string)
    expect(new Set(writtenShas).size).toBe(5)
  })

  it('skips notifications whose merge_sha appears in resolved set', async () => {
    const sha1 = 'aaa'.padEnd(40, 'a')
    const sha2 = 'bbb'.padEnd(40, 'b')
    const notifications = [
      makeNotification(15, { merge_sha: sha1, message_id: 101 }),
      makeNotification(15, { merge_sha: sha2, message_id: 102 }),
    ]
    // sha1 already rolled back
    const { insertFn } = setupMocks(notifications, [{ meta: { merge_sha: sha1 } }])

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.processed).toBe(1)
    const writtenShas = insertFn.mock.calls.map((c) => c[0].meta?.merge_sha).filter(Boolean)
    expect(writtenShas).not.toContain(sha1)
    expect(writtenShas).toContain(sha2)
  })
})

// ── Migration review timeout (30 min → ABORT) ─────────────────────────────────

// Call order when 1 deploy-gate notification (no message_id) + migration reviews:
//   1: notification_sent query
//   2: resolved rows query
//   3: override_timeout insert (notification without message_id → no Telegram edit)
//   4: migration_review_sent query
//   5: resolved_migration rows query (only when migration reviews non-empty)
//   6+: migration timeout inserts
function setupMigrationMocks(
  notif: unknown,
  migrationRows: unknown[],
  resolvedMigrationRows: unknown[] = []
) {
  const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  let callCount = 0
  mockFrom.mockImplementation(() => {
    callCount++
    const data =
      callCount === 1
        ? [notif]
        : callCount === 2
          ? []
          : callCount === 4
            ? migrationRows
            : callCount === 5
              ? resolvedMigrationRows
              : ([] as unknown[])
    return makeQueryBuilder(data as unknown[], null, insertFn)
  })
  return { insertFn }
}

const COMMIT_SHA = 'f3f43eb1deadbeef0000000000000000000000000'
const MIGRATION_MESSAGE_ID = 500
const MIGRATION_BRANCH = 'harness/task-migration-abc'

function makeNotifNoMsg() {
  return {
    id: 'notif-no-msg',
    meta: { merge_sha: MERGE_SHA, task_id: TASK_ID }, // no message_id → no Telegram edit
    occurred_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  }
}

function makeMigrationReview(
  ageMins: number,
  overrides: Partial<{ commit_sha: string; message_id: number; branch: string }> = {}
) {
  return {
    id: 'migration-review-1',
    meta: {
      commit_sha: overrides.commit_sha ?? COMMIT_SHA,
      task_id: TASK_ID,
      branch: overrides.branch ?? MIGRATION_BRANCH,
      ...(overrides.message_id !== undefined
        ? { message_id: overrides.message_id }
        : { message_id: MIGRATION_MESSAGE_ID }),
    },
    occurred_at: new Date(Date.now() - ageMins * 60 * 1000).toISOString(),
  }
}

describe('POST /api/cron/deploy-gate-timeout — migration review timeout', () => {
  it('writes deploy_gate_migration_review_timeout row with default_action=abort', async () => {
    const review = makeMigrationReview(35)
    const { insertFn } = setupMigrationMocks(makeNotifNoMsg(), [review])
    await POST(makeRequest())

    const timeoutRow = insertFn.mock.calls.find(
      (c) => c[0].task_type === 'deploy_gate_migration_review_timeout'
    )?.[0]
    expect(timeoutRow).toBeDefined()
    expect(timeoutRow.status).toBe('success')
    expect(timeoutRow.meta.commit_sha).toBe(COMMIT_SHA)
    expect(timeoutRow.meta.default_action).toBe('abort')
    expect(timeoutRow.meta.review_sent_at).toBe(review.occurred_at)
    expect(timeoutRow.meta.resolved_at).toBeDefined()
    expect(timeoutRow.meta.message_id).toBe(MIGRATION_MESSAGE_ID)
    expect(timeoutRow.tags).toContain('chunk_h')
  })

  it('edits Telegram message with auto-aborted text', async () => {
    setupMigrationMocks(makeNotifNoMsg(), [makeMigrationReview(35)])
    await POST(makeRequest())

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1]!.body as string)
    expect(body.chat_id).toBe('111222')
    expect(body.message_id).toBe(MIGRATION_MESSAGE_ID)
    expect(body.text).toContain('auto-aborted')
    expect(body.text).toContain('no promotion')
    expect(body.reply_markup.inline_keyboard).toEqual([])
  })

  it('skips edit when message_id is absent from migration meta', async () => {
    const review = makeMigrationReview(35, { message_id: undefined })
    setupMigrationMocks(makeNotifNoMsg(), [
      { ...review, meta: { ...review.meta, message_id: undefined } },
    ])
    await POST(makeRequest())

    const fetchMock = vi.mocked(fetch)
    const editCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('editMessageText')
    )
    expect(editCall).toBeUndefined()
  })

  it('skips migration review whose commit_sha is in resolved set', async () => {
    const sha1 = 'aaaaaaa1' + '0'.repeat(32)
    const sha2 = 'bbbbbbb2' + '0'.repeat(32)
    const reviews = [
      makeMigrationReview(35, { commit_sha: sha1 }),
      makeMigrationReview(35, { commit_sha: sha2, message_id: 501 }),
    ]
    const { insertFn } = setupMigrationMocks(
      makeNotifNoMsg(),
      reviews,
      [{ meta: { commit_sha: sha1 } }] // sha1 already resolved
    )
    await POST(makeRequest())

    const migrationTimeouts = insertFn.mock.calls.filter(
      (c) => c[0].task_type === 'deploy_gate_migration_review_timeout'
    )
    const writtenShas = migrationTimeouts.map((c) => c[0].meta?.commit_sha)
    expect(writtenShas).not.toContain(sha1)
    expect(writtenShas).toContain(sha2)
  })

  it('returns 200 with processed=N (deploy-gate) even when migration review also times out', async () => {
    setupMigrationMocks(makeNotifNoMsg(), [makeMigrationReview(35)])
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1) // deploy-gate notification processed
  })
})
