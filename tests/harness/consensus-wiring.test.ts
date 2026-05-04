/**
 * tests/harness/consensus-wiring.test.ts
 *
 * Acceptance Tests — Debate Consensus Slice 2
 *
 * AC-1: deploy-gate — runConsensus called with branch + commit in prompt
 * AC-2: deploy-gate — split consensus → "⚠️ CONSENSUS SPLIT" in message text
 * AC-3: deploy-gate — majority consensus → "✅ Consensus" in message text
 * AC-4: deploy-gate — runConsensus throws → message still sends without consensus note
 * AC-5: auto-suspend — split consensus → UPDATE not called, telegram fires
 * AC-6: auto-suspend — majority consensus → UPDATE proceeds (normal path)
 * AC-7: auto-suspend — runConsensus throws → UPDATE proceeds (non-fatal fallback)
 * AC-8: auto-suspend — fewer than 3 runs → runConsensus NOT called (guard fires first)
 * AC-9: All prior harness tests pass (npm test exits 0, 14 pre-existing failures unchanged)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockRunConsensus, mockHttpRequest, mockTelegram, mockFrom } = vi.hoisted(() => ({
  mockRunConsensus: vi.fn(),
  mockHttpRequest: vi.fn(),
  mockTelegram: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/harness/consensus/runner', () => ({
  runConsensus: mockRunConsensus,
}))

vi.mock('@/lib/harness/arms-legs', () => ({
  httpRequest: mockHttpRequest,
  telegram: mockTelegram,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/security/capability', () => ({
  requireCapability: vi.fn().mockResolvedValue({ audit_id: 'mock-audit-id' }),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { sendMigrationGateMessage } from '@/lib/harness/deploy-gate'
import { detectNextFailure, releaseDetectorLock } from '@/lib/harness/self-repair/detector'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb'
const BRANCH = 'harness/task-test-branch'
const COMMIT_SHA = 'deadbeef1234567890abcdef1234567890abcdef'
const SHA_PREFIX = 'deadbeef'

const SQL_FILE = {
  filename: 'supabase/migrations/0118_test.sql',
  content: 'SELECT 1;',
  size_bytes: 9,
}

const MAJORITY_RESULT = {
  runId: 'run-majority-001',
  consensusLevel: 'majority' as const,
  answer: 'Safe to promote',
  splits: [],
  outliers: [],
  rawPerspectives: [],
  rawConsensus: '',
  durationMs: 500,
}

const SPLIT_RESULT = {
  runId: 'run-split-001',
  consensusLevel: 'split' as const,
  answer: null,
  splits: ['A disagrees with B', 'C is uncertain'],
  outliers: [],
  rawPerspectives: [],
  rawConsensus: '',
  durationMs: 500,
}

// ── Supabase chain builder ────────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'single',
    'maybeSingle',
    'in',
    'lt',
    'is',
    'gte',
    'lte',
    'limit',
    'order',
    'not',
    'neq',
    'catch',
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

function makeInsertChain() {
  const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
  return {
    insert: insertFn,
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    _insertFn: insertFn,
  }
}

// ── Mock fetch for Telegram sendMessage ───────────────────────────────────────

const mockFetch = vi.fn()

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)

  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
  process.env.ANTHROPIC_API_KEY = 'test-key'
  process.env.GITHUB_TOKEN = 'test-github-token'

  // Default telegram mock — non-fatal
  mockTelegram.mockResolvedValue(undefined)

  // Default fetch for Telegram API calls
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
  })

  // Default runConsensus — majority
  mockRunConsensus.mockResolvedValue(MAJORITY_RESULT)

  // Release any locks from prior tests
  releaseDetectorLock('test_action_type').catch(() => {})
  releaseDetectorLock('coordinator_await_timeout').catch(() => {})
})

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GITHUB_TOKEN
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: deploy-gate — runConsensus called with branch + commit in prompt
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1: deploy-gate — runConsensus called with branch + commit in prompt', () => {
  it('calls runConsensus once with prompt containing branch and shaPrefix', async () => {
    mockRunConsensus.mockResolvedValue(MAJORITY_RESULT)

    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })

    expect(mockRunConsensus).toHaveBeenCalledTimes(1)
    const [prompt] = mockRunConsensus.mock.calls[0]
    expect(prompt).toContain(BRANCH)
    expect(prompt).toContain(SHA_PREFIX)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: deploy-gate — split consensus → "⚠️ CONSENSUS SPLIT" in message text
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2: deploy-gate — split consensus → CONSENSUS SPLIT in Telegram text', () => {
  it('includes CONSENSUS SPLIT warning in message when runConsensus returns split', async () => {
    mockRunConsensus.mockResolvedValue(SPLIT_RESULT)

    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { text: string }
    expect(body.text).toContain('CONSENSUS SPLIT')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: deploy-gate — majority consensus → "✅ Consensus" in message text
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3: deploy-gate — majority consensus → affirmation in Telegram text', () => {
  it('includes ✅ Consensus (majority) in message when runConsensus returns majority', async () => {
    mockRunConsensus.mockResolvedValue(MAJORITY_RESULT)

    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { text: string }
    expect(body.text).toContain('✅ Consensus (majority): Safe to promote')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: deploy-gate — runConsensus throws → message still sends without note
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-4: deploy-gate — runConsensus throws → message sends without consensus note', () => {
  it('still calls Telegram sendMessage when runConsensus throws', async () => {
    mockRunConsensus.mockRejectedValue(new Error('timeout'))

    const result = await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })

    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not include CONSENSUS in message text when runConsensus throws', async () => {
    mockRunConsensus.mockRejectedValue(new Error('timeout'))

    await sendMigrationGateMessage({
      task_id: TASK_ID,
      branch: BRANCH,
      commit_sha: COMMIT_SHA,
      migration_files_with_sql: [SQL_FILE],
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { text: string }
    expect(body.text).not.toContain('CONSENSUS')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build DB mock sequence for checkAndAutoSuspend (K2) path
//
// detectNextFailure sequence:
//   1. Watchlist query (for K2 loop)
//   2. self_repair_runs query (3 rows with pr_numbers, for each actionType in K2)
//   3. httpRequest calls for isPRClosedWithoutMerge (3 GitHub API calls)
//   4. runConsensus called
//   5. DB writes: agent_events.insert or self_repair_watchlist.update
//   6. Reload watchlist query (after K2)
//   7. agent_events query (main detection)
//   Then optionally: self_repair_runs maybeSingle check per event
// ─────────────────────────────────────────────────────────────────────────────

const THREE_PR_RUNS = [
  { id: 'run-1', pr_number: 101 },
  { id: 'run-2', pr_number: 102 },
  { id: 'run-3', pr_number: 103 },
]

const TWO_PR_RUNS = [
  { id: 'run-1', pr_number: 101 },
  { id: 'run-2', pr_number: 102 },
]

function makePRClosedResponse(closed = true) {
  return {
    ok: true,
    status: 200,
    // body must be the object directly — isPRClosedWithoutMerge uses `result.body as {state,merged}` cast (no JSON.parse)
    body: { state: closed ? 'closed' : 'open', merged: false },
    headers: {},
    durationMs: 50,
  }
}

// ── Tracked mock chains for update assertions ─────────────────────────────────

interface UpdateChain {
  updateFn: ReturnType<typeof vi.fn>
  eqFn: ReturnType<typeof vi.fn>
}

function makeUpdateChain(): UpdateChain & { chain: Record<string, unknown> } {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const insertFn = vi.fn().mockReturnValue({ catch: vi.fn().mockResolvedValue(undefined) })
  const selectChain = makeChain({ data: [], error: null })
  const chain: Record<string, unknown> = {
    update: updateFn,
    insert: insertFn,
    select: vi.fn().mockReturnValue(selectChain),
  }
  return { updateFn, eqFn, chain }
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: auto-suspend — split consensus → UPDATE not called, telegram fires
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-5: auto-suspend — split consensus → UPDATE not called, telegram fires', () => {
  it('does not call watchlist UPDATE and calls telegram with SPLIT when consensus splits', async () => {
    mockRunConsensus.mockResolvedValue(SPLIT_RESULT)

    // isPRClosedWithoutMerge returns closed-without-merge for all 3
    mockHttpRequest.mockResolvedValue(makePRClosedResponse(true))

    const updateFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const agentEventsInsertFn = vi
      .fn()
      .mockReturnValue({ catch: vi.fn().mockResolvedValue(undefined) })

    // Mock sequence:
    // 1. Watchlist query → [{action_type: 'test_action_type'}]
    // 2. self_repair_runs query for K2 → 3 rows
    // 3. After split: agent_events insert (suspend_deferred)
    // 4. Reload watchlist → [] (suspended, so empty)
    // 5. activeTypes empty → returns null

    let fromCallIndex = 0
    mockFrom.mockImplementation((table: string) => {
      fromCallIndex++
      if (fromCallIndex === 1 && table === 'self_repair_watchlist') {
        // Initial watchlist query
        return makeChain({ data: [{ action_type: 'test_action_type' }], error: null })
      }
      if (fromCallIndex === 2 && table === 'self_repair_runs') {
        // K2: 3 pr_opened runs
        return makeChain({ data: THREE_PR_RUNS, error: null })
      }
      if (table === 'self_repair_watchlist' && fromCallIndex > 2) {
        // update call (should NOT be called) or reload
        return {
          update: updateFn,
          select: vi.fn().mockReturnValue(makeChain({ data: [], error: null })),
        }
      }
      if (table === 'agent_events') {
        return { insert: agentEventsInsertFn }
      }
      return makeChain({ data: [], error: null })
    })

    await detectNextFailure()

    // UPDATE on self_repair_watchlist must NOT have been called
    expect(updateFn).not.toHaveBeenCalled()

    // telegram must have been called with text containing SPLIT
    expect(mockTelegram).toHaveBeenCalledTimes(1)
    const [telegramText] = mockTelegram.mock.calls[0]
    expect(telegramText).toContain('SPLIT')

    // agent_events insert must have been called with suspend_deferred action
    expect(agentEventsInsertFn).toHaveBeenCalledTimes(1)
    const insertArg = agentEventsInsertFn.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.action).toBe('self_repair.watchlist.suspend_deferred')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: auto-suspend — majority consensus → UPDATE proceeds (normal path)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-6: auto-suspend — majority consensus → UPDATE proceeds', () => {
  it('calls self_repair_watchlist UPDATE with enabled: false on majority consensus', async () => {
    mockRunConsensus.mockResolvedValue(MAJORITY_RESULT)
    mockHttpRequest.mockResolvedValue(makePRClosedResponse(true))

    const eqFn = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: eqFn })

    let fromCallIndex = 0
    mockFrom.mockImplementation((table: string) => {
      fromCallIndex++
      if (fromCallIndex === 1 && table === 'self_repair_watchlist') {
        return makeChain({ data: [{ action_type: 'test_action_type' }], error: null })
      }
      if (fromCallIndex === 2 && table === 'self_repair_runs') {
        return makeChain({ data: THREE_PR_RUNS, error: null })
      }
      if (table === 'self_repair_watchlist') {
        return {
          update: updateFn,
          select: vi.fn().mockReturnValue(makeChain({ data: [], error: null })),
        }
      }
      if (table === 'agent_events') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      return makeChain({ data: [], error: null })
    })

    await detectNextFailure()

    expect(updateFn).toHaveBeenCalledWith({ enabled: false })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: auto-suspend — runConsensus throws → UPDATE proceeds (non-fatal fallback)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-7: auto-suspend — runConsensus throws → suspend still runs', () => {
  it('calls UPDATE even when runConsensus throws (consensus failure is non-fatal)', async () => {
    mockRunConsensus.mockRejectedValue(new Error('anthropic timeout'))
    mockHttpRequest.mockResolvedValue(makePRClosedResponse(true))

    const eqFn = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: eqFn })

    let fromCallIndex = 0
    mockFrom.mockImplementation((table: string) => {
      fromCallIndex++
      if (fromCallIndex === 1 && table === 'self_repair_watchlist') {
        return makeChain({ data: [{ action_type: 'test_action_type' }], error: null })
      }
      if (fromCallIndex === 2 && table === 'self_repair_runs') {
        return makeChain({ data: THREE_PR_RUNS, error: null })
      }
      if (table === 'self_repair_watchlist') {
        return {
          update: updateFn,
          select: vi.fn().mockReturnValue(makeChain({ data: [], error: null })),
        }
      }
      if (table === 'agent_events') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      return makeChain({ data: [], error: null })
    })

    await detectNextFailure()

    expect(updateFn).toHaveBeenCalledWith({ enabled: false })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-8: auto-suspend — fewer than 3 runs → runConsensus NOT called
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-8: auto-suspend — fewer than 3 runs → runConsensus NOT called', () => {
  it('does not call runConsensus when only 2 self_repair_runs exist', async () => {
    let fromCallIndex = 0
    mockFrom.mockImplementation((table: string) => {
      fromCallIndex++
      if (fromCallIndex === 1 && table === 'self_repair_watchlist') {
        return makeChain({ data: [{ action_type: 'test_action_type' }], error: null })
      }
      if (fromCallIndex === 2 && table === 'self_repair_runs') {
        // Only 2 rows — guard fires first (< 3)
        return makeChain({ data: TWO_PR_RUNS, error: null })
      }
      // Reload watchlist
      if (table === 'self_repair_watchlist') {
        return makeChain({ data: [{ action_type: 'test_action_type' }], error: null })
      }
      // agent_events query for main detection
      if (table === 'agent_events') {
        return makeChain({ data: [], error: null })
      }
      return makeChain({ data: [], error: null })
    })

    await detectNextFailure()

    expect(mockRunConsensus).not.toHaveBeenCalled()
  })
})
