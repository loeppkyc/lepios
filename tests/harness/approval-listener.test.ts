/**
 * Unit tests for lib/harness/approval-listener.ts — handleApprovedTask().
 *
 * Covers:
 * - D1-AC1: builder fire skipped when pending_notification_id is present (dedup guard)
 * - D1-AC2: approval_listener_skipped_dedup event written on dedup
 * - D1-AC3: fireBuilder called when pending_notification_id is absent
 * - D1-AC4: approval_listener_fired event written with status='success' on successful fire
 * - D1-AC5: approval_listener_fired event written with status='error' on failed fire
 * - D1-AC6: early return when BUILDER_ROUTINE_ID not set in harness_config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock fireBuilder ──────────────────────────────────────────────────────────

const { mockFireBuilder } = vi.hoisted(() => ({
  mockFireBuilder: vi.fn(),
}))

vi.mock('@/lib/harness/invoke-builder', () => ({
  fireBuilder: mockFireBuilder,
}))

// ── Import SUT ────────────────────────────────────────────────────────────────

import { handleApprovedTask } from '@/lib/harness/approval-listener'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASK_ID = 'task-uuid-1234-5678-abcd-efgh01234567'

/**
 * Build a chainable Supabase mock for a given table and the responses
 * it should return for each method call.
 */
function buildChain(result: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue({ error: null }),
    filter: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  }
  return chain
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleApprovedTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFireBuilder.mockResolvedValue({
      ok: true,
      session_id: 'session-abc',
      session_url: 'https://example.com/session',
    })
  })

  it('D1-AC6: returns early if BUILDER_ROUTINE_ID is absent from harness_config', async () => {
    // harness_config returns no row
    const configChain = buildChain({ data: null })
    mockFrom.mockReturnValue(configChain)

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).not.toHaveBeenCalled()
  })

  it('D1-AC6: returns early if BUILDER_ROUTINE_ID value is empty string', async () => {
    const configChain = buildChain({ data: { value: '   ' } })
    mockFrom.mockReturnValue(configChain)

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).not.toHaveBeenCalled()
  })

  it('D1-AC1 + D1-AC2: skips builder fire and logs skipped_dedup when pending_notification_id is present', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })

    // Different mock per from() call:
    // 1st call: harness_config → returns routineId
    // 2nd call: outbound_notifications → insert
    // 3rd call: task_queue → returns metadata with pending_notification_id
    // 4th call: agent_events → insert (skipped_dedup)
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // harness_config
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'routine-id-123' } }),
        }
      }
      if (callCount === 2) {
        // outbound_notifications insert
        return { insert: insertMock }
      }
      if (callCount === 3) {
        // task_queue select
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { metadata: { pending_notification_id: 'notif-uuid-999' } },
          }),
        }
      }
      if (callCount === 4) {
        // agent_events insert (skipped_dedup)
        return { insert: insertMock }
      }
      return { insert: insertMock, select: vi.fn().mockReturnThis() }
    })

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).not.toHaveBeenCalled()
    // The 4th from() call was agent_events insert for skipped_dedup
    expect(insertMock).toHaveBeenCalledTimes(2) // outbound_notifications + agent_events
    const dedupInsertCall = insertMock.mock.calls[1][0] as Record<string, unknown>
    expect(dedupInsertCall.action).toBe('approval_listener_skipped_dedup')
    expect(dedupInsertCall.status).toBe('info')
    expect((dedupInsertCall.meta as Record<string, unknown>).task_id).toBe(TASK_ID)
  })

  it('D1-AC3 + D1-AC4: fires builder and logs approval_listener_fired on success when no pending_notification_id', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // harness_config
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'routine-id-123' } }),
        }
      }
      if (callCount === 2) {
        // outbound_notifications insert
        return { insert: insertMock }
      }
      if (callCount === 3) {
        // task_queue select — no pending_notification_id
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { metadata: { some_other_key: 'value' } },
          }),
        }
      }
      if (callCount === 4) {
        // agent_events insert (approval_listener_fired success)
        return { insert: insertMock }
      }
      return { insert: insertMock }
    })

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).toHaveBeenCalledOnce()
    expect(mockFireBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: TASK_ID, run_id: expect.any(String) })
    )

    const firedInsertCall = insertMock.mock.calls[1][0] as Record<string, unknown>
    expect(firedInsertCall.action).toBe('approval_listener_fired')
    expect(firedInsertCall.status).toBe('success')
    expect((firedInsertCall.meta as Record<string, unknown>).task_id).toBe(TASK_ID)
    expect((firedInsertCall.meta as Record<string, unknown>).session_id).toBe('session-abc')
  })

  it('D1-AC5: logs approval_listener_fired with status=error when fireBuilder fails', async () => {
    mockFireBuilder.mockResolvedValue({
      ok: false,
      error: 'missing_env_vars',
      failure_type: 'missing_env',
    })

    const insertMock = vi.fn().mockResolvedValue({ error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'routine-id-123' } }),
        }
      }
      if (callCount === 2) {
        return { insert: insertMock }
      }
      if (callCount === 3) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { metadata: {} } }),
        }
      }
      if (callCount === 4) {
        return { insert: insertMock }
      }
      return { insert: insertMock }
    })

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).toHaveBeenCalledOnce()

    const errorInsertCall = insertMock.mock.calls[1][0] as Record<string, unknown>
    expect(errorInsertCall.action).toBe('approval_listener_fired')
    expect(errorInsertCall.status).toBe('error')
    expect((errorInsertCall.meta as Record<string, unknown>).failure_type).toBe('missing_env')
  })

  it('D1-AC3: treats null metadata (task not found) as no pending_notification_id — fires builder', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { value: 'routine-id-123' } }),
        }
      }
      if (callCount === 2) {
        return { insert: insertMock }
      }
      if (callCount === 3) {
        // task not found — data: null
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }
      if (callCount === 4) {
        return { insert: insertMock }
      }
      return { insert: insertMock }
    })

    await handleApprovedTask(TASK_ID)

    expect(mockFireBuilder).toHaveBeenCalledOnce()
  })
})
