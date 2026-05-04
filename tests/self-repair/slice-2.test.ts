/**
 * tests/self-repair/slice-2.test.ts
 *
 * Acceptance criteria for Self-Repair Slice 2:
 *   AC-1 through AC-9 — webhook receiver + lint drafter special-case + detector watchlist.
 *
 * All external dependencies mocked: GitHub API, Supabase, runInSandbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── runInSandbox mock ─────────────────────────────────────────────────────────

const { mockRunInSandbox } = vi.hoisted(() => {
  const mockRunInSandbox = vi.fn()
  return { mockRunInSandbox }
})

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: mockRunInSandbox,
  cleanupSandbox: vi.fn().mockResolvedValue(undefined),
}))

// ── httpRequest mock (for drafter LLM path) ───────────────────────────────────

const { mockHttpRequest } = vi.hoisted(() => {
  const mockHttpRequest = vi.fn()
  return { mockHttpRequest }
})

vi.mock('@/lib/harness/arms-legs', () => ({
  httpRequest: mockHttpRequest,
  telegram: vi.fn().mockResolvedValue({ ok: true }),
}))

// ── capability mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/security/capability', () => ({
  requireCapability: vi.fn().mockResolvedValue({ audit_id: 'mock-audit-id' }),
}))

// ── chain builder for Supabase ────────────────────────────────────────────────

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
    'lt',
    'is',
    'gte',
    'lte',
    'limit',
    'order',
    'not',
    'neq',
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

// ── imports under test (after mocks) ─────────────────────────────────────────

import { POST } from '@/app/api/webhooks/github-actions/route'
import { draftFix } from '@/lib/harness/self-repair/drafter'
import { detectNextFailure, releaseDetectorLock } from '@/lib/harness/self-repair/detector'

// ── HMAC helper ───────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-webhook-secret'

function signBody(body: string, secret = TEST_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: string, signature: string | null, eventType = 'workflow_run') {
  const headers = new Headers()
  headers.set('content-type', 'application/json')
  if (signature !== null) {
    headers.set('x-hub-signature-256', signature)
  }
  headers.set('x-github-event', eventType)
  return new Request('http://localhost/api/webhooks/github-actions', {
    method: 'POST',
    headers,
    body,
  }) as unknown as Parameters<typeof POST>[0]
}

// ── Workflow run payload builders ─────────────────────────────────────────────

function makeWorkflowRunPayload(opts: { name: string; conclusion: string; action?: string }) {
  return JSON.stringify({
    action: opts.action ?? 'completed',
    workflow_run: {
      id: 123456,
      name: opts.name,
      head_branch: 'main',
      head_sha: 'abc123def456',
      html_url: 'https://github.com/loeppkyc/lepios/actions/runs/123456',
      conclusion: opts.conclusion,
      updated_at: '2026-05-03T10:00:00Z',
    },
  })
}

// ── Test context for draftFix ─────────────────────────────────────────────────

const LINT_CONTEXT = {
  failure: {
    eventId: 'evt-lint-001',
    actionType: 'lint_failed',
    occurredAt: '2026-05-03T10:00:00Z',
    context: {},
    agentId: 'github/actions',
  },
  recentCommits: [],
  relevantFiles: [],
  relatedEvents: [],
}

const DEPLOY_CONTEXT = {
  failure: {
    eventId: 'evt-deploy-001',
    actionType: 'deploy_failed',
    occurredAt: '2026-05-03T10:00:00Z',
    context: {},
    agentId: 'github/actions',
  },
  recentCommits: [],
  relevantFiles: [],
  relatedEvents: [],
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET
  process.env.ANTHROPIC_API_KEY = 'test-api-key'
  mockFrom.mockReturnValue(makeChain({ data: null, error: null }))
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: Webhook rejects missing signature → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1: Webhook rejects missing X-Hub-Signature-256 header', () => {
  it('returns 401 when no signature header is present', async () => {
    const body = makeWorkflowRunPayload({ name: 'Deploy', conclusion: 'failure' })
    const req = makeRequest(body, null)
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_signature')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: Webhook rejects bad signature → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2: Webhook rejects invalid signature', () => {
  it('returns 401 when signature is wrong', async () => {
    const body = makeWorkflowRunPayload({ name: 'Deploy', conclusion: 'failure' })
    const req = makeRequest(body, 'sha256=deadbeef')
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_signature')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: Webhook ignores success events → 200 skipped
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3: Webhook ignores non-failure workflow events', () => {
  it('returns 200 with skipped:true for conclusion=success', async () => {
    const body = makeWorkflowRunPayload({ name: 'Deploy to Vercel', conclusion: 'success' })
    const req = makeRequest(body, signBody(body))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; skipped: boolean }
    expect(json.ok).toBe(true)
    expect(json.skipped).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: Webhook ignores non-workflow_run events → 200 skipped
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-4: Webhook ignores non-workflow_run event types', () => {
  it('returns 200 with skipped:true for push event payload', async () => {
    // A push event doesn't have the workflow_run structure
    const body = JSON.stringify({ ref: 'refs/heads/main', pusher: { name: 'colin' } })
    const req = makeRequest(body, signBody(body), 'push')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; skipped: boolean }
    expect(json.ok).toBe(true)
    expect(json.skipped).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: Workflow named "Deploy" → deploy_failed agent_events row
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-5: Deploy workflow failure → deploy_failed event', () => {
  it('inserts agent_events row with action=deploy_failed for Deploy workflow', async () => {
    const insertMock = vi.fn(() => makeChain({ data: null, error: null }))
    mockFrom.mockReturnValue({ ...makeChain({ data: null, error: null }), insert: insertMock })

    const body = makeWorkflowRunPayload({ name: 'Deploy to Vercel', conclusion: 'failure' })
    const req = makeRequest(body, signBody(body))
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)
    expect(insertMock).toHaveBeenCalledOnce()
    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.action).toBe('deploy_failed')
    expect(insertArg.domain).toBe('github_actions')
    expect(insertArg.status).toBe('error')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: Workflow named "Lint" → lint_failed agent_events row
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-6: Lint workflow failure → lint_failed event', () => {
  it('inserts agent_events row with action=lint_failed for Lint workflow', async () => {
    const insertMock = vi.fn(() => makeChain({ data: null, error: null }))
    mockFrom.mockReturnValue({ ...makeChain({ data: null, error: null }), insert: insertMock })

    const body = makeWorkflowRunPayload({ name: 'Lint and Format Check', conclusion: 'failure' })
    const req = makeRequest(body, signBody(body))
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(insertMock).toHaveBeenCalledOnce()
    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.action).toBe('lint_failed')
    expect(insertArg.domain).toBe('github_actions')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: Lint drafter skips Claude API
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-7: draftFix with lint_failed skips Claude API', () => {
  it('calls runInSandbox and returns DraftedFix without calling httpRequest', async () => {
    mockRunInSandbox.mockResolvedValueOnce({
      runId: 'sandbox-run-001',
      worktreePath: '/tmp/worktrees/sandbox-001',
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 3000,
      filesChanged: ['src/foo.ts'],
      diffStat: { insertions: 2, deletions: 2, files: 1 },
      diffHash: 'abc123',
      sandboxId: 'self_repair:sandbox-001',
      warnings: [],
    })

    const result = await draftFix(LINT_CONTEXT)

    // Claude API must NOT be called
    expect(mockHttpRequest).not.toHaveBeenCalled()
    // Result must be non-null with filesChanged
    expect(result).not.toBeNull()
    expect(result!.filesChanged).toEqual(['src/foo.ts'])
    expect(result!.sandboxRunId).toBe('sandbox-run-001')
    expect(result!.worktreePath).toBe('/tmp/worktrees/sandbox-001')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-8: Lint drafter returns null when formatter changes nothing
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-8: Lint drafter returns null when formatter has no changes', () => {
  it('returns null when runInSandbox filesChanged is empty', async () => {
    mockRunInSandbox.mockResolvedValueOnce({
      runId: 'sandbox-run-002',
      worktreePath: '/tmp/worktrees/sandbox-002',
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 2000,
      filesChanged: [],
      diffStat: { insertions: 0, deletions: 0, files: 0 },
      diffHash: '',
      sandboxId: 'self_repair:sandbox-002',
      warnings: [],
    })

    const result = await draftFix(LINT_CONTEXT)

    expect(result).toBeNull()
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-9: deploy_failed and lint_failed are in the detector's watchlist query
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-9: detectNextFailure uses watchlist including new action types', () => {
  it('includes deploy_failed and lint_failed in its watchlist query', async () => {
    // Mock watchlist returning all 3 rows
    const ALL_WATCHLIST = [
      { action_type: 'coordinator_await_timeout' },
      { action_type: 'deploy_failed' },
      { action_type: 'lint_failed' },
    ]

    let capturedInArgs: string[] = []

    // Build a capturing chain for the agent_events query (the 5th mockFrom call).
    // The .in() on this chain captures action types passed to the watchlist filter.
    function makeCaptureChain(result: unknown) {
      const chain: Record<string, unknown> = {}
      const methods = [
        'select',
        'insert',
        'update',
        'eq',
        'single',
        'maybeSingle',
        'lt',
        'is',
        'gte',
        'lte',
        'limit',
        'order',
        'not',
        'neq',
      ]
      const self = () => chain
      for (const m of methods) chain[m] = vi.fn(self)
      chain['in'] = vi.fn((_col: string, vals: string[]) => {
        capturedInArgs = [...vals]
        return chain
      })
      chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
        Promise.resolve(result).then(fn)
      return chain
    }

    // Detector call sequence:
    // 1. from('self_repair_watchlist').select().eq('enabled', true) → ALL_WATCHLIST
    // 2. from('self_repair_runs') K2 check for coordinator_await_timeout → []
    // 3. from('self_repair_runs') K2 check for deploy_failed → []
    // 4. from('self_repair_runs') K2 check for lint_failed → []
    // 5. from('self_repair_watchlist') reload → ALL_WATCHLIST (after K2 suspensions)
    // 6. from('agent_events').select().in('action', activeTypes)... → [] (capture here)
    mockFrom
      .mockReturnValueOnce(makeChain({ data: ALL_WATCHLIST, error: null })) // 1. watchlist
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // 2. K2 coordinator
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // 3. K2 deploy
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // 4. K2 lint
      .mockReturnValueOnce(makeChain({ data: ALL_WATCHLIST, error: null })) // 5. reload watchlist
      .mockReturnValueOnce(makeCaptureChain({ data: [], error: null })) // 6. agent_events

    await detectNextFailure()

    // The .in('action', [...]) call should include all 3 watchlist types
    expect(capturedInArgs).toContain('deploy_failed')
    expect(capturedInArgs).toContain('lint_failed')
    expect(capturedInArgs).toContain('coordinator_await_timeout')

    // Clean up locks
    await releaseDetectorLock('coordinator_await_timeout')
    await releaseDetectorLock('deploy_failed')
    await releaseDetectorLock('lint_failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Additional: deploy_failed goes through LLM path (not lint bypass)
// ─────────────────────────────────────────────────────────────────────────────

describe('deploy_failed uses LLM path', () => {
  it('calls httpRequest (LLM) for deploy_failed — does not hit sandbox', async () => {
    mockHttpRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              unifiedDiff: '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new',
              summary: 'A summary.',
              rationale: 'A rationale.',
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      headers: {},
      durationMs: 500,
    })

    const result = await draftFix(DEPLOY_CONTEXT)

    expect(result).not.toBeNull()
    expect(mockHttpRequest).toHaveBeenCalledOnce()
    expect(mockRunInSandbox).not.toHaveBeenCalled()
  })
})
