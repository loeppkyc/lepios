/**
 * Tests for lib/harness/branch-guard.ts
 *
 * Covers:
 *   - Correct branch → no throw, no F18 event
 *   - Wrong branch → throws with actionable message, logs branch_guard_triggered
 *   - Missing task_id → throws explicit error (no silent fallback)
 *   - getExpectedBranch helper returns correct format
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock child_process ────────────────────────────────────────────────────────

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }))

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}))

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  getExpectedBranch,
  getCurrentBranch,
  assertCorrectBranch,
} from '@/lib/harness/branch-guard'

// ── Helper ────────────────────────────────────────────────────────────────────

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

// ── getExpectedBranch ─────────────────────────────────────────────────────────

describe('getExpectedBranch', () => {
  it('returns harness/task-{taskId} format', () => {
    expect(getExpectedBranch('abc123')).toBe('harness/task-abc123')
  })

  it('handles full UUID task_ids', () => {
    expect(getExpectedBranch('8cba5a75-b872-46b7-a13a-bc1058cabf4c')).toBe(
      'harness/task-8cba5a75-b872-46b7-a13a-bc1058cabf4c'
    )
  })
})

// ── getCurrentBranch ──────────────────────────────────────────────────────────

describe('getCurrentBranch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns trimmed output of git branch --show-current', () => {
    mockExecSync.mockReturnValue('harness/task-abc123\n')
    expect(getCurrentBranch()).toBe('harness/task-abc123')
    expect(mockExecSync).toHaveBeenCalledWith('git branch --show-current', { encoding: 'utf8' })
  })
})

// ── assertCorrectBranch — missing task_id ─────────────────────────────────────

describe('assertCorrectBranch — missing task_id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws explicit error when task_id is empty string', async () => {
    await expect(assertCorrectBranch('')).rejects.toThrow(
      /task_id is required/
    )
  })

  it('does not call git when task_id is missing', async () => {
    await expect(assertCorrectBranch('')).rejects.toThrow()
    expect(mockExecSync).not.toHaveBeenCalled()
  })
})

// ── assertCorrectBranch — correct branch ─────────────────────────────────────

describe('assertCorrectBranch — already on correct branch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves without throwing when on correct branch', async () => {
    mockExecSync.mockReturnValue('harness/task-abc123\n')
    mockFrom.mockReturnValue(makeInsertChain())

    await expect(assertCorrectBranch('abc123')).resolves.toBeUndefined()
  })

  it('does not log a branch_guard_triggered event on correct branch', async () => {
    mockExecSync.mockReturnValue('harness/task-abc123\n')
    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    await assertCorrectBranch('abc123')

    // agent_events insert should NOT have been called
    expect(insertChain.insert).not.toHaveBeenCalled()
  })
})

// ── assertCorrectBranch — wrong branch ───────────────────────────────────────

describe('assertCorrectBranch — wrong branch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws with a message naming the current and expected branches', async () => {
    mockExecSync.mockReturnValue('main\n')
    mockFrom.mockReturnValue(makeInsertChain())

    await expect(assertCorrectBranch('abc123')).rejects.toThrow(/harness\/task-abc123/)
  })

  it('error message includes the git checkout command to fix it', async () => {
    mockExecSync.mockReturnValue('claude/vibrant-heisenberg-LmXuK\n')
    mockFrom.mockReturnValue(makeInsertChain())

    const err = await assertCorrectBranch('abc123').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('git checkout -b harness/task-abc123')
  })

  it('logs branch_guard_triggered event with task_id and branches', async () => {
    mockExecSync.mockReturnValue('main\n')
    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    await assertCorrectBranch('abc123').catch(() => {})

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'branch_guard_triggered',
        status: 'warning',
        meta: expect.objectContaining({
          task_id: 'abc123',
          attempted_branch: 'main',
          expected_branch: 'harness/task-abc123',
        }),
      })
    )
  })

  it('still throws even if the F18 agent_events insert fails', async () => {
    mockExecSync.mockReturnValue('main\n')
    mockFrom.mockReturnValue({
      insert: vi.fn().mockRejectedValue(new Error('DB down')),
    })

    await expect(assertCorrectBranch('abc123')).rejects.toThrow(/harness\/task-abc123/)
  })
})
