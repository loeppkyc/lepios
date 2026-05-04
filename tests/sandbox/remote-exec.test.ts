/**
 * Sandbox Slice 4 — remote-exec branch unit tests for runtime.ts
 *
 * AC-RE1: SANDBOX_EXEC_URL set + server returns success
 *   → exitCode/stdout/stderr correct
 *   → 'process_isolation_remote_docker' in warnings
 *   → 'process_isolation_not_enforced' NOT in warnings
 *
 * AC-RE2: SANDBOX_EXEC_URL unset
 *   → falls through to local spawn path
 *   → 'process_isolation_not_enforced' in warnings
 *   → 'process_isolation_remote_docker' NOT in warnings
 *
 * AC-RE3: Server returns non-OK HTTP (e.g. 503)
 *   → 'remote_exec_failed_fallback_local' in warnings
 *   → falls back to local spawn
 *
 * AC-RE4: fetch throws (network error / AbortError)
 *   → 'remote_exec_failed_fallback_local' in warnings
 *   → falls back to local spawn
 *
 * All DB calls and child_process are mocked. No real worktrees or network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

// ── fs mock — prevent real worktree creation ──────────────────────────────────

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return {
    ...real,
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

// ── child_process mock — intercept local spawn ────────────────────────────────

const { mockSpawn } = vi.hoisted(() => {
  const mockSpawn = vi.fn()
  return { mockSpawn }
})

vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>()
  return {
    ...real,
    spawn: mockSpawn,
    execFile: vi.fn((_bin: string, _args: string[], _opts: unknown, cb: Function) => {
      // execFileAsync for git commands — return success with a fake sha
      cb(null, { stdout: 'deadbeef1234\n', stderr: '' })
    }),
  }
})

// ── sandbox-contract mock — always allow ─────────────────────────────────────

vi.mock('@/lib/security/sandbox-contract', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/security/sandbox-contract')>()
  return {
    ...real,
    checkSandboxAction: vi.fn().mockResolvedValue({
      allowed: true,
      reason: 'granted',
      enforcement_mode: 'log_only',
      audit_id: 'test-audit-id',
    }),
  }
})

// ── fs-diff mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/harness/sandbox/fs-diff', () => ({
  captureFsDiff: vi.fn().mockResolvedValue({
    filesChanged: [],
    diffStat: { insertions: 0, deletions: 0, files: 0 },
    diffHash: '',
  }),
}))

// ── Import under test (after all mocks) ──────────────────────────────────────

import { runInSandbox } from '@/lib/harness/sandbox/runtime'
import { EventEmitter } from 'events'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a chainable Supabase mock that resolves to result. */
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

/** Standard 4-call mockFrom sequence for a successful runInSandbox. */
function setupDbMocks(runId = 'run-re-001', actionId = 'action-re-001') {
  mockFrom
    .mockReturnValueOnce(insertOk(runId))          // sandbox_runs INSERT
    .mockReturnValueOnce(insertOk(actionId))        // agent_actions INSERT
    .mockReturnValueOnce(makeChain({ data: null, error: null })) // sandbox_runs UPDATE (audit_action_id)
    .mockReturnValueOnce(makeChain({ data: null, error: null })) // sandbox_runs UPDATE (final)
    // Catch-all for any extra agent_events inserts
    .mockReturnValue(makeChain({ data: null, error: null }))
}

/**
 * Build a fake child_process EventEmitter that completes synchronously
 * with exitCode 0 and no output.
 */
function makeLocalSpawnChild(exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
    stdin: null
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 12345
  child.stdin = null
  // Emit close on next tick so the await resolves
  setImmediate(() => child.emit('close', exitCode))
  return child
}

const SANDBOX_OPTS = {
  agentId: 'test',
  capability: 'shell.run',
  scope: { fs: { allowedPaths: ['.'] } },
} as const

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockMonotonicNow.mockReturnValue(0)
  // Default: no remote exec env vars
  delete process.env.SANDBOX_EXEC_URL
  delete process.env.SANDBOX_EXEC_SECRET
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.SANDBOX_EXEC_URL
  delete process.env.SANDBOX_EXEC_SECRET
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-RE1 — Remote server returns success
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-RE1 — SANDBOX_EXEC_URL set + server returns success', () => {
  it('uses remote result: exitCode/stdout/stderr correct, remote_docker warning set, not_enforced removed', async () => {
    process.env.SANDBOX_EXEC_URL = 'http://localhost:8002'
    process.env.SANDBOX_EXEC_SECRET = 'test-secret-abc'

    setupDbMocks()

    const remotePayload = {
      exitCode: 0,
      stdout: 'hello from docker\n',
      stderr: '',
      timedOut: false,
      durationMs: 250,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(remotePayload),
      })
    )

    const result = await runInSandbox('echo hello', SANDBOX_OPTS)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello from docker\n')
    expect(result.stderr).toBe('')
    expect(result.timedOut).toBe(false)

    // Remote docker warning present
    expect(result.warnings).toContain('process_isolation_remote_docker')
    // Advisory warning removed when real Docker is used
    expect(result.warnings).not.toContain('process_isolation_not_enforced')
    // No fallback warning
    expect(result.warnings).not.toContain('remote_exec_failed_fallback_local')

    // Local spawn must NOT have been called
    expect(mockSpawn).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-RE2 — SANDBOX_EXEC_URL unset: falls through to local spawn
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-RE2 — SANDBOX_EXEC_URL unset: falls through to local spawn', () => {
  it('uses local spawn, process_isolation_not_enforced present, no remote warning', async () => {
    // Env vars deliberately not set
    setupDbMocks()
    mockSpawn.mockReturnValue(makeLocalSpawnChild(0))

    const result = await runInSandbox('echo hello', SANDBOX_OPTS)

    // Local spawn was used
    expect(mockSpawn).toHaveBeenCalled()

    // Standard advisory warning
    expect(result.warnings).toContain('process_isolation_not_enforced')
    // No remote warnings
    expect(result.warnings).not.toContain('process_isolation_remote_docker')
    expect(result.warnings).not.toContain('remote_exec_failed_fallback_local')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-RE3 — Server returns non-OK HTTP: fallback to local spawn
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-RE3 — server returns non-OK HTTP → fallback_local warning + local spawn', () => {
  it('adds remote_exec_failed_fallback_local and falls back when resp.ok is false', async () => {
    process.env.SANDBOX_EXEC_URL = 'http://localhost:8002'
    process.env.SANDBOX_EXEC_SECRET = 'test-secret-abc'

    setupDbMocks()
    mockSpawn.mockReturnValue(makeLocalSpawnChild(0))

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'docker_not_available' }),
      })
    )

    const result = await runInSandbox('echo hello', SANDBOX_OPTS)

    expect(result.warnings).toContain('remote_exec_failed_fallback_local')
    expect(result.warnings).toContain('process_isolation_not_enforced')
    expect(result.warnings).not.toContain('process_isolation_remote_docker')
    // Local spawn was used as fallback
    expect(mockSpawn).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-RE4 — fetch throws (network error / abort): fallback to local spawn
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-RE4 — fetch throws → fallback_local warning + local spawn', () => {
  it('adds remote_exec_failed_fallback_local and falls back when fetch rejects', async () => {
    process.env.SANDBOX_EXEC_URL = 'http://localhost:8002'
    process.env.SANDBOX_EXEC_SECRET = 'test-secret-abc'

    setupDbMocks()
    mockSpawn.mockReturnValue(makeLocalSpawnChild(0))

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('network unreachable'))
    )

    const result = await runInSandbox('echo hello', SANDBOX_OPTS)

    expect(result.warnings).toContain('remote_exec_failed_fallback_local')
    expect(result.warnings).toContain('process_isolation_not_enforced')
    expect(result.warnings).not.toContain('process_isolation_remote_docker')
    // Local spawn was used as fallback
    expect(mockSpawn).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('adds remote_exec_failed_fallback_local and falls back when fetch throws AbortError', async () => {
    process.env.SANDBOX_EXEC_URL = 'http://localhost:8002'
    process.env.SANDBOX_EXEC_SECRET = 'test-secret-abc'

    setupDbMocks()
    mockSpawn.mockReturnValue(makeLocalSpawnChild(0))

    const abortErr = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(abortErr))

    const result = await runInSandbox('echo hello', SANDBOX_OPTS)

    expect(result.warnings).toContain('remote_exec_failed_fallback_local')
    expect(mockSpawn).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
