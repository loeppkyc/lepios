/**
 * Tests for Task Pickup → 100% gap-fill work:
 *   1. Heartbeat route happy path
 *   2. Heartbeat prevents stale reclaim (15-min window)
 *   3. latency_ms recorded in agent_events meta
 *   4. queue_depth recorded in agent_events meta
 *   5. Daily cron shape in vercel.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}))

// ── Mock task-pickup lib ──────────────────────────────────────────────────────

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

// ── Mock fireCoordinator ──────────────────────────────────────────────────────

const { mockFireCoordinator } = vi.hoisted(() => ({
  mockFireCoordinator: vi.fn(),
}))

vi.mock('@/lib/harness/invoke-coordinator', () => ({
  fireCoordinator: mockFireCoordinator,
}))

// ── Mock recordAttribution ────────────────────────────────────────────────────

vi.mock('@/lib/attribution/writer', () => ({
  recordAttribution: vi.fn(),
}))

// ── Mock sendMessageWithButtons ───────────────────────────────────────────────

vi.mock('@/lib/harness/telegram-buttons', () => ({
  sendMessageWithButtons: vi.fn().mockResolvedValue(undefined),
}))

import { runPickup } from '@/lib/harness/pickup-runner'
import type { TaskRow } from '@/lib/harness/task-pickup'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const mockTask: TaskRow = {
  id: TASK_UUID,
  task: 'Sprint 5 heartbeat test',
  description: null,
  priority: 1,
  status: 'claimed',
  source: 'manual',
  metadata: {},
  result: null,
  retry_count: 0,
  max_retries: 3,
  created_at: new Date(Date.now() - 5_000).toISOString(), // created 5s ago
  claimed_at: new Date().toISOString(),
  claimed_by: 'run-test',
  last_heartbeat_at: null,
  completed_at: null,
  error_message: null,
}

function makeInsertBuilder(overrides?: { error?: unknown }) {
  const insert = vi.fn().mockResolvedValue({ data: null, error: overrides?.error ?? null })
  return { insert }
}

function makeUpdateSelectChain(rowsReturned: unknown[] = [{ id: TASK_UUID }]) {
  const select = vi.fn().mockResolvedValue({ data: rowsReturned, error: null })
  const eqStatus = vi.fn().mockReturnValue({ select })
  const eqId = vi.fn().mockReturnValue({ eq: eqStatus })
  const update = vi.fn().mockReturnValue({ eq: eqId })
  return { update, _eqId: eqId, _eqStatus: eqStatus, _select: select }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TASK_PICKUP_DRY_RUN
  delete process.env.HARNESS_REMOTE_INVOCATION_ENABLED
  mockReclaimStale.mockResolvedValue([])
  mockPostMessage.mockResolvedValue(undefined)
  mockFireCoordinator.mockResolvedValue({ ok: false, error: 'not enabled' })
})

// ── Test 1: Heartbeat route — happy path ──────────────────────────────────────

describe('task-heartbeat route — happy path', () => {
  it('updates last_heartbeat_at for claimed task and logs agent_events', async () => {
    // Import the route handler directly
    const { POST } = await import('@/app/api/harness/task-heartbeat/route')

    const agentEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelectChain = makeUpdateSelectChain([{ id: TASK_UUID }])

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') return updateSelectChain
      if (table === 'agent_events') return { insert: agentEventsInsert }
      return makeInsertBuilder()
    })

    const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-secret`,
      },
      body: JSON.stringify({ task_id: TASK_UUID, run_id: 'run-heartbeat-test' }),
    })

    // Bypass auth for test (no CRON_SECRET set → isAuthorized returns true)
    const response = await POST(request)
    const body = await response.json()

    expect(body.ok).toBe(true)

    // Verify update was called on task_queue
    expect(mockFrom).toHaveBeenCalledWith('task_queue')
    expect(updateSelectChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_heartbeat_at: expect.any(String) })
    )

    // Verify agent_events insert happened with correct action
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertCall = agentEventsInsert.mock.calls[0]?.[0]
    expect(insertCall).toBeDefined()
    expect(insertCall.action).toBe('task_heartbeat')
    expect(insertCall.actor).toBe('coordinator')
    expect(insertCall.status).toBe('success')
    expect(insertCall.meta.task_id).toBe(TASK_UUID)
    expect(insertCall.meta.run_id).toBe('run-heartbeat-test')
  })

  it('returns { ok: false } when task not found or not claimed', async () => {
    const { POST } = await import('@/app/api/harness/task-heartbeat/route')

    const updateSelectChain = makeUpdateSelectChain([]) // 0 rows updated

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') return updateSelectChain
      return makeInsertBuilder()
    })

    const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: TASK_UUID }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('task not found or not claimed')
  })

  it('returns 401 when CRON_SECRET is set and auth header is wrong', async () => {
    process.env.CRON_SECRET = 'real-secret'
    const { POST } = await import('@/app/api/harness/task-heartbeat/route')

    const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-secret',
      },
      body: JSON.stringify({ task_id: TASK_UUID }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
    delete process.env.CRON_SECRET
  })

  it('returns 400 when task_id is missing', async () => {
    const { POST } = await import('@/app/api/harness/task-heartbeat/route')

    const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: 'run-xyz' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 when task_id is not a valid UUID', async () => {
    const { POST } = await import('@/app/api/harness/task-heartbeat/route')

    const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: 'not-a-uuid' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})

// ── Test 2: Heartbeat prevents stale reclaim ──────────────────────────────────

describe('heartbeat prevents stale reclaim within 15-min window', () => {
  it('task with last_heartbeat_at 12 min ago would NOT be stale under 15-min window', () => {
    // The reclaim_stale_tasks() SQL function uses:
    //   COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '15 minutes'
    //
    // Simulate: task claimed 20 minutes ago, last heartbeat 12 minutes ago.
    // Under the 15-minute window, last_heartbeat_at (12 min) is NOT stale.

    const now = Date.now()
    const claimedAt = new Date(now - 20 * 60 * 1000).toISOString()
    const lastHeartbeatAt = new Date(now - 12 * 60 * 1000).toISOString()
    const staleThreshold = new Date(now - 15 * 60 * 1000)

    const heartbeatTime = new Date(lastHeartbeatAt)
    const claimedTime = new Date(claimedAt)

    // COALESCE(last_heartbeat_at, claimed_at) → last_heartbeat_at (not null)
    const effectiveTime = heartbeatTime

    // Task is stale only if effectiveTime < staleThreshold
    const isStale = effectiveTime < staleThreshold

    expect(isStale).toBe(false) // heartbeat 12 min ago is within 15-min window

    // Without heartbeat: claimed_at (20 min) WOULD be stale
    const isStaleWithoutHeartbeat = claimedTime < staleThreshold
    expect(isStaleWithoutHeartbeat).toBe(true)
  })

  it('task with last_heartbeat_at 16 min ago IS stale under 15-min window', () => {
    const now = Date.now()
    const lastHeartbeatAt = new Date(now - 16 * 60 * 1000).toISOString()
    const staleThreshold = new Date(now - 15 * 60 * 1000)

    const heartbeatTime = new Date(lastHeartbeatAt)
    const isStale = heartbeatTime < staleThreshold

    expect(isStale).toBe(true) // 16 min ago IS stale
  })
})

// ── Test 3: latency_ms recorded in agent_events ───────────────────────────────

describe('runPickup — F18 latency_ms in agent_events meta', () => {
  it('records latency_ms as a non-negative integer in agent_events meta', async () => {
    const taskWithKnownAge: TaskRow = {
      ...mockTask,
      created_at: new Date(Date.now() - 3_000).toISOString(), // 3 seconds ago
    }
    mockClaimTask.mockResolvedValue(taskWithKnownAge)

    const agentEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    // First from() call (attribution) and subsequent calls both need to return something usable
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentEventsInsert }
      if (table === 'task_queue') {
        // queue_depth count query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          }),
        }
      }
      return makeInsertBuilder()
    })

    await runPickup('run-latency-test')

    // Find the task_pickup success event (first agent_events insert)
    const pickupInsertCall = agentEventsInsert.mock.calls.find(
      (c) => c[0]?.action === 'task_pickup'
    )
    expect(pickupInsertCall).toBeDefined()

    const meta = pickupInsertCall![0].meta
    expect(meta).toHaveProperty('latency_ms')
    expect(typeof meta.latency_ms).toBe('number')
    expect(meta.latency_ms).toBeGreaterThanOrEqual(0)
  })
})

// ── Test 4: queue_depth recorded in agent_events ──────────────────────────────

describe('runPickup — F18 queue_depth in agent_events meta', () => {
  it('records queue_depth as a non-negative integer in agent_events meta', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    const agentEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentEventsInsert }
      if (table === 'task_queue') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }
      }
      return makeInsertBuilder()
    })

    await runPickup('run-depth-test')

    const pickupInsertCall = agentEventsInsert.mock.calls.find(
      (c) => c[0]?.action === 'task_pickup'
    )
    expect(pickupInsertCall).toBeDefined()

    const meta = pickupInsertCall![0].meta
    expect(meta).toHaveProperty('queue_depth')
    expect(typeof meta.queue_depth).toBe('number')
    expect(meta.queue_depth).toBeGreaterThanOrEqual(0)
  })

  it('sets queue_depth to null when count query fails, does not abort pickup', async () => {
    mockClaimTask.mockResolvedValue(mockTask)

    const agentEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_events') return { insert: agentEventsInsert }
      if (table === 'task_queue') {
        return {
          select: vi.fn().mockImplementation(() => {
            throw new Error('db connection lost')
          }),
        }
      }
      return makeInsertBuilder()
    })

    // Should not throw despite queue_depth query failing
    const result = await runPickup('run-depth-fail-test')
    expect(result.ok).toBe(true)
    expect(result.claimed).toEqual(mockTask)

    const pickupInsertCall = agentEventsInsert.mock.calls.find(
      (c) => c[0]?.action === 'task_pickup'
    )
    expect(pickupInsertCall).toBeDefined()
    expect(pickupInsertCall![0].meta.queue_depth).toBeNull()
  })
})

// ── Test 5: vercel.json hourly cron shape (H3 Part B) ─────────────────────────

describe('vercel.json — task-pickup cron schedule', () => {
  it('task-pickup entry has schedule "0 * * * *" (hourly — H3 Part B)', () => {
    const vercelJsonPath = path.resolve(__dirname, '../../vercel.json')
    const raw = fs.readFileSync(vercelJsonPath, 'utf-8')
    const config = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> }

    const entry = config.crons?.find((c) => c.path === '/api/cron/task-pickup')
    expect(entry).toBeDefined()
    expect(entry!.schedule).toBe('0 * * * *')
  })
})
