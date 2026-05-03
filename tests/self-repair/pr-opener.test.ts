/**
 * tests/self-repair/pr-opener.test.ts
 *
 * Spec acceptance: §F (PR opener creates a GitHub PR, mocked API)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── arms-legs mock ────────────────────────────────────────────────────────────

const { mockHttpRequest, mockTelegram } = vi.hoisted(() => {
  const mockHttpRequest = vi.fn()
  const mockTelegram = vi.fn()
  return { mockHttpRequest, mockTelegram }
})

vi.mock('@/lib/harness/arms-legs', () => ({
  httpRequest: mockHttpRequest,
  telegram: mockTelegram,
}))

// ── sandbox cleanup mock ──────────────────────────────────────────────────────

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  cleanupSandbox: vi.fn().mockResolvedValue(undefined),
}))

// ── capability mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/security/capability', () => ({
  requireCapability: vi.fn().mockResolvedValue({ audit_id: 'mock-audit-pr' }),
}))

// ── child_process mock ────────────────────────────────────────────────────────

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>()
  return {
    ...original,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
      // Mock git commands
      if (typeof cb === 'function') {
        cb(null, { stdout: 'abc1234567890\n', stderr: '' })
      }
    }),
  }
})

// ── import under test (after mocks) ──────────────────────────────────────────

import { openPR } from '@/lib/harness/self-repair/pr-opener'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'single',
    'maybeSingle',
    'in',
    'gte',
    'limit',
    'order',
    'not',
    'lt',
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

const MOCK_DRAFT = {
  unifiedDiff: '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new',
  summary: 'Increases timeout.',
  rationale: 'The timeout was too short.',
  promptTokens: 1000,
  completionTokens: 200,
}

const MOCK_VERIFY = {
  passed: true,
  exitCode: 0,
  stdout: '10 tests passed',
  stderr: '',
  durationMs: 4500,
  sandboxRunId: 'sandbox-run-001',
  worktreePath: '/tmp/.claude/worktrees/sandbox-test-001',
  warnings: ['process_isolation_not_enforced'],
}

const MOCK_CTX = {
  failure: {
    eventId: 'evt-pr-001',
    actionType: 'coordinator_await_timeout',
    occurredAt: '2026-05-01T10:00:00Z',
    context: {},
    agentId: 'coordinator',
  },
  recentCommits: [],
  relevantFiles: [],
  relatedEvents: [],
}

const RUN_ID = 'test-run-id-0001'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_TOKEN = 'test-github-token'
  process.env.GITHUB_REPO_OWNER = 'loeppkyc'
  process.env.GITHUB_REPO_NAME = 'lepios'

  // Mock agent_events inserts (non-fatal)
  mockFrom.mockReturnValue(makeChain({ data: null, error: null }))
  mockTelegram.mockResolvedValue({ ok: true })
})

// ── F1: PR opener calls GitHub API correctly ──────────────────────────────────

describe('AC-F: openPR', () => {
  it('calls GitHub pulls API and returns prNumber and prUrl', async () => {
    // git push fails (no real git) → falls through to API ref-create approach
    // Then PR create succeeds
    mockHttpRequest
      // ref creation (branch)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({
          ref: 'refs/heads/self-repair/test-run-id-0001',
          object: { sha: 'abc123' },
        }),
        headers: {},
        durationMs: 100,
      })
      // PR creation
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({
          number: 42,
          html_url: 'https://github.com/loeppkyc/lepios/pull/42',
        }),
        headers: {},
        durationMs: 100,
      })

    // Use a verify result with no worktreePath to avoid git push path
    const verifyNoWorktree = { ...MOCK_VERIFY, worktreePath: '' }
    const result = await openPR(MOCK_DRAFT, verifyNoWorktree, MOCK_CTX, RUN_ID)

    expect(result.prNumber).toBe(42)
    expect(result.prUrl).toBe('https://github.com/loeppkyc/lepios/pull/42')
    expect(result.branchName).toBe(`self-repair/${RUN_ID}`)
  })

  it('PR body contains the required template sections', async () => {
    let capturedPRBody: string | undefined

    mockHttpRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({ ref: 'refs/heads/self-repair/test', object: { sha: 'abc' } }),
        headers: {},
        durationMs: 100,
      })
      .mockImplementationOnce(({ body }: { body: Record<string, unknown> }) => {
        capturedPRBody = body.body as string
        return Promise.resolve({
          ok: true,
          status: 201,
          body: JSON.stringify({
            number: 43,
            html_url: 'https://github.com/loeppkyc/lepios/pull/43',
          }),
          headers: {},
          durationMs: 100,
        })
      })

    const verifyNoWorktree = { ...MOCK_VERIFY, worktreePath: '' }
    await openPR(MOCK_DRAFT, verifyNoWorktree, MOCK_CTX, RUN_ID)

    expect(capturedPRBody).toBeDefined()
    expect(capturedPRBody).toContain('Self-repair attempt')
    expect(capturedPRBody).toContain(RUN_ID)
    expect(capturedPRBody).toContain('coordinator_await_timeout')
    expect(capturedPRBody).toContain('does NOT auto-merge')
    expect(capturedPRBody).toContain('sandbox_runs.id')
    expect(capturedPRBody).toContain('self_repair_runs.id')
  })

  it('sends a Telegram notification after opening the PR', async () => {
    mockHttpRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({ ref: 'refs/heads/self-repair/test', object: { sha: 'abc' } }),
        headers: {},
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({
          number: 44,
          html_url: 'https://github.com/loeppkyc/lepios/pull/44',
        }),
        headers: {},
        durationMs: 100,
      })

    const verifyNoWorktree = { ...MOCK_VERIFY, worktreePath: '' }
    await openPR(MOCK_DRAFT, verifyNoWorktree, MOCK_CTX, RUN_ID)

    expect(mockTelegram).toHaveBeenCalled()
    const callArgs = mockTelegram.mock.calls[0]
    expect(callArgs[0]).toContain('https://github.com/loeppkyc/lepios/pull/44')
  })

  it('throws when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN

    const verifyNoWorktree = { ...MOCK_VERIFY, worktreePath: '' }
    await expect(openPR(MOCK_DRAFT, verifyNoWorktree, MOCK_CTX, RUN_ID)).rejects.toThrow(
      'GITHUB_TOKEN not set'
    )
  })

  it('throws when GitHub API returns non-ok for PR creation', async () => {
    mockHttpRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        body: JSON.stringify({ ref: 'refs/heads/self-repair/test', object: { sha: 'abc' } }),
        headers: {},
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        body: JSON.stringify({ message: 'Validation Failed' }),
        headers: {},
        durationMs: 100,
      })

    const verifyNoWorktree = { ...MOCK_VERIFY, worktreePath: '' }
    await expect(openPR(MOCK_DRAFT, verifyNoWorktree, MOCK_CTX, RUN_ID)).rejects.toThrow(
      'Failed to open PR'
    )
  })
})
