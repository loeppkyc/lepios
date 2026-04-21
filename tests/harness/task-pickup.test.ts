/**
 * Unit tests for lib/harness/task-pickup.ts public functions.
 * Mocks @/lib/supabase/service — no real Supabase connection needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}))

import {
  claimTask,
  peekTask,
  heartbeat,
  reclaimStale,
  completeTask,
  failTask,
} from '@/lib/harness/task-pickup'
import type { TaskRow } from '@/lib/harness/task-pickup'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockTask: TaskRow = {
  id: 'task-uuid-1',
  task: 'Sprint 4 Chunk A',
  description: null,
  priority: 1,
  status: 'claimed',
  source: 'manual',
  metadata: {},
  result: null,
  retry_count: 0,
  max_retries: 2,
  created_at: '2026-04-21T16:00:00Z',
  claimed_at: '2026-04-21T16:00:05Z',
  claimed_by: 'run-abc',
  last_heartbeat_at: null,
  completed_at: null,
  error_message: null,
}

// ── Builder factories ─────────────────────────────────────────────────────────

function makeUpdateChain(result: { data: unknown; error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result)
  const update = vi.fn().mockReturnValue({ eq })
  return { update, _eq: eq }
}

function makePeekChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle,
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return chain
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── claimTask ─────────────────────────────────────────────────────────────────

describe('claimTask', () => {
  it('calls rpc claim_next_task with run_id and returns the claimed row', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockTask, error: null })
    mockRpc.mockReturnValue({ maybeSingle: mockMaybeSingle })

    const result = await claimTask('run-abc')

    expect(mockRpc).toHaveBeenCalledWith('claim_next_task', { p_run_id: 'run-abc' })
    expect(result).toEqual(mockTask)
  })

  it('returns null when queue is empty (rpc returns null data)', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    mockRpc.mockReturnValue({ maybeSingle: mockMaybeSingle })

    const result = await claimTask('run-abc')
    expect(result).toBeNull()
  })

  it('throws on rpc error', async () => {
    const mockMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'db error' } })
    mockRpc.mockReturnValue({ maybeSingle: mockMaybeSingle })

    await expect(claimTask('run-abc')).rejects.toEqual({ message: 'db error' })
  })
})

// ── peekTask ──────────────────────────────────────────────────────────────────

describe('peekTask', () => {
  it('selects queued tasks ordered by priority then created_at, returns top row', async () => {
    const chain = makePeekChain({ data: mockTask, error: null })
    mockFrom.mockReturnValue(chain)

    const result = await peekTask()

    expect(mockFrom).toHaveBeenCalledWith('task_queue')
    expect(chain.eq).toHaveBeenCalledWith('status', 'queued')
    expect(chain.order).toHaveBeenCalledWith('priority', { ascending: true })
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(chain.limit).toHaveBeenCalledWith(1)
    expect(result).toEqual(mockTask)
  })

  it('returns null when queue is empty', async () => {
    const chain = makePeekChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const result = await peekTask()
    expect(result).toBeNull()
  })

  it('throws on select error', async () => {
    const chain = makePeekChain({ data: null, error: { message: 'select failed' } })
    mockFrom.mockReturnValue(chain)

    await expect(peekTask()).rejects.toEqual({ message: 'select failed' })
  })
})

// ── heartbeat ─────────────────────────────────────────────────────────────────

describe('heartbeat', () => {
  it('updates last_heartbeat_at with current ISO timestamp', async () => {
    const { update, _eq } = makeUpdateChain({ data: null, error: null })
    mockFrom.mockReturnValue({ update })

    await heartbeat('task-123')

    expect(mockFrom).toHaveBeenCalledWith('task_queue')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ last_heartbeat_at: expect.any(String) })
    )
    expect(_eq).toHaveBeenCalledWith('id', 'task-123')
  })

  it('throws on update error', async () => {
    const { update } = makeUpdateChain({ data: null, error: { message: 'update failed' } })
    mockFrom.mockReturnValue({ update })

    await expect(heartbeat('task-123')).rejects.toEqual({ message: 'update failed' })
  })
})

// ── reclaimStale ──────────────────────────────────────────────────────────────

describe('reclaimStale', () => {
  it('calls rpc reclaim_stale_tasks and returns the result rows', async () => {
    const rows = [
      { action: 'queued', task_id: 'u1', new_retry_count: 1 },
      { action: 'cancelled', task_id: 'u2', new_retry_count: 2 },
    ]
    mockRpc.mockResolvedValue({ data: rows, error: null })

    const result = await reclaimStale()

    expect(mockRpc).toHaveBeenCalledWith('reclaim_stale_tasks')
    expect(result).toEqual(rows)
  })

  it('returns empty array when no stale tasks', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    const result = await reclaimStale()
    expect(result).toEqual([])
  })

  it('returns empty array when rpc returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })

    const result = await reclaimStale()
    expect(result).toEqual([])
  })

  it('throws on rpc error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'reclaim failed' } })

    await expect(reclaimStale()).rejects.toEqual({ message: 'reclaim failed' })
  })
})

// ── completeTask ──────────────────────────────────────────────────────────────

describe('completeTask', () => {
  it('sets status=completed and completed_at without result', async () => {
    const { update, _eq } = makeUpdateChain({ data: null, error: null })
    mockFrom.mockReturnValue({ update })

    await completeTask('task-123')

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', completed_at: expect.any(String) })
    )
    expect(_eq).toHaveBeenCalledWith('id', 'task-123')
    // result key should not be present when not provided
    const callArg = update.mock.calls[0][0]
    expect(callArg).not.toHaveProperty('result')
  })

  it('includes result in update when provided', async () => {
    const { update } = makeUpdateChain({ data: null, error: null })
    mockFrom.mockReturnValue({ update })

    await completeTask('task-123', { summary: 'all chunks done' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        result: { summary: 'all chunks done' },
      })
    )
  })

  it('throws on update error', async () => {
    const { update } = makeUpdateChain({ data: null, error: { message: 'update failed' } })
    mockFrom.mockReturnValue({ update })

    await expect(completeTask('task-123')).rejects.toEqual({ message: 'update failed' })
  })
})

// ── failTask ──────────────────────────────────────────────────────────────────

describe('failTask', () => {
  it('sets status=failed with error_message and completed_at', async () => {
    const { update, _eq } = makeUpdateChain({ data: null, error: null })
    mockFrom.mockReturnValue({ update })

    await failTask('task-123', 'validation: task field is empty')

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'validation: task field is empty',
        completed_at: expect.any(String),
      })
    )
    expect(_eq).toHaveBeenCalledWith('id', 'task-123')
  })

  it('throws on update error', async () => {
    const { update } = makeUpdateChain({ data: null, error: { message: 'update failed' } })
    mockFrom.mockReturnValue({ update })

    await expect(failTask('task-123', 'boom')).rejects.toEqual({ message: 'update failed' })
  })
})
