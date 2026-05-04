/**
 * Acceptance Tests — debate_consensus Slice 1
 *
 * All 9 tests (AC-1 through AC-9) mock httpRequest from arms_legs.
 * No real Anthropic API calls are made.
 *
 * AC-1: 3 fan-out + 1 fan-in = 4 total httpRequest calls
 * AC-2: Fan-out calls use sonnet model; fan-in call uses opus model
 * AC-3: Majority parse — consensusLevel 'majority', answer non-null
 * AC-4: Split parse — answer null, splits populated
 * AC-5: Malformed JSON from checker — graceful fallback, no throw
 * AC-6: POST /api/harness/consensus — no auth → 401
 * AC-7: POST /api/harness/consensus — invalid body → 400
 * AC-8: POST /api/harness/consensus — valid → 200 with correct shape (no raw* fields)
 * AC-9: F22 compliance — requireCronSecret used, no inline process.env.CRON_SECRET check
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockHttpRequest, mockFrom } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/harness/arms-legs', () => ({
  httpRequest: mockHttpRequest,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { runConsensus } from '@/lib/harness/consensus/runner'
import { POST } from '@/app/api/harness/consensus/route'
import { requireCronSecret } from '@/lib/auth/cron-secret'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_PERSPECTIVE = `ANSWER: Yes, use strict mode.
REASONING:
- Catches type errors at compile time
- Prevents implicit any
- Required for clean code
RISKS:
- Migration effort for existing code
- Third-party type incompatibilities
CONFIDENCE: HIGH`

const FIXTURE_CONSENSUS_MAJORITY = JSON.stringify({
  consensusLevel: 'majority',
  answer: 'Yes, use TypeScript strict mode.',
  splits: ['minor point about migration cost'],
  outliers: [],
})

const FIXTURE_CONSENSUS_SPLIT = JSON.stringify({
  consensusLevel: 'split',
  answer: null,
  splits: ['A', 'B', 'C'],
  outliers: [],
})

function makeAnthropicResponse(text: string) {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    headers: {},
    durationMs: 500,
  }
}

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ error: null }) }
}

function makeRequest(body: unknown, authHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authHeader !== undefined) headers['Authorization'] = authHeader
  return new Request('http://localhost/api/harness/consensus', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  process.env.CRON_SECRET = 'test-cron-secret'
  // Default: requireCronSecret allows requests
  vi.mocked(requireCronSecret).mockReturnValue(null)
  // Default: DB insert succeeds
  mockFrom.mockReturnValue(makeInsertChain())
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CRON_SECRET
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: Three perspective calls fire in parallel, then one fan-in
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1: 3 fan-out + 1 fan-in = 4 total httpRequest calls', () => {
  it('calls httpRequest exactly 4 times', async () => {
    // All 4 calls return a valid Anthropic response
    mockHttpRequest.mockResolvedValue(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
    // Last call (fan-in) returns consensus JSON
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE)) // technical
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE)) // practical
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE)) // skeptical
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY)) // consensus

    await runConsensus('Should we use TypeScript strict mode?')

    expect(mockHttpRequest).toHaveBeenCalledTimes(4)
  })

  it('fan-in (4th call) contains all 3 perspective texts in its body', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse('TECHNICAL ANSWER'))
      .mockResolvedValueOnce(makeAnthropicResponse('PRACTICAL ANSWER'))
      .mockResolvedValueOnce(makeAnthropicResponse('SKEPTICAL ANSWER'))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    await runConsensus('Test question')

    const fourthCallBody = mockHttpRequest.mock.calls[3][0].body as Record<string, unknown>
    const userMessage = (fourthCallBody.messages as { role: string; content: string }[])[0].content
    expect(userMessage).toContain('TECHNICAL ANSWER')
    expect(userMessage).toContain('PRACTICAL ANSWER')
    expect(userMessage).toContain('SKEPTICAL ANSWER')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: Fan-out uses sonnet, fan-in uses opus
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2: model routing — sonnet for fan-out, opus for fan-in', () => {
  it('fan-out calls (1–3) use a model string containing "sonnet"', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    await runConsensus('Test prompt')

    const call1Model = (mockHttpRequest.mock.calls[0][0].body as { model: string }).model
    const call2Model = (mockHttpRequest.mock.calls[1][0].body as { model: string }).model
    const call3Model = (mockHttpRequest.mock.calls[2][0].body as { model: string }).model

    expect(call1Model).toContain('sonnet')
    expect(call2Model).toContain('sonnet')
    expect(call3Model).toContain('sonnet')
  })

  it('fan-in call (4th) uses a model string containing "opus"', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    await runConsensus('Test prompt')

    const call4Model = (mockHttpRequest.mock.calls[3][0].body as { model: string }).model
    expect(call4Model).toContain('opus')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: Majority parse — consensusLevel 'majority', answer non-null
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3: majority consensus result parsed correctly', () => {
  it('returns consensusLevel majority and non-null answer', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    const result = await runConsensus('Should we use TypeScript strict mode?')

    expect(result.consensusLevel).toBe('majority')
    expect(result.answer).toBe('Yes, use TypeScript strict mode.')
    expect(result.splits).toEqual(['minor point about migration cost'])
    expect(result.outliers).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: Split result — answer is null, splits populated
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-4: split consensus result', () => {
  it('returns answer: null and splits array when consensusLevel is split', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_SPLIT))

    const result = await runConsensus('A contested question')

    expect(result.consensusLevel).toBe('split')
    expect(result.answer).toBeNull()
    expect(result.splits.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: Malformed JSON from checker — graceful fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-5: malformed JSON from consensus checker — graceful fallback', () => {
  it('does not throw and returns consensusLevel split with parse-error indicator', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse('I cannot decide.'))

    const result = await runConsensus('A tricky question')

    expect(result.consensusLevel).toBe('split')
    expect(result.answer).toBeNull()
    expect(result.splits.some((s) => s.toLowerCase().includes('parse error'))).toBe(true)
  })

  it('does not throw even if consensus checker returns completely empty text', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(''))

    await expect(runConsensus('Question')).resolves.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: POST /api/harness/consensus — no auth → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-6: POST /api/harness/consensus — no auth → 401', () => {
  it('returns 401 when requireCronSecret rejects the request', async () => {
    const { NextResponse } = await import('next/server')
    vi.mocked(requireCronSecret).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await POST(makeRequest({ prompt: 'test' }))
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: POST /api/harness/consensus — invalid body → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-7: POST /api/harness/consensus — invalid body → 400', () => {
  it('returns 400 when prompt is a number (wrong type)', async () => {
    const res = await POST(makeRequest({ prompt: 123 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when prompt is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/harness/consensus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-8: POST /api/harness/consensus — valid → 200 with correct shape
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-8: POST /api/harness/consensus — valid → 200 with result shape', () => {
  it('returns 200 with runId, consensusLevel, answer, splits, outliers, durationMs', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    const res = await POST(makeRequest({ prompt: 'Is Option A better than Option B?' }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('runId')
    expect(body).toHaveProperty('consensusLevel')
    expect(body).toHaveProperty('answer')
    expect(body).toHaveProperty('splits')
    expect(body).toHaveProperty('outliers')
    expect(body).toHaveProperty('durationMs')
  })

  it('does NOT include rawPerspectives or rawConsensus in the response body', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_PERSPECTIVE))
      .mockResolvedValueOnce(makeAnthropicResponse(FIXTURE_CONSENSUS_MAJORITY))

    const res = await POST(makeRequest({ prompt: 'Test question' }))
    const body = (await res.json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('rawPerspectives')
    expect(body).not.toHaveProperty('rawConsensus')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-9: F22 compliance
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-9: F22 compliance — requireCronSecret pattern, no inline CRON_SECRET check', () => {
  it('route file contains requireCronSecret', () => {
    const routePath = join(process.cwd(), 'app/api/harness/consensus/route.ts')
    const source = readFileSync(routePath, 'utf-8')
    const matches = source.match(/requireCronSecret/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('route file does NOT contain process.env.CRON_SECRET (no inline auth check)', () => {
    const routePath = join(process.cwd(), 'app/api/harness/consensus/route.ts')
    const source = readFileSync(routePath, 'utf-8')
    expect(source).not.toContain('process.env.CRON_SECRET')
  })
})
