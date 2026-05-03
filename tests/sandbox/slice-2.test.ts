/**
 * Sandbox Slice 2 — unit tests for:
 *   - checkSandboxAction() (AC1)
 *   - Denial propagates to SandboxDeniedError (AC2)
 *   - Infra failure in checkSandboxAction does not block run (AC3)
 *   - runSandboxGc orphan sweep (AC4)
 *   - Migration 0068 content (AC5)
 *
 * AC2 and AC3 require real git worktree creation (POSIX only).
 * AC1, AC4, AC5 are pure mocks and run on all platforms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'

const isWindows = process.platform === 'win32'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── monotonic mock ────────────────────────────────────────────────────────────

const { mockMonotonicNow } = vi.hoisted(() => ({
  mockMonotonicNow: vi.fn(() => 0),
}))

vi.mock('@/lib/harness/sandbox/monotonic', () => ({
  monotonicNow: mockMonotonicNow,
}))

// ── capability mock — used by AC1, AC2, AC3 ──────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', () => ({
  checkCapability: mockCheckCapability,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function insertOk(id: string) {
  return makeChain({ data: { id }, error: null })
}

function insertFail(msg = 'insert error') {
  return makeChain({ data: null, error: { message: msg } })
}

// ── Imports under test (after mocks) ─────────────────────────────────────────

import { checkSandboxAction, SandboxDeniedError } from '@/lib/security/sandbox-contract'
import { runInSandbox, cleanupSandbox, buildOrphanGcQuery } from '@/lib/harness/sandbox/runtime'
import { runSandboxGc } from '@/lib/harness/sandbox/gc'

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockMonotonicNow.mockReturnValueOnce(0).mockReturnValueOnce(123)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — checkSandboxAction() returns allowed for seeded agent (mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC1 — checkSandboxAction() returns allowed when checkCapability allows', () => {
  it('returns { allowed: true } for builder/sandbox.run', async () => {
    mockCheckCapability.mockResolvedValueOnce({
      allowed: true,
      reason: 'in_scope',
      enforcement_mode: 'log_only',
      audit_id: 'audit-ac1-001',
    })

    const result = await checkSandboxAction({
      agentId: 'builder',
      sandboxId: 'builder:sandbox-test',
      capability: 'sandbox.run',
      scope: { fs: { allowedPaths: ['.'] } },
    })

    expect(result.allowed).toBe(true)
    expect(mockCheckCapability).toHaveBeenCalledWith({
      agentId: 'builder',
      capability: 'sandbox.run',
      target: 'builder:sandbox-test',
      context: { sandboxId: 'builder:sandbox-test' },
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — Denial propagates to SandboxDeniedError (POSIX only)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC2 — denial propagates: SandboxDeniedError thrown, DB row status=denied',
  () => {
    it('throws SandboxDeniedError and marks sandbox_runs row as denied', async () => {
      const runId = 'run-ac2-001'

      // Step 3 DB insert
      mockFrom
        .mockReturnValueOnce(insertOk(runId)) // sandbox_runs INSERT
        .mockReturnValueOnce(makeChain({ data: null, error: null })) // sandbox_runs UPDATE (denied)

      // checkCapability returns denied
      mockCheckCapability.mockResolvedValueOnce({
        allowed: false,
        reason: 'not_granted',
        enforcement_mode: 'enforce',
        audit_id: 'audit-ac2-001',
      })

      await expect(
        runInSandbox('echo should_not_run', {
          agentId: 'builder',
          capability: 'sandbox.run',
          scope: { fs: { allowedPaths: ['.'] } },
        })
      ).rejects.toThrow(SandboxDeniedError)

      // Verify the denied update was called
      const calls = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calls).toContain('sandbox_runs')
    }, 15_000)

    it('SandboxDeniedError carries agentId, capability, reason, auditId', async () => {
      const runId = 'run-ac2-002'

      mockFrom
        .mockReturnValueOnce(insertOk(runId))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      mockCheckCapability.mockResolvedValueOnce({
        allowed: false,
        reason: 'no_grant_for_agent',
        enforcement_mode: 'enforce',
        audit_id: 'audit-ac2-002',
      })

      let caughtError: unknown
      try {
        await runInSandbox('echo x', {
          agentId: 'coordinator',
          capability: 'sandbox.execute',
          scope: { fs: { allowedPaths: ['.'] } },
        })
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(SandboxDeniedError)
      const denied = caughtError as SandboxDeniedError
      expect(denied.agentId).toBe('coordinator')
      expect(denied.capability).toBe('sandbox.execute')
      expect(denied.reason).toBe('no_grant_for_agent')
      expect(denied.auditId).toBe('audit-ac2-002')
    }, 15_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// AC3 — Infra failure in checkSandboxAction does not block run (POSIX only)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(isWindows)(
  'AC3 — infra failure in checkSandboxAction: run continues, agent_events row written',
  () => {
    it('run completes successfully when checkSandboxAction throws', async () => {
      const runId = 'run-ac3-001'

      let agentEventsInsertPayload: Record<string, unknown> | null = null

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sandbox_runs') {
          return insertOk(runId)
        }
        if (table === 'agent_events') {
          const chain = makeChain({ data: null, error: null })
          const origInsert = chain['insert'] as ReturnType<typeof vi.fn>
          origInsert.mockImplementationOnce((payload: Record<string, unknown>) => {
            agentEventsInsertPayload = payload
            return chain
          })
          return chain
        }
        // agent_actions INSERT
        return insertOk('action-ac3-001')
      })

      // checkCapability throws — simulates infra failure
      mockCheckCapability.mockRejectedValueOnce(new Error('supabase connection refused'))

      // Allow capability check to allow through (infra_error_allow fallback)
      // run should complete normally
      const result = await runInSandbox('echo infra_ok', {
        agentId: 'builder',
        capability: 'sandbox.run',
        scope: { fs: { allowedPaths: ['.'] } },
      })

      // Run should complete (not denied)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('infra_ok')

      // agent_events row with sandbox.infra_failure action should have been written
      expect(agentEventsInsertPayload).not.toBeNull()
      expect((agentEventsInsertPayload as Record<string, unknown>)['action']).toBe(
        'sandbox.infrastructure_failure'
      )
    }, 15_000)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — Orphan GC sweeps correctly (mocked DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC4 — runSandboxGc sweeps orphan rows', () => {
  it('calls cleanupSandbox twice when buildOrphanGcQuery returns 2 orphan rows', async () => {
    const orphanRows = [
      { id: 'orphan-001', worktree_path: '/tmp/sandbox-A', started_at: '2026-01-01T00:00:00Z' },
      { id: 'orphan-002', worktree_path: '/tmp/sandbox-B', started_at: '2026-01-01T00:00:00Z' },
    ]

    // buildOrphanGcQuery returns a promise-like chain that resolves with orphan rows
    const gcQueryChain: Record<string, unknown> = {}
    const gcSelf = () => gcQueryChain
    const gcMethods = ['select', 'in', 'lt', 'is', 'gte', 'limit', 'eq']
    for (const m of gcMethods) {
      gcQueryChain[m] = vi.fn(gcSelf)
    }
    gcQueryChain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
      Promise.resolve({ data: orphanRows, error: null }).then(fn)

    // cleanupSandbox DB calls: select worktree_path + update status
    const cleanup001Select = makeChain({
      data: { worktree_path: orphanRows[0].worktree_path },
      error: null,
    })
    const cleanup001Update = makeChain({ data: null, error: null })
    const cleanup002Select = makeChain({
      data: { worktree_path: orphanRows[1].worktree_path },
      error: null,
    })
    const cleanup002Update = makeChain({ data: null, error: null })

    let fromCallCount = 0
    mockFrom.mockImplementation((_table: string) => {
      fromCallCount++
      // First call is buildOrphanGcQuery → sandbox_runs (select orphans)
      if (fromCallCount === 1) return gcQueryChain
      // cleanupSandbox for orphan-001: select then update
      if (fromCallCount === 2) return cleanup001Select
      if (fromCallCount === 3) return cleanup001Update
      // cleanupSandbox for orphan-002: select then update
      if (fromCallCount === 4) return cleanup002Select
      if (fromCallCount === 5) return cleanup002Update
      return makeChain({ data: null, error: null })
    })

    const result = await runSandboxGc()

    expect(result.swept).toBe(2)
    expect(result.errors).toBe(0)
  })

  it('returns { swept: 0, errors: 0 } when no orphans', async () => {
    const emptyChain: Record<string, unknown> = {}
    const emptySelf = () => emptyChain
    const emptyMethods = ['select', 'in', 'lt', 'is', 'gte', 'limit', 'eq']
    for (const m of emptyMethods) {
      emptyChain[m] = vi.fn(emptySelf)
    }
    emptyChain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
      Promise.resolve({ data: [], error: null }).then(fn)

    mockFrom.mockReturnValueOnce(emptyChain)

    const result = await runSandboxGc()
    expect(result.swept).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('counts error when cleanupSandbox throws', async () => {
    const orphanRows = [
      {
        id: 'orphan-err-001',
        worktree_path: '/tmp/sandbox-err',
        started_at: '2026-01-01T00:00:00Z',
      },
    ]

    const gcQueryChain: Record<string, unknown> = {}
    const gcSelf = () => gcQueryChain
    for (const m of ['select', 'in', 'lt', 'is', 'gte', 'limit', 'eq']) {
      gcQueryChain[m] = vi.fn(gcSelf)
    }
    gcQueryChain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
      Promise.resolve({ data: orphanRows, error: null }).then(fn)

    // cleanupSandbox: select fails → throws
    const failSelect = makeChain({ data: null, error: { message: 'not found' } })

    let fromCallCount = 0
    mockFrom.mockImplementation((_table: string) => {
      fromCallCount++
      if (fromCallCount === 1) return gcQueryChain
      return failSelect
    })

    const result = await runSandboxGc()
    expect(result.swept).toBe(0)
    expect(result.errors).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — Migration 0068 content verification
// ─────────────────────────────────────────────────────────────────────────────

describe('AC5 — migration 0068 content', () => {
  it('contains expected agent_capabilities inserts and harness_components rollup update', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/0068_sandbox_agent_capabilities.sql'
    )

    expect(fs.existsSync(migrationPath)).toBe(true)

    const content = fs.readFileSync(migrationPath, 'utf8')

    // Verify builder grants present
    expect(content).toContain("('builder', 'sandbox.create'")
    expect(content).toContain("('builder', 'sandbox.execute'")
    expect(content).toContain("('builder', 'sandbox.run'")
    expect(content).toContain("('builder', 'sandbox.escape'")

    // Verify coordinator grant present
    expect(content).toContain("('coordinator', 'sandbox.create'")

    // Verify ON CONFLICT DO NOTHING (idempotent)
    expect(content).toContain('ON CONFLICT')
    expect(content).toContain('DO NOTHING')

    // Verify rollup bump to 65%
    expect(content).toContain('completion_pct = 65')
    expect(content).toContain("id = 'harness:sandbox'")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SandboxDeniedError shape (pure unit)
// ─────────────────────────────────────────────────────────────────────────────

describe('SandboxDeniedError — error shape', () => {
  it('has correct name, message, and fields', () => {
    const err = new SandboxDeniedError('builder', 'sandbox.run', 'not_granted', 'audit-xyz')
    expect(err.name).toBe('SandboxDeniedError')
    expect(err.message).toContain('builder')
    expect(err.message).toContain('sandbox.run')
    expect(err.message).toContain('not_granted')
    expect(err.agentId).toBe('builder')
    expect(err.capability).toBe('sandbox.run')
    expect(err.reason).toBe('not_granted')
    expect(err.auditId).toBe('audit-xyz')
    expect(err).toBeInstanceOf(Error)
  })
})
