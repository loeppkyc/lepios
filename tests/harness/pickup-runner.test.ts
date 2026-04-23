/**
 * Unit tests for lib/harness/pickup-runner.ts — runPickup() orchestration.
 * Covers ACs 3–13 from docs/harness-component-5-task-pickup.md §9.
 * (AC-1, AC-2 verified by scripts/verify-task-queue.ts against live DB.)
 * (AC-11 is a vercel.json file check — not yet wired per build spec.)
 * (AC-12 = existing test suite remains green — verified by npm test overall.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock lib/harness/task-pickup ──────────────────────────────────────────────

const { mockClaimTask, mockPeekTask, mockReclaimStale, mockFailTask } = vi.hoisted(() => ({
  mockClaimTask: vi.fn(),
  mockPeekTask: vi.fn(),
  mockReclaimStale: vi.fn(),
  mockFailTask: vi.fn(),
}))

vi.mock('@/lib/harness/task-pickup', () => ({
  claimTask: mockClaimTask,
  peekTask: mockPeekTask,
  reclaimStale: mockReclaimStale,
  failTask: mockFailTask,
}))

// ── Mock telegram ─────────────────────────────────────────────────────────────

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: mockPostMessage,
}))

// ── Mock Supabase (agent_events insert in logEvent) ───────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock fireCoordinator ──────────────────────────────────────────────────────

const { mockFireCoordinator } = vi.hoisted(() => ({
  mockFireCoordinator: vi.fn(),
}))

vi.mock('@/lib/harness/invoke-coordinator', () => ({
  fireCoordinator: mockFireCoordinator,
}))

import { runPickup, buildTelegramMessage, buildRemoteTelegramMessage } from '@/lib/harness/pickup-runner'
import type { TaskRow } from '@/lib/harness/task-pickup'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockTask: TaskRow = {
  id: 'task-uuid-abcd1234-efgh-5678-ijkl-9012mnop3456',
  task: 'Sprint 4 Chunk A',
  description: 'Implement SP-API integration',
  priority: 1,
  status: 'queued',
  source: 'manual',
  metadata: { sprint: 4, chunk: 'A', plan_path: 'docs/sprint-4/plan.md' },
  result: null,
  retry_count: 0,
  max_retries: 2,
  created_at: '2026-04-21T10:00:00Z',
  claimed_at: '2026-04-21T16:00:05Z',
  claimed_by: 'run-abc',
  last_heartbeat_at: null,
  completed_at: null,
  error_message: null,
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TASK_PICKUP_DRY_RUN
  delete process.env.HARNESS_REMOTE_INVOCATION_ENABLED
  mockReclaimStale.mockResolvedValue([])
  mockPostMessage.mockResolvedValue(undefined)
  mockFrom.mockReturnValue(makeInsertBuilder())
  mockFireCoordinator.mockResolvedValue({
    ok: true,
    session_id: 'session_test123',
    session_url: 'https://claude.ai/code/session_test123',
  })
})

afterEach(() => {
  delete process.env.HARNESS_REMOTE_INVOCATION_ENABLED
})

// ── buildTelegramMessage (pure) ───────────────────────────────────────────────

describe('buildTelegramMessage', () => {
  it('includes first 8 chars of task id as short_id', () => {
    const msg = buildTelegramMessage(mockTask)
    expect(msg).toContain('task-uuid')
  })

  it('includes task text preview', () => {
    const msg = buildTelegramMessage(mockTask)
    expect(msg).toContain('Sprint 4 Chunk A')
  })

  it('truncates task text to 80 chars with ellipsis', () => {
    const longTask = { ...mockTask, task: 'A'.repeat(90) }
    const msg = buildTelegramMessage(longTask)
    expect(msg).toContain('A'.repeat(80) + '...')
    expect(msg).not.toContain('A'.repeat(81) + '...')
  })

  it('does not truncate task text under 80 chars', () => {
    const msg = buildTelegramMessage(mockTask)
    expect(msg).not.toContain('Sprint 4 Chunk A...')
  })

  it('includes full task id in Run task instruction', () => {
    const msg = buildTelegramMessage(mockTask)
    expect(msg).toContain(`Run task ${mockTask.id}`)
    expect(msg).toContain('Claude Code')
  })

  it('no [DRY RUN] prefix by default', () => {
    const msg = buildTelegramMessage(mockTask)
    expect(msg).not.toContain('[DRY RUN]')
  })

  it('adds [DRY RUN] prefix when dryRun=true', () => {
    const msg = buildTelegramMessage(mockTask, true)
    expect(msg).toContain('[DRY RUN]')
    expect(msg).toContain('Sprint 4 Chunk A')
  })
})

// ── AC-3: Pickup claims highest-priority task ─────────────────────────────────

describe('runPickup — AC-3: claim happy path', () => {
  it('returns claimed task with run_id', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    const result = await runPickup('run-abc')

    expect(result.ok).toBe(true)
    expect(result.claimed).toEqual(mockTask)
    expect(result.run_id).toBe('run-abc')
  })

  it('calls claimTask with the run_id', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    await runPickup('run-xyz')

    expect(mockClaimTask).toHaveBeenCalledWith('run-xyz')
  })

  it('sends Telegram with task id and preview when claimed', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    await runPickup('run-abc')
    await Promise.resolve()

    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('task-uuid') // short id prefix
    expect(msg).toContain('Sprint 4 Chunk A') // task preview
    expect(msg).toContain(`Run task ${mockTask.id}`) // full id invocation
  })

  it('Telegram message does not have [DRY RUN] prefix on live claim', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    await runPickup('run-abc')
    await Promise.resolve()

    const msg: string = mockPostMessage.mock.calls[0][0]
    expect(msg).not.toContain('[DRY RUN]')
  })
})

// ── AC-4: Empty queue — clean no-op ──────────────────────────────────────────

describe('runPickup — AC-4: empty queue', () => {
  it('returns queue-empty result when no task is claimed', async () => {
    mockClaimTask.mockResolvedValue(null)

    const result = await runPickup('run-abc')

    expect(result.ok).toBe(true)
    expect(result.claimed).toBeNull()
    expect(result.reason).toBe('queue-empty')
  })

  it('does not send Telegram on empty queue (no stale cancellations)', async () => {
    mockClaimTask.mockResolvedValue(null)

    await runPickup('run-abc')

    expect(mockPostMessage).not.toHaveBeenCalled()
  })
})

// ── AC-5 & AC-13: Stale recovery re-queues; fresh heartbeat prevents stale ───

describe('runPickup — AC-5 & AC-13: stale claim recovery', () => {
  it('calls reclaimStale before claiming', async () => {
    mockClaimTask.mockResolvedValue(null)
    const callOrder: string[] = []
    mockReclaimStale.mockImplementation(async () => {
      callOrder.push('reclaim')
      return []
    })
    mockClaimTask.mockImplementation(async () => {
      callOrder.push('claim')
      return null
    })

    await runPickup('run-abc')

    expect(callOrder[0]).toBe('reclaim')
    expect(callOrder[1]).toBe('claim')
  })

  it('does not send stale Telegram when reclaimStale returns requeued rows', async () => {
    mockReclaimStale.mockResolvedValue([
      { action: 'queued', task_id: 'stale-task', new_retry_count: 1 },
    ])
    mockClaimTask.mockResolvedValue(null)

    await runPickup('run-abc')

    expect(mockPostMessage).not.toHaveBeenCalled()
  })
})

// ── AC-6: max_retries exhaustion → cancelled + Telegram ──────────────────────

describe('runPickup — AC-6: stale task cancelled', () => {
  it('sends Telegram alert for each cancelled task', async () => {
    mockReclaimStale.mockResolvedValue([
      { action: 'cancelled', task_id: 'dead-task-uuid', new_retry_count: 2 },
    ])
    mockClaimTask.mockResolvedValue(null)

    await runPickup('run-abc')
    await Promise.resolve()

    const calls = mockPostMessage.mock.calls
    const cancelMsg: string = calls.find((c: string[][]) => c[0].includes('cancelled'))?.[0] ?? ''
    expect(cancelMsg).toContain('dead-task-uuid')
    expect(cancelMsg).toContain('stale claim exhausted')
  })

  it('includes cancelled task IDs in result', async () => {
    mockReclaimStale.mockResolvedValue([
      { action: 'cancelled', task_id: 'dead-uuid', new_retry_count: 2 },
    ])
    mockClaimTask.mockResolvedValue(null)

    const result = await runPickup('run-abc')

    expect(result.cancelled_tasks).toContain('dead-uuid')
  })
})

// ── AC-7: Dry-run mode ────────────────────────────────────────────────────────

describe('runPickup — AC-7: dry-run mode', () => {
  beforeEach(() => {
    process.env.TASK_PICKUP_DRY_RUN = '1'
  })

  it('returns dry_run=true and peeked task', async () => {
    mockPeekTask.mockResolvedValue(mockTask)

    const result = await runPickup('run-abc')

    expect(result.dry_run).toBe(true)
    expect(result.claimed).toEqual(mockTask)
  })

  it('does NOT call claimTask (no DB mutation)', async () => {
    mockPeekTask.mockResolvedValue(mockTask)

    await runPickup('run-abc')

    expect(mockClaimTask).not.toHaveBeenCalled()
  })

  it('does NOT call reclaimStale (no DB mutation)', async () => {
    mockPeekTask.mockResolvedValue(mockTask)

    await runPickup('run-abc')

    expect(mockReclaimStale).not.toHaveBeenCalled()
  })

  it('sends Telegram with [DRY RUN] prefix when task found', async () => {
    mockPeekTask.mockResolvedValue(mockTask)

    await runPickup('run-abc')
    await Promise.resolve()

    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('[DRY RUN]')
    expect(msg).toContain('Sprint 4 Chunk A')
  })

  it('no Telegram when dry-run queue is empty', async () => {
    mockPeekTask.mockResolvedValue(null)

    await runPickup('run-abc')
    await Promise.resolve()

    expect(mockPostMessage).not.toHaveBeenCalled()
  })
})

// ── AC-10: agent_events row written per run ───────────────────────────────────

describe('runPickup — AC-10: agent_events row', () => {
  it('writes exactly one agent_events row on queue-empty', async () => {
    mockClaimTask.mockResolvedValue(null)
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    await runPickup('run-abc')

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(b.insert).toHaveBeenCalledTimes(1)
  })

  it('agent_events row has task_type=task_pickup and run_id in meta', async () => {
    mockClaimTask.mockResolvedValue(null)
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    await runPickup('run-abc')

    const row = b.insert.mock.calls[0][0]
    expect(row.task_type).toBe('task_pickup')
    expect(row.meta.run_id).toBe('run-abc')
    expect(row.meta.claimed_task_id).toBeNull()
  })

  it('agent_events row has claimed_task_id when task was claimed', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    await runPickup('run-abc')

    const row = b.insert.mock.calls[0][0]
    expect(row.meta.claimed_task_id).toBe(mockTask.id)
  })

  it('agent_events row has domain=orchestrator', async () => {
    mockClaimTask.mockResolvedValue(null)
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    await runPickup('run-abc')

    const row = b.insert.mock.calls[0][0]
    expect(row.domain).toBe('orchestrator')
  })

  it('still returns result even if agent_events insert throws', async () => {
    mockClaimTask.mockResolvedValue(null)
    mockFrom.mockImplementation(() => {
      throw new Error('db crash')
    })

    const result = await runPickup('run-abc')
    expect(result.ok).toBe(true)
  })
})

// ── never-throws contract ─────────────────────────────────────────────────────

describe('runPickup — never throws', () => {
  it('does not throw when reclaimStale rejects', async () => {
    mockReclaimStale.mockRejectedValue(new Error('reclaim crashed'))
    mockClaimTask.mockResolvedValue(null)

    await expect(runPickup('run-abc')).resolves.toBeDefined()
  })

  it('does not throw when postMessage rejects', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    mockPostMessage.mockRejectedValue(new Error('telegram down'))

    await expect(runPickup('run-abc')).resolves.toBeDefined()
  })

  it('result has duration_ms as a number', async () => {
    mockClaimTask.mockResolvedValue(null)

    const result = await runPickup('run-abc')
    expect(typeof result.duration_ms).toBe('number')
  })
})

// ── validation failure path ───────────────────────────────────────────────────

describe('runPickup — validation failure', () => {
  it('calls failTask when claimed task has empty task field', async () => {
    const emptyTask = { ...mockTask, task: '   ' }
    mockClaimTask.mockResolvedValue(emptyTask)

    await runPickup('run-abc')

    expect(mockFailTask).toHaveBeenCalledWith(mockTask.id, expect.stringContaining('validation'))
  })

  it('sends Telegram alert on validation failure', async () => {
    const emptyTask = { ...mockTask, task: '   ' }
    mockClaimTask.mockResolvedValue(emptyTask)

    await runPickup('run-abc')
    await Promise.resolve()

    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('validation failed')
  })

  it('returns validation-failed reason', async () => {
    const emptyTask = { ...mockTask, task: '' }
    mockClaimTask.mockResolvedValue(emptyTask)

    const result = await runPickup('run-abc')

    expect(result.claimed).toBeNull()
    expect(result.reason).toBe('validation-failed')
  })
})

// ── awaited Telegram send (component #2 fix) ──────────────────────────────────

describe('runPickup — awaited Telegram send', () => {
  it('logs error agent_events row when Telegram send fails', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    mockPostMessage.mockRejectedValue(new Error('network timeout'))

    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: insertFn }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await runPickup('run-abc')

    // Two inserts: first = task_pickup success, second = task_pickup_telegram_fail
    expect(insertFn).toHaveBeenCalledTimes(2)
    const errorRow = insertFn.mock.calls[1][0]
    expect(errorRow.status).toBe('error')
    expect(errorRow.task_type).toBe('task_pickup_telegram_fail')
  })

  it('returns ok:true even when Telegram send fails', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    mockPostMessage.mockRejectedValue(new Error('telegram down'))

    const result = await runPickup('run-abc')

    expect(result.ok).toBe(true)
    expect(result.claimed).toEqual(mockTask)
  })

  it('logs task id and error message in error row meta', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    mockPostMessage.mockRejectedValue(new Error('rate limited'))

    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: insertFn }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await runPickup('run-abc')

    const errorRow = insertFn.mock.calls[1][0]
    expect(errorRow.output_summary).toContain(mockTask.id)
    expect(String(errorRow.meta?.error ?? '')).toContain('rate limited')
  })
})

// ── agent_events insert precedes Telegram (component #2 prerequisite) ─────────

describe('runPickup — agent_events insert precedes Telegram send', () => {
  it('agent_events insert completes before Telegram fires on happy path', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    const callOrder: string[] = []

    const insertFn = vi.fn().mockImplementation(async () => {
      callOrder.push('agent_events_insert')
      return { data: null, error: null }
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: insertFn }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })
    mockPostMessage.mockImplementation(async () => {
      callOrder.push('telegram_send')
    })

    await runPickup('run-abc')
    await Promise.resolve()

    const insertIdx = callOrder.indexOf('agent_events_insert')
    const telegramIdx = callOrder.indexOf('telegram_send')
    expect(insertIdx).toBeGreaterThanOrEqual(0)
    expect(telegramIdx).toBeGreaterThanOrEqual(0)
    expect(insertIdx).toBeLessThan(telegramIdx)
  })

  it('agent_events row carries an explicit id UUID (for button callback_data embedding)', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: insertFn }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await runPickup('run-abc')

    const row = insertFn.mock.calls[0]?.[0]
    expect(row).toHaveProperty('id')
    expect(typeof row.id).toBe('string')
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

// ── buildRemoteTelegramMessage (pure) ─────────────────────────────────────────

describe('buildRemoteTelegramMessage', () => {
  const SESSION_URL = 'https://claude.ai/code/session_test123'

  it('contains task short id (first 8 chars)', () => {
    const msg = buildRemoteTelegramMessage(mockTask, SESSION_URL)
    expect(msg).toContain(mockTask.id.slice(0, 8))
  })

  it('contains task text preview', () => {
    const msg = buildRemoteTelegramMessage(mockTask, SESSION_URL)
    expect(msg).toContain('Sprint 4 Chunk A')
  })

  it('contains session URL', () => {
    const msg = buildRemoteTelegramMessage(mockTask, SESSION_URL)
    expect(msg).toContain(SESSION_URL)
  })

  it('does not contain manual run instruction', () => {
    const msg = buildRemoteTelegramMessage(mockTask, SESSION_URL)
    expect(msg).not.toContain('Run task')
  })
})

// ── HARNESS_REMOTE_INVOCATION_ENABLED: flag off ───────────────────────────────

describe('runPickup — HARNESS_REMOTE_INVOCATION_ENABLED: flag off', () => {
  it('does not call fireCoordinator when flag is not set', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    expect(mockFireCoordinator).not.toHaveBeenCalled()
  })

  it('sends manual Telegram message (with Run task instruction) when flag is off', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    await Promise.resolve()
    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain(`Run task ${mockTask.id}`)
  })

  it('does not call fireCoordinator when queue is empty and flag is off', async () => {
    mockClaimTask.mockResolvedValue(null)
    await runPickup('run-abc')
    expect(mockFireCoordinator).not.toHaveBeenCalled()
  })
})

// ── HARNESS_REMOTE_INVOCATION_ENABLED: flag on, success ──────────────────────

describe('runPickup — HARNESS_REMOTE_INVOCATION_ENABLED: flag on, invocation success', () => {
  beforeEach(() => {
    process.env.HARNESS_REMOTE_INVOCATION_ENABLED = '1'
  })

  it('calls fireCoordinator with task_id and run_id', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    expect(mockFireCoordinator).toHaveBeenCalledWith({
      task_id: mockTask.id,
      run_id: 'run-abc',
    })
  })

  it('Telegram message contains session URL on success', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    await Promise.resolve()
    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('https://claude.ai/code/session_test123')
  })

  it('Telegram message says automatically invoked on success', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    await Promise.resolve()
    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('automatically')
  })

  it('Telegram message does not include manual run instruction on success', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    await Promise.resolve()
    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).not.toContain('Run task')
  })

  it('does not call fireCoordinator when queue is empty', async () => {
    mockClaimTask.mockResolvedValue(null)
    await runPickup('run-abc')
    expect(mockFireCoordinator).not.toHaveBeenCalled()
  })
})

// ── HARNESS_REMOTE_INVOCATION_ENABLED: flag on, invocation failure ────────────

describe('runPickup — HARNESS_REMOTE_INVOCATION_ENABLED: flag on, invocation failure', () => {
  beforeEach(() => {
    process.env.HARNESS_REMOTE_INVOCATION_ENABLED = '1'
    mockFireCoordinator.mockResolvedValue({
      ok: false,
      error: 'Routine is paused.',
      failure_type: 'upstream',
      upstream_status: 400,
    })
  })

  it('falls back to manual Telegram message when invocation fails', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    await runPickup('run-abc')
    await Promise.resolve()
    const msg: string = mockPostMessage.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain(`Run task ${mockTask.id}`)
  })

  it('returns ok:true even when invocation fails', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    const result = await runPickup('run-abc')
    expect(result.ok).toBe(true)
  })

  it('returns claimed task even when invocation fails', async () => {
    mockClaimTask.mockResolvedValue(mockTask)
    const result = await runPickup('run-abc')
    expect(result.claimed).toEqual(mockTask)
  })
})
