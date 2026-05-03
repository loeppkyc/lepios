/**
 * tests/self-repair/drafter.test.ts
 *
 * Spec acceptance: §D (drafter produces valid unified diff, mock LLM)
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

// ── httpRequest mock ──────────────────────────────────────────────────────────

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
  requireCapability: vi.fn().mockResolvedValue({ audit_id: 'mock-audit-id-drafter' }),
}))

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
  ]
  const self = () => chain
  for (const m of methods) chain[m] = vi.fn(self)
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => Promise.resolve(result).then(fn)
  return chain
}

const MOCK_CONTEXT = {
  failure: {
    eventId: 'evt-drafter-001',
    actionType: 'coordinator_await_timeout',
    occurredAt: '2026-05-01T10:00:00Z',
    context: { timeout_ms: 30000 },
    agentId: 'coordinator',
  },
  recentCommits: [
    {
      sha: 'abc12345',
      subject: 'fix: update timeout handler',
      files: ['lib/harness/invoke-coordinator.ts'],
    },
  ],
  relevantFiles: [
    {
      path: 'lib/harness/invoke-coordinator.ts',
      content: 'export async function invokeCoordinator() { await sleep(30000); }',
    },
  ],
  relatedEvents: [],
}

const VALID_DIFF = `--- a/lib/harness/invoke-coordinator.ts
+++ b/lib/harness/invoke-coordinator.ts
@@ -1,3 +1,3 @@
 export async function invokeCoordinator() {
-  await sleep(30000);
+  await sleep(60000);
 }`

const MOCK_LLM_RESPONSE = {
  ok: true,
  status: 200,
  body: JSON.stringify({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          unifiedDiff: VALID_DIFF,
          summary:
            'Increases the coordinator await timeout from 30s to 60s to prevent premature timeouts.',
          rationale:
            'The coordinator_await_timeout events suggest the 30s window is too short for current task complexity.',
        }),
      },
    ],
    usage: { input_tokens: 1500, output_tokens: 300 },
  }),
  headers: {},
  durationMs: 800,
}

// ── import under test (after mocks) ──────────────────────────────────────────

import { draftFix } from '@/lib/harness/self-repair/drafter'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-api-key'
  // Mock the agent_events insert (non-fatal)
  mockFrom.mockReturnValue(makeChain({ data: null, error: null }))
})

// ── D1: draftFix returns valid DraftedFix ────────────────────────────────────

describe('AC-D: draftFix', () => {
  it('returns a DraftedFix with non-empty fields when LLM responds correctly', async () => {
    mockHttpRequest.mockResolvedValueOnce(MOCK_LLM_RESPONSE)

    const result = await draftFix(MOCK_CONTEXT)

    expect(result).not.toBeNull()
    expect(result!.unifiedDiff).toBe(VALID_DIFF)
    expect(result!.summary).toContain('timeout')
    expect(result!.rationale).toContain('coordinator')
    expect(result!.promptTokens).toBe(1500)
    expect(result!.completionTokens).toBe(300)
  })

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const result = await draftFix(MOCK_CONTEXT)
    expect(result).toBeNull()
  })

  it('returns null when httpRequest fails (HTTP error)', async () => {
    mockHttpRequest.mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: '{"error":"service unavailable"}',
      headers: {},
      durationMs: 100,
    })

    const result = await draftFix(MOCK_CONTEXT)
    expect(result).toBeNull()
  })

  it('returns null when LLM returns invalid JSON', async () => {
    mockHttpRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'this is not json {{{' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      headers: {},
      durationMs: 200,
    })

    const result = await draftFix(MOCK_CONTEXT)
    expect(result).toBeNull()
  })

  it('returns null when LLM JSON is missing required fields', async () => {
    mockHttpRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ unifiedDiff: VALID_DIFF }), // missing summary and rationale
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      headers: {},
      durationMs: 200,
    })

    const result = await draftFix(MOCK_CONTEXT)
    expect(result).toBeNull()
  })

  it('handles LLM response with markdown code fences around JSON', async () => {
    mockHttpRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        content: [
          {
            type: 'text',
            text:
              '```json\n' +
              JSON.stringify({
                unifiedDiff: VALID_DIFF,
                summary: 'A summary.',
                rationale: 'A rationale.',
              }) +
              '\n```',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      headers: {},
      durationMs: 200,
    })

    const result = await draftFix(MOCK_CONTEXT)
    expect(result).not.toBeNull()
    expect(result!.unifiedDiff).toBe(VALID_DIFF)
  })
})
