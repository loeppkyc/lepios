/**
 * tests/self-repair/verifier.test.ts
 *
 * Spec acceptance: §E (verifier round-trips pass/fail honestly)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── sandbox mock ──────────────────────────────────────────────────────────────

const { mockRunInSandbox, mockCleanupSandbox } = vi.hoisted(() => {
  const mockRunInSandbox = vi.fn()
  const mockCleanupSandbox = vi.fn()
  return { mockRunInSandbox, mockCleanupSandbox }
})

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: mockRunInSandbox,
  cleanupSandbox: mockCleanupSandbox,
}))

// ── import under test (after mocks) ──────────────────────────────────────────

import { verifyDraft } from '@/lib/harness/self-repair/verifier'

// ── helpers ───────────────────────────────────────────────────────────────────

const MOCK_CONTEXT = {
  failure: {
    eventId: 'evt-verifier-001',
    actionType: 'coordinator_await_timeout',
    occurredAt: '2026-05-01T10:00:00Z',
    context: {},
    agentId: 'coordinator',
  },
  recentCommits: [],
  relevantFiles: [],
  relatedEvents: [],
}

const VALID_DRAFT = {
  unifiedDiff: `--- a/lib/harness/invoke-coordinator.ts
+++ b/lib/harness/invoke-coordinator.ts
@@ -1 +1 @@
-const TIMEOUT = 30000;
+const TIMEOUT = 60000;`,
  summary: 'Increase timeout',
  rationale: 'Too tight',
  promptTokens: 100,
  completionTokens: 50,
}

const EMPTY_DRAFT = {
  unifiedDiff: '',
  summary: 'No fix found',
  rationale: 'Could not determine fix',
  promptTokens: 100,
  completionTokens: 20,
}

const SUCCESS_SANDBOX = {
  sandboxId: 'self_repair:sandbox-test-001',
  worktreePath: '/tmp/.claude/worktrees/sandbox-test-001',
  exitCode: 0,
  stdout: '10 tests passed',
  stderr: '',
  timedOut: false,
  durationMs: 5000,
  filesChanged: ['lib/harness/invoke-coordinator.ts'],
  diffStat: { insertions: 1, deletions: 1, files: 1 },
  diffHash: 'abc123',
  runId: 'run-sandbox-001',
  warnings: ['process_isolation_not_enforced'],
}

const FAIL_SANDBOX = {
  ...SUCCESS_SANDBOX,
  exitCode: 1,
  stdout: '9 tests passed, 1 failed',
  stderr: 'AssertionError: expected 30000 to be 60000',
}

const TIMEOUT_SANDBOX = {
  ...SUCCESS_SANDBOX,
  exitCode: null,
  timedOut: true,
  stdout: '',
  stderr: 'Process killed after 180000ms',
  durationMs: 180001,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── E1: pass case ─────────────────────────────────────────────────────────────

describe('AC-E: verifyDraft', () => {
  it('returns passed=true when sandbox exits with code 0', async () => {
    mockRunInSandbox.mockResolvedValueOnce(SUCCESS_SANDBOX)

    const result = await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(result.passed).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.sandboxRunId).toBe('run-sandbox-001')
    expect(result.worktreePath).toBe(SUCCESS_SANDBOX.worktreePath)
  })

  it('returns passed=false when sandbox exits with non-zero code', async () => {
    mockRunInSandbox.mockResolvedValueOnce(FAIL_SANDBOX)

    const result = await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(result.passed).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('AssertionError')
  })

  it('returns passed=false on timeout (exitCode null, timedOut true)', async () => {
    mockRunInSandbox.mockResolvedValueOnce(TIMEOUT_SANDBOX)

    const result = await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(result.passed).toBe(false)
    expect(result.exitCode).toBeNull()
  })

  it('mirrors sandbox warnings verbatim to VerifyResult.warnings', async () => {
    const warningsSandbox = {
      ...SUCCESS_SANDBOX,
      warnings: ['process_isolation_not_enforced', 'net_isolation_not_enforced'],
    }
    mockRunInSandbox.mockResolvedValueOnce(warningsSandbox)

    const result = await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(result.warnings).toContain('process_isolation_not_enforced')
    expect(result.warnings).toContain('net_isolation_not_enforced')
  })

  it('returns passed=false immediately for empty unifiedDiff without calling sandbox', async () => {
    const result = await verifyDraft(EMPTY_DRAFT, MOCK_CONTEXT)

    expect(result.passed).toBe(false)
    expect(result.stderr).toContain('empty unifiedDiff')
    expect(mockRunInSandbox).not.toHaveBeenCalled()
  })

  it('returns passed=false with sandbox_run_threw warning when runInSandbox throws', async () => {
    mockRunInSandbox.mockRejectedValueOnce(new Error('git worktree failed'))

    const result = await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(result.passed).toBe(false)
    expect(result.warnings).toContain('sandbox_run_threw')
    expect(result.stderr).toContain('sandbox error')
  })
})

// ── E2: no write to main workspace ───────────────────────────────────────────

describe('AC-E: no main workspace write', () => {
  it('runInSandbox is called with agentId=self_repair and capability=sandbox.run', async () => {
    mockRunInSandbox.mockResolvedValueOnce(SUCCESS_SANDBOX)

    await verifyDraft(VALID_DRAFT, MOCK_CONTEXT)

    expect(mockRunInSandbox).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        agentId: 'self_repair',
        capability: 'sandbox.run',
      })
    )
  })
})
