/**
 * Tests for lib/harness/stall-check.ts
 *
 * Covers:
 *   - T1 detection (coordinator stuck >30 min, no heartbeat)
 *   - T3 detection (task stale in queue, queued + retry_count=0 + created_at >8h)
 *   - Dedup suppression (24h window — second alert for same trigger+id is skipped)
 *   - humanDuration helper
 *   - buildAlertMessage format
 *   - getDigestStallSummary (T3+T4 for morning_digest)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  runStallCheck,
  humanDuration,
  buildAlertMessage,
  getDigestStallSummary,
  type StallEvent,
} from '@/lib/harness/stall-check'

// ── Helper: build a chainable Supabase query stub ─────────────────────────────
// Supports: from().select().eq().lt().gte().limit().maybeSingle()
// .order() is also supported for T5 detection.

type QueryResult = { data: unknown; error: null | { message: string } }

function makeQueryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'lt', 'gte', 'order', 'limit', 'filter', 'in']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result)
  // Allow direct await (for queries that don't end in .maybeSingle())
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  void self
  return chain
}

function makeInsertChain() {
  return {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

// ── humanDuration ─────────────────────────────────────────────────────────────

describe('humanDuration', () => {
  it('returns minutes for durations under 1 hour', () => {
    const since = new Date(Date.now() - 47 * 60_000).toISOString()
    expect(humanDuration(since)).toBe('47 min')
  })

  it('returns hours + minutes for multi-hour durations', () => {
    const since = new Date(Date.now() - 90 * 60_000).toISOString()
    expect(humanDuration(since)).toBe('1h 30min')
  })

  it('returns whole hours when no remainder minutes', () => {
    const since = new Date(Date.now() - 120 * 60_000).toISOString()
    expect(humanDuration(since)).toBe('2h')
  })
})

// ── buildAlertMessage ─────────────────────────────────────────────────────────

describe('buildAlertMessage', () => {
  it('includes the trigger label, description, duration, and action text', () => {
    const since = new Date(Date.now() - 47 * 60_000).toISOString()
    const event: StallEvent = {
      trigger: 'T1',
      correlation_id: 'task-abc',
      description: 'Task abc12345 — Some task',
      stuck_since: since,
      action_text: "Reset task: UPDATE task_queue SET status='queued' WHERE id='task-abc'",
    }
    const msg = buildAlertMessage('Coordinator stuck', event)
    expect(msg).toContain('⚠️ [LepiOS Harness] Coordinator stuck')
    expect(msg).toContain('Stuck: Task abc12345 — Some task')
    expect(msg).toContain('Since: 47 min')
    expect(msg).toContain("Reset task: UPDATE task_queue SET status='queued'")
  })
})

// ── runStallCheck — T1 detection ─────────────────────────────────────────────

describe('runStallCheck — T1 detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires an alert for a stuck running task', async () => {
    const stuckAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const taskId = 'task-t1-stuck-001'

    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++

      if (table === 'task_queue') {
        // T1 query: status=running, last_heartbeat_at < cutoff
        const chain = makeQueryChain({
          data: [{ id: taskId, task: 'Implement feature X', last_heartbeat_at: stuckAt }],
          error: null,
        })
        return chain
      }

      if (table === 'work_budget_sessions') {
        // T2: no active sessions
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'agent_events') {
        // Dedup check (stall_alert_sent) → no existing row → allow alert
        // T5 detection → last task_pickup recent enough
        const chain = makeQueryChain({ data: null, error: null })
        return chain
      }

      if (table === 'outbound_notifications') {
        return makeInsertChain()
      }

      return makeQueryChain({ data: null, error: null })
    })

    // For dedup check on agent_events, we need no row (data: null)
    // For T5, we need a recent pickup (within 48h)
    // We use a single mockFrom that returns appropriate data based on call order

    // Reset and wire precisely
    mockFrom.mockReset()

    const recentPickup = new Date(Date.now() - 2 * 3_600_000).toISOString()

    // Track which agent_events call we're on for action-based routing
    let agentEventsCallCount = 0
    // Track task_queue calls
    let taskQueueCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') {
        taskQueueCallCount++
        if (taskQueueCallCount === 1) {
          // T1: running tasks with stale heartbeat
          return makeQueryChain({
            data: [{ id: taskId, task: 'Implement feature X', last_heartbeat_at: stuckAt }],
            error: null,
          })
        }
        // T3: no stale queued tasks
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'work_budget_sessions') {
        // T2: no active sessions
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'agent_events') {
        agentEventsCallCount++
        if (agentEventsCallCount === 1) {
          // T5: recent pickup event exists
          return makeQueryChain({ data: { occurred_at: recentPickup }, error: null })
        }
        // Dedup check for T1 alert: no existing row
        return makeQueryChain({ data: null, error: null })
      }

      if (table === 'outbound_notifications') {
        return makeInsertChain()
      }

      return makeQueryChain({ data: null, error: null })
    })

    const result = await runStallCheck()

    expect(result.alerts_fired).toBe(1)
    expect(result.alerts_deduped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})

// ── runStallCheck — T3 detection ─────────────────────────────────────────────

describe('runStallCheck — T3 detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires an alert for a stale queued task', async () => {
    const createdAt = new Date(Date.now() - 9 * 3_600_000).toISOString()
    const taskId = 'task-t3-stale-001'
    const recentPickup = new Date(Date.now() - 2 * 3_600_000).toISOString()

    let taskQueueCallCount = 0
    let agentEventsCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') {
        taskQueueCallCount++
        if (taskQueueCallCount === 1) {
          // T1: no running stuck tasks
          return makeQueryChain({ data: [], error: null })
        }
        // T3: one stale queued task
        return makeQueryChain({
          data: [{ id: taskId, task: 'Old queued task', created_at: createdAt }],
          error: null,
        })
      }

      if (table === 'work_budget_sessions') {
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'agent_events') {
        agentEventsCallCount++
        if (agentEventsCallCount === 1) {
          // T5: recent pickup
          return makeQueryChain({ data: { occurred_at: recentPickup }, error: null })
        }
        // Dedup: no existing stall_alert_sent row
        return makeQueryChain({ data: null, error: null })
      }

      if (table === 'outbound_notifications') {
        return makeInsertChain()
      }

      return makeQueryChain({ data: null, error: null })
    })

    const result = await runStallCheck()

    expect(result.alerts_fired).toBe(1)
    expect(result.alerts_deduped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})

// ── runStallCheck — dedup suppression ────────────────────────────────────────

describe('runStallCheck — dedup suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips alert when stall_alert_sent exists within 24h for same trigger+id', async () => {
    const stuckAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const taskId = 'task-t1-dup-001'
    const recentPickup = new Date(Date.now() - 2 * 3_600_000).toISOString()

    let taskQueueCallCount = 0
    let agentEventsCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') {
        taskQueueCallCount++
        if (taskQueueCallCount === 1) {
          // T1: one stuck task
          return makeQueryChain({
            data: [{ id: taskId, task: 'Some task', last_heartbeat_at: stuckAt }],
            error: null,
          })
        }
        // T3: no stale tasks
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'work_budget_sessions') {
        return makeQueryChain({ data: [], error: null })
      }

      if (table === 'agent_events') {
        agentEventsCallCount++
        if (agentEventsCallCount === 1) {
          // T5: recent pickup event
          return makeQueryChain({ data: { occurred_at: recentPickup }, error: null })
        }
        // Dedup check: existing stall_alert_sent row found → suppress
        return makeQueryChain({ data: { id: 'existing-event-id' }, error: null })
      }

      if (table === 'outbound_notifications') {
        return makeInsertChain()
      }

      return makeQueryChain({ data: null, error: null })
    })

    const result = await runStallCheck()

    expect(result.alerts_fired).toBe(0)
    expect(result.alerts_deduped).toBe(1)
    expect(result.errors).toHaveLength(0)
  })
})

// ── runStallCheck — no stalls ─────────────────────────────────────────────────

describe('runStallCheck — clean harness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires no alerts when all queues are clean', async () => {
    const recentPickup = new Date(Date.now() - 2 * 3_600_000).toISOString()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') {
        return makeQueryChain({ data: [], error: null })
      }
      if (table === 'work_budget_sessions') {
        return makeQueryChain({ data: [], error: null })
      }
      if (table === 'agent_events') {
        // T5: recent pickup
        return makeQueryChain({ data: { occurred_at: recentPickup }, error: null })
      }
      if (table === 'outbound_notifications') {
        return makeInsertChain()
      }
      return makeQueryChain({ data: null, error: null })
    })

    const result = await runStallCheck()

    expect(result.alerts_fired).toBe(0)
    expect(result.alerts_deduped).toBe(0)
  })
})

// ── getDigestStallSummary ─────────────────────────────────────────────────────

describe('getDigestStallSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns count=0 and empty descriptions when no stalled tasks', async () => {
    mockFrom.mockImplementation(() => makeQueryChain({ data: [], error: null }))

    const result = await getDigestStallSummary()

    expect(result.count).toBe(0)
    expect(result.descriptions).toHaveLength(0)
  })

  it('returns combined T3+T4 tasks with descriptions', async () => {
    let callCount = 0

    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // T3 query
        return makeQueryChain({
          data: [{ id: 'aaaa1111-0000-0000-0000-000000000000', task: 'Old queued task' }],
          error: null,
        })
      }
      // T4 query
      return makeQueryChain({
        data: [{ id: 'bbbb2222-0000-0000-0000-000000000000', task: 'Awaiting review task' }],
        error: null,
      })
    })

    const result = await getDigestStallSummary()

    expect(result.count).toBe(2)
    expect(result.descriptions).toHaveLength(2)
    expect(result.descriptions[0]).toContain('aaaa1111')
    expect(result.descriptions[1]).toContain('bbbb2222')
  })

  it('returns count=0 on database error (never throws)', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB down')
    })

    const result = await getDigestStallSummary()

    expect(result.count).toBe(0)
    expect(result.descriptions).toHaveLength(0)
  })
})
