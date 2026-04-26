/**
 * Budget Summary — unit tests
 *
 * Covers:
 *  1. Happy path: drained session → outbound_notifications + agent_events inserted, dedup flag set
 *  2. Happy path: stopped session → correlation_id uses budget_stop_ prefix
 *  3. Dedup: second call with budget_summary_sent=true → no second notification insert
 *  4. buildBudgetSummaryText: sections omitted when count=0
 *  5. buildBudgetSummaryText: cost line never appears (cost_log not in v1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

// ── Mock knowledge client ─────────────────────────────────────────────────────
vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue('mock-event-id'),
}))

import {
  sendDrainSummary,
  buildBudgetSummaryText,
  type WorkBudgetSession,
} from '@/lib/work-budget/tracker'
import { createServiceClient } from '@/lib/supabase/service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

// ── Helper: make a session ────────────────────────────────────────────────────

function makeSession(overrides: Partial<WorkBudgetSession> = {}): WorkBudgetSession {
  return {
    id: 'abcdef01-0000-0000-0000-000000000001',
    status: 'drained',
    budget_minutes: 60,
    used_minutes: 55,
    completed_count: 3,
    started_at: new Date(Date.now() - 55 * 60_000).toISOString(),
    completed_at: new Date().toISOString(),
    source: 'telegram',
    telegram_chat_id: null,
    metadata: {},
    ...overrides,
  }
}

// ── Helper: build a mock DB that records inserts ──────────────────────────────

function buildMockDb(opts: {
  claimedData?: { id: string; task: string }[]
  completedData?: { id: string; task: string }[]
  awaitingData?: { id: string; task: string }[]
  onNotificationInsert?: (row: unknown) => void
  onMetadataUpdate?: (row: unknown) => void
  onAgentEventInsert?: (row: unknown) => void
}): AnyDb {
  const claimedData = opts.claimedData ?? []
  const completedData = opts.completedData ?? []
  const awaitingData = opts.awaitingData ?? []

  // Track which task_queue select call we're on by counting calls
  let taskQueueCallCount = 0

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'task_queue') {
        taskQueueCallCount++
        const callNum = taskQueueCallCount
        // Call 1: claimed query (all tasks in window)
        // Call 2: completed query (status=completed)
        // Call 3: awaiting query (status in awaiting_*)
        const dataForCall =
          callNum === 1 ? claimedData : callNum === 2 ? completedData : awaitingData

        const chainEnd = { data: dataForCall, error: null }
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue(chainEnd),
            }),
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockResolvedValue(chainEnd),
              }),
            }),
            in: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                lte: vi.fn().mockResolvedValue(chainEnd),
              }),
            }),
          }),
        }
      }

      if (table === 'outbound_notifications') {
        return {
          insert: vi.fn().mockImplementation((row: unknown) => {
            opts.onNotificationInsert?.(row)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }

      if (table === 'work_budget_sessions') {
        return {
          update: vi.fn().mockImplementation((row: unknown) => {
            opts.onMetadataUpdate?.(row)
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }),
        }
      }

      if (table === 'agent_events') {
        return {
          insert: vi.fn().mockImplementation((row: unknown) => {
            opts.onAgentEventInsert?.(row)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }

      return {}
    }),
  }
}

// ── Test 1: happy path — drained session ─────────────────────────────────────

describe('sendDrainSummary: happy path — drained session', () => {
  it('inserts outbound_notifications row with budget_drain_ correlation_id', async () => {
    let notificationRow: unknown = null

    const db = buildMockDb({
      claimedData: [{ id: 'task-aaaa-0001', task: 'Sprint 5 chunk A' }],
      completedData: [{ id: 'task-aaaa-0001', task: 'Sprint 5 chunk A' }],
      awaitingData: [],
      onNotificationInsert: (row) => {
        notificationRow = row
      },
    })

    vi.mocked(createServiceClient).mockReturnValue(db)

    const session = makeSession({ status: 'drained' })
    await sendDrainSummary(session)

    expect(notificationRow).not.toBeNull()
    const nr = notificationRow as {
      channel: string
      correlation_id: string
      payload: { text: string }
    }
    expect(nr.channel).toBe('telegram')
    expect(nr.correlation_id).toBe(`budget_drain_${session.id}`)
    expect(nr.payload.text).toContain('drained')
    expect(nr.payload.text).toContain(session.id.slice(0, 8))
  })

  it('inserts agent_events row with action=budget_summary_sent', async () => {
    let agentEventRow: unknown = null

    const db = buildMockDb({
      onAgentEventInsert: (row) => {
        agentEventRow = row
      },
    })

    vi.mocked(createServiceClient).mockReturnValue(db)

    const session = makeSession({ status: 'drained' })
    await sendDrainSummary(session)

    expect(agentEventRow).not.toBeNull()
    const ev = agentEventRow as {
      action: string
      domain: string
      meta: Record<string, unknown>
    }
    expect(ev.action).toBe('budget_summary_sent')
    expect(ev.domain).toBe('orchestrator')
    expect(ev.meta.session_id).toBe(session.id)
    expect(ev.meta.session_status).toBe('drained')
    expect(typeof ev.meta.tasks_claimed).toBe('number')
    expect(typeof ev.meta.tasks_completed).toBe('number')
    expect(typeof ev.meta.tasks_awaiting).toBe('number')
    expect(typeof ev.meta.duration_minutes).toBe('number')
  })

  it('sets budget_summary_sent=true on session metadata', async () => {
    let metadataUpdate: unknown = null

    const db = buildMockDb({
      onMetadataUpdate: (row) => {
        metadataUpdate = row
      },
    })

    vi.mocked(createServiceClient).mockReturnValue(db)

    const session = makeSession({ status: 'drained' })
    await sendDrainSummary(session)

    expect(metadataUpdate).not.toBeNull()
    const mu = metadataUpdate as { metadata: Record<string, unknown> }
    expect(mu.metadata.budget_summary_sent).toBe(true)
  })
})

// ── Test 2: happy path — stopped session ─────────────────────────────────────

describe('sendDrainSummary: happy path — stopped session', () => {
  it('uses budget_stop_ correlation_id for stopped status', async () => {
    let notificationRow: unknown = null

    const db = buildMockDb({
      onNotificationInsert: (row) => {
        notificationRow = row
      },
    })

    vi.mocked(createServiceClient).mockReturnValue(db)

    const session = makeSession({ status: 'stopped' })
    await sendDrainSummary(session)

    expect(notificationRow).not.toBeNull()
    const nr = notificationRow as { correlation_id: string; payload: { text: string } }
    expect(nr.correlation_id).toBe(`budget_stop_${session.id}`)
    expect(nr.payload.text).toContain('stopped')
  })
})

// ── Test 3: dedup — no second notification ────────────────────────────────────

describe('sendDrainSummary: dedup — no second notification when already sent', () => {
  it('returns early without inserting when budget_summary_sent=true in metadata', async () => {
    let insertCallCount = 0

    const db = buildMockDb({
      onNotificationInsert: () => {
        insertCallCount++
      },
    })

    vi.mocked(createServiceClient).mockReturnValue(db)

    const session = makeSession({
      status: 'drained',
      metadata: { budget_summary_sent: true },
    })

    await sendDrainSummary(session)

    // createServiceClient should not even be called — early return before DB access
    expect(insertCallCount).toBe(0)
  })
})

// ── Test 4: buildBudgetSummaryText — omit empty sections ─────────────────────

describe('buildBudgetSummaryText: sections omitted when empty', () => {
  it('omits "Tasks claimed" section when claimedTasks is empty', () => {
    const session = makeSession()
    const text = buildBudgetSummaryText(session, {
      claimedTasks: [],
      completedTasks: [],
      awaitingTasks: [],
      durationMinutes: 55,
    })
    expect(text).not.toContain('Tasks claimed')
    expect(text).not.toContain('Tasks completed')
    expect(text).not.toContain('Awaiting review')
  })

  it('includes "Tasks completed" section when completedTasks is non-empty', () => {
    const session = makeSession()
    const text = buildBudgetSummaryText(session, {
      claimedTasks: [],
      completedTasks: [{ id: 'task-aaaa-0001', task: 'Fix the bug' }],
      awaitingTasks: [],
      durationMinutes: 30,
    })
    expect(text).toContain('Tasks completed (1)')
    expect(text).toContain('Fix the bug')
  })

  it('includes "Awaiting review/grounding" section when awaitingTasks is non-empty', () => {
    const session = makeSession()
    const text = buildBudgetSummaryText(session, {
      claimedTasks: [],
      completedTasks: [],
      awaitingTasks: [{ id: 'task-bbbb-0002', task: 'Awaiting grounding check' }],
      durationMinutes: 20,
    })
    expect(text).toContain('Awaiting review/grounding (1)')
  })
})

// ── Test 5: cost line never appears ──────────────────────────────────────────

describe('buildBudgetSummaryText: cost line never present', () => {
  it('does not include Cost line (cost_log table does not exist in v1)', () => {
    const session = makeSession()
    const text = buildBudgetSummaryText(session, {
      claimedTasks: [{ id: 'task-1111', task: 'Some task' }],
      completedTasks: [{ id: 'task-1111', task: 'Some task' }],
      awaitingTasks: [],
      durationMinutes: 45,
    })
    expect(text).not.toContain('Cost:')
    expect(text).not.toContain('cost_log')
  })
})

// ── Test 6: summary header includes session id, status, duration ──────────────

describe('buildBudgetSummaryText: header format', () => {
  it('includes shortId, status, and duration in header lines', () => {
    const session = makeSession({
      id: 'abcdef01-1234-5678-abcd-ef0123456789',
      status: 'drained',
    })
    const text = buildBudgetSummaryText(session, {
      claimedTasks: [],
      completedTasks: [],
      awaitingTasks: [],
      durationMinutes: 42,
    })
    expect(text).toContain('[LepiOS Budget] Session abcdef01 ended — drained')
    expect(text).toContain('Duration: 42 min')
  })
})
