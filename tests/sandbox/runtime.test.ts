/**
 * Sandbox Slice 1 — unit tests for runtime.ts, fs-diff.ts, digest.ts, and
 * the orphan GC query shape.
 *
 * All DB calls are mocked via vi.hoisted + vi.mock.
 * Shell / git / process-group-kill tests are skipped on Windows
 * (process.kill(-pgid) requires POSIX — confirmed on Vercel via Slice 0 spike).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

const isWindows = process.platform === 'win32'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const {
  mockFrom,
  mockInsert,
  mockSelect,
  mockUpdate,
  mockEq,
  mockSingle,
  mockIn,
  mockLt,
  mockIs,
  mockGte,
  mockLimit,
} = vi.hoisted(() => {
  const mockSingle = vi.fn()
  const mockLimit = vi.fn()
  const mockGte = vi.fn()
  const mockIs = vi.fn()
  const mockLt = vi.fn()
  const mockIn = vi.fn()
  const mockEq = vi.fn()
  const mockUpdate = vi.fn()
  const mockSelect = vi.fn()
  const mockInsert = vi.fn()
  const mockFrom = vi.fn()
  return {
    mockFrom,
    mockInsert,
    mockSelect,
    mockUpdate,
    mockEq,
    mockSingle,
    mockIn,
    mockLt,
    mockIs,
    mockGte,
    mockLimit,
  }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── monotonic mock — deterministic durationMs in tests ────────────────────────

const { mockMonotonicNow } = vi.hoisted(() => ({
  mockMonotonicNow: vi.fn(() => 0),
}))

vi.mock('@/lib/harness/sandbox/monotonic', () => ({
  monotonicNow: mockMonotonicNow,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a chainable Supabase mock that resolves to `result`.
 * Covers: from().insert().select().single()
 *        from().insert()  [no select]
 *        from().select().eq().single()
 *        from().select().in().lt().is()
 *        from().update().eq()
 *        from().from('agent_events').insert()  (infra failure event)
 */
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  const methods = ['select', 'insert', 'update', 'eq', 'single', 'in', 'lt', 'is', 'gte', 'limit']
  for (const m of methods) {
    chain[m] = vi.fn(self)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

/** Shorthand for a successful insert that returns a row with a given id. */
function insertOk(id: string) {
  return makeChain({ data: { id }, error: null })
}

/** Shorthand for a failed insert. */
function insertFail(msg = 'insert error') {
  return makeChain({ data: null, error: { message: msg } })
}

/** Shorthand for a successful select returning one row. */
function selectOk(data: Record<string, unknown>) {
  return makeChain({ data, error: null })
}

// ── Import under test (after mocks) ──────────────────────────────────────────

import { runInSandbox, cleanupSandbox, buildOrphanGcQuery } from '@/lib/harness/sandbox/runtime'
import { buildSandboxDigestLine } from '@/lib/harness/sandbox/digest'

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockMonotonicNow.mockReturnValueOnce(0).mockReturnValueOnce(123) // start, end → 123ms
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 3 — No-op round-trip (echo hello)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)('AC3 — no-op round-trip: echo hello', () => {
  it('returns exitCode=0, stdout contains hello, timedOut=false, one sandbox_runs row', async () => {
    const runId = 'run-ac3-001'
    // from('sandbox_runs').insert → ok
    mockFrom
      .mockReturnValueOnce(insertOk(runId)) // sandbox_runs INSERT
      .mockReturnValueOnce(insertOk('aa-bb')) // agent_actions INSERT
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // sandbox_runs UPDATE (audit_action_id)
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // sandbox_runs UPDATE (final)

    const result = await runInSandbox('echo hello', {
      agentId: 'test',
      capability: 'shell.run',
      scope: { fs: { allowedPaths: ['.'] } },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.timedOut).toBe(false)
    expect(result.runId).toBe(runId)
    expect(result.warnings).toContain('process_isolation_not_enforced')
  }, 15_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 4 — fs-diff captures a real file change
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)('AC4 — fs-diff captures a real change', () => {
  it('returns non-empty filesChanged and a non-empty diffHash after writing a file', async () => {
    const runId = 'run-ac4-001'
    mockFrom
      .mockReturnValueOnce(insertOk(runId))
      .mockReturnValueOnce(insertOk('aa-bb'))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const result = await runInSandbox('echo modified > sandbox_test_ac4.txt', {
      agentId: 'test',
      capability: 'shell.run',
      scope: { fs: { allowedPaths: ['.'] } },
    })

    expect(result.filesChanged).toContain('sandbox_test_ac4.txt')
    expect(result.diffStat.insertions).toBeGreaterThanOrEqual(1)
    expect(result.diffHash).toBeTruthy()
    expect(result.diffHash.length).toBeGreaterThan(0)
  }, 15_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 5 — intentional failure inside sandbox does not affect main
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC5 — sandbox isolation: rm -rf .git inside worktree leaves live workspace intact',
  () => {
    it('live .git/ is intact after rm -rf .git inside worktree', async () => {
      const runId = 'run-ac5-001'
      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(insertOk('aa-bb'))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const result = await runInSandbox('rm -rf .git && echo done', {
        agentId: 'test',
        capability: 'shell.run',
        scope: { fs: { allowedPaths: ['.'] } },
      })

      // The cmd exited successfully inside the worktree
      expect(result.exitCode).toBe(0)

      // The live workspace .git/ is still intact
      const liveGit = path.resolve(__dirname, '..', '..', '.git')
      const { existsSync } = await import('fs')
      expect(existsSync(liveGit)).toBe(true)

      // Cleanup
      if (result.runId) {
        mockFrom.mockReturnValueOnce(selectOk({ worktree_path: result.worktreePath }))
        mockFrom.mockReturnValueOnce(makeChain({ data: null, error: null }))
        try {
          await cleanupSandbox(result.runId)
        } catch {
          // Best-effort
        }
      }
    }, 20_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 6 — timeout enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)('AC6 — timeout enforcement: sleep 10 killed at 1000ms', () => {
  it('returns timedOut=true, exitCode=null, status=timeout within ~2s', async () => {
    const runId = 'run-ac6-001'
    mockMonotonicNow.mockReset()
    mockMonotonicNow.mockReturnValueOnce(0).mockReturnValueOnce(1100)

    mockFrom
      .mockReturnValueOnce(insertOk(runId))
      .mockReturnValueOnce(insertOk('aa-bb'))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const result = await runInSandbox('sleep 10', {
      agentId: 'test',
      capability: 'shell.run',
      scope: { fs: { allowedPaths: ['.'] } },
      timeoutMs: 1000,
    })

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  }, 10_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 7 — cleanupSandbox
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC7 — cleanupSandbox removes worktree from disk and marks cleaned',
  () => {
    it('worktreePath does not exist after cleanup, DB updated', async () => {
      const runId = 'run-ac7-001'
      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(insertOk('aa-bb'))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const result = await runInSandbox('echo cleanup_test', {
        agentId: 'test',
        capability: 'shell.run',
        scope: { fs: { allowedPaths: ['.'] } },
      })

      const worktreePath = result.worktreePath

      // Mock DB lookup for cleanup
      mockFrom
        .mockReturnValueOnce(selectOk({ worktree_path: worktreePath })) // select
        .mockReturnValueOnce(makeChain({ data: null, error: null })) // update

      await cleanupSandbox(result.runId)

      const { existsSync } = await import('fs')
      expect(existsSync(worktreePath)).toBe(false)
    }, 20_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 8 — orphan GC query shape
// ─────────────────────────────────────────────────────────────────────────────

describe('AC8 — orphan GC query exists and has correct shape', () => {
  it('buildOrphanGcQuery returns a query for running/completed rows older than 24h with no cleaned_at', () => {
    // Build a chainable mock that records method calls
    const calls: string[] = []
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'in', 'lt', 'is', 'gte', 'limit', 'eq']
    for (const m of methods) {
      chain[m] = vi.fn((..._args: unknown[]) => {
        calls.push(m)
        return chain
      })
    }

    const mockDb = { from: vi.fn((_table: string) => chain) } as unknown as ReturnType<
      typeof import('@/lib/supabase/service').createServiceClient
    >

    buildOrphanGcQuery(mockDb)

    expect(mockDb.from).toHaveBeenCalledWith('sandbox_runs')
    expect(calls).toContain('select')
    expect(calls).toContain('in')
    expect(calls).toContain('lt')
    expect(calls).toContain('is')

    // Verify 'in' was called with the expected statuses
    const inCall = (chain['in'] as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(inCall[0]).toBe('status')
    expect(inCall[1]).toEqual(['running', 'completed'])

    // Verify 'is' was called checking cleaned_at is null
    const isCall = (chain['is'] as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(isCall[0]).toBe('cleaned_at')
    expect(isCall[1]).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 9 — net_isolation_not_enforced warning
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC9 — net_isolation_not_enforced warning surfaces when net scope present',
  () => {
    it('includes net_isolation_not_enforced when net.allowedHosts is non-empty', async () => {
      const runId = 'run-ac9-001'
      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(insertOk('aa-bb'))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const result = await runInSandbox('true', {
        agentId: 'test',
        capability: 'shell.run',
        scope: {
          fs: { allowedPaths: ['.'] },
          net: { allowedHosts: ['example.com'] },
        },
      })

      expect(result.warnings).toContain('net_isolation_not_enforced')
    }, 15_000)

    it('does NOT include net_isolation_not_enforced when net scope absent', async () => {
      const runId = 'run-ac9-002'
      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(insertOk('aa-bb'))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const result = await runInSandbox('true', {
        agentId: 'test',
        capability: 'shell.run',
        scope: { fs: { allowedPaths: ['.'] } },
      })

      expect(result.warnings).not.toContain('net_isolation_not_enforced')
    }, 15_000)

    it('does NOT include net_isolation_not_enforced when net scope is empty object', async () => {
      const runId = 'run-ac9-003'
      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(insertOk('aa-bb'))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const result = await runInSandbox('true', {
        agentId: 'test',
        capability: 'shell.run',
        scope: { fs: { allowedPaths: ['.'] }, net: {} },
      })

      expect(result.warnings).not.toContain('net_isolation_not_enforced')
    }, 15_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 10 — process_isolation_not_enforced on every run
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)('AC10 — process_isolation_not_enforced on every run in slice 1', () => {
  it('always includes process_isolation_not_enforced', async () => {
    const runId = 'run-ac10-001'
    mockFrom
      .mockReturnValueOnce(insertOk(runId))
      .mockReturnValueOnce(insertOk('aa-bb'))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))

    const result = await runInSandbox('true', {
      agentId: 'test',
      capability: 'shell.run',
      scope: { fs: { allowedPaths: ['.'] } },
    })

    expect(result.warnings).toContain('process_isolation_not_enforced')
  }, 15_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 11 — audit row written (mocked DB)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC11 — agent_actions row with action_type=sandbox_check is inserted',
  () => {
    it('calls agent_actions INSERT with action_type=sandbox_check', async () => {
      const runId = 'run-ac11-001'
      const actionId = 'action-ac11-001'

      let agentActionsInsertPayload: Record<string, unknown> | null = null

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sandbox_runs') {
          return insertOk(runId)
        }
        if (table === 'agent_actions') {
          // Capture the insert payload
          const chain = makeChain({ data: { id: actionId }, error: null })
          const origInsert = chain['insert'] as ReturnType<typeof vi.fn>
          origInsert.mockImplementationOnce((payload: Record<string, unknown>) => {
            agentActionsInsertPayload = payload
            return chain
          })
          return chain
        }
        return makeChain({ data: null, error: null })
      })

      await runInSandbox('true', {
        agentId: 'test',
        capability: 'shell.run',
        scope: { fs: { allowedPaths: ['.'] } },
      })

      expect(agentActionsInsertPayload).not.toBeNull()
      expect((agentActionsInsertPayload as Record<string, unknown>)['action_type']).toBe(
        'sandbox_check'
      )
    }, 15_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance 12 — morning digest line (pure unit test, no real DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC12 — buildSandboxDigestLine', () => {
  it('returns "no run in last 24h" when no rows', async () => {
    mockFrom.mockReturnValueOnce(makeChain({ data: [], error: null }))
    const line = await buildSandboxDigestLine()
    expect(line).toBe('Sandbox: no run in last 24h')
  })

  it('returns correct counts with 0 denies and 0 timeouts', async () => {
    mockFrom.mockReturnValueOnce(
      makeChain({
        data: [{ status: 'completed' }, { status: 'completed' }],
        error: null,
      })
    )
    const line = await buildSandboxDigestLine()
    expect(line).toBe('Sandbox (24h): 2 runs, 0 denies, 0 timeouts')
  })

  it('returns "1 timeouts" after a timed-out run', async () => {
    mockFrom.mockReturnValueOnce(
      makeChain({
        data: [{ status: 'completed' }, { status: 'timeout' }, { status: 'failed' }],
        error: null,
      })
    )
    const line = await buildSandboxDigestLine()
    expect(line).toContain('1 timeouts')
    expect(line).toContain('3 runs')
  })

  it('returns "stats unavailable" on DB error — never throws', async () => {
    mockFrom.mockReturnValueOnce(makeChain({ data: null, error: { message: 'db down' } }))
    const line = await buildSandboxDigestLine()
    expect(line).toBe('Sandbox: stats unavailable')
  })

  it('returns "stats unavailable" on thrown exception — never throws', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('connection refused')
    })
    const line = await buildSandboxDigestLine()
    expect(line).toBe('Sandbox: stats unavailable')
  })
})
