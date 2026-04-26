/**
 * Tests for lib/harness/branch-guard.ts
 *
 * Covers:
 *   - Correct branch → no throw, no F18 event
 *   - Wrong branch → throws with actionable message, logs branch_guard_triggered
 *   - Missing task_id → throws explicit error (no silent fallback)
 *   - getExpectedBranch helper returns correct format
 *   - buildBranchGuardLine: 0 events, N>0 events, older events excluded, DB error
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
  buildBranchGuardLine,
} from '@/lib/harness/branch-guard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

function makeSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
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

// ── buildBranchGuardLine ──────────────────────────────────────────────────────

describe('buildBranchGuardLine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns "0 ✅" line when no events in last 24h', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: [], error: null }))
    const line = await buildBranchGuardLine()
    expect(line).toBe('Branch guard fires (24h): 0 ✅')
  })

  it('returns count and task_ids when events exist', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain({
        data: [
          { meta: { task_id: 'abc123', attempted_branch: 'main' } },
          { meta: { task_id: 'def456', attempted_branch: 'main' } },
          { meta: { task_id: 'abc123', attempted_branch: 'main' } }, // duplicate task_id
        ],
        error: null,
      })
    )
    const line = await buildBranchGuardLine()
    expect(line).toBe('Branch guard fires (24h): 3 — task_ids: [abc123, def456]')
  })

  it('deduplicates task_ids in the output', async () => {
    mockFrom.mockReturnValue(
      makeSelectChain({
        data: [
          { meta: { task_id: 'abc123' } },
          { meta: { task_id: 'abc123' } },
        ],
        error: null,
      })
    )
    const line = await buildBranchGuardLine()
    // count is 2 (two events), but task_id appears only once
    expect(line).toContain('Branch guard fires (24h): 2')
    expect(line).toContain('task_ids: [abc123]')
    expect(line.split('abc123').length - 1).toBe(1) // appears exactly once
  })

  it('events older than 24h are excluded (gte filter applied to occurred_at)', async () => {
    // The query uses .gte('occurred_at', since) — mock returns empty simulating no recent rows
    mockFrom.mockReturnValue(makeSelectChain({ data: [], error: null }))
    const line = await buildBranchGuardLine()
    expect(line).toBe('Branch guard fires (24h): 0 ✅')
    // Verify the gte call was made (DB-level exclusion of old events)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain = mockFrom.mock.results[0].value as any
    expect(chain.gte).toHaveBeenCalledWith('occurred_at', expect.any(String))
  })

  it('returns "status unavailable" on DB error — never throws', async () => {
    mockFrom.mockReturnValue(makeSelectChain({ data: null, error: { message: 'DB error' } }))
    const line = await buildBranchGuardLine()
    expect(line).toBe('Branch guard: status unavailable')
  })

  it('returns "status unavailable" on thrown exception — never throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB down')
    })
    const line = await buildBranchGuardLine()
    expect(line).toBe('Branch guard: status unavailable')
  })
})
