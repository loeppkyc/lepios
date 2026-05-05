/**
 * Unit tests for POST /api/twin/teach.
 * Covers: auth gate, validation, happy path, source_event_id propagation,
 * title truncation, DB error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: vi.fn(() => null),
}))

vi.mock('@/lib/knowledge/client', () => ({
  saveKnowledge: vi.fn(),
  logEvent: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/twin/teach/route'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { saveKnowledge } from '@/lib/knowledge/client'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/twin/teach', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer test-secret',
    },
    body: JSON.stringify(body),
  })
}

function makeUpdateChain() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn().mockReturnValue({ eq })
  return { update, eq }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCronSecret).mockReturnValue(null)
  vi.mocked(saveKnowledge).mockResolvedValue('abc-123-uuid')
  // Default: every from() call returns a working update chain
  mockFrom.mockImplementation(() => makeUpdateChain())
})

describe('POST /api/twin/teach', () => {
  it('AC-1: returns 200 with knowledge_id on valid request', async () => {
    const res = await POST(
      makeRequest({ question: 'How does Colin handle X?', answer: 'He does Y because Z.' })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ knowledge_id: 'abc-123-uuid' })

    expect(saveKnowledge).toHaveBeenCalledWith(
      'principle',
      'twin',
      'How does Colin handle X?',
      expect.objectContaining({
        problem: 'How does Colin handle X?',
        solution: 'He does Y because Z.',
        context: 'Captured from twin escalation; taught by Colin via /api/twin/teach',
        entity: 'twin-teach',
        confidence: 0.85,
        sourceEvents: undefined,
      })
    )
  })

  it('AC-2: returns 401 when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    vi.mocked(requireCronSecret).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(makeRequest({ question: 'q', answer: 'a' }))
    expect(res.status).toBe(401)
    expect(saveKnowledge).not.toHaveBeenCalled()
  })

  it('AC-3: returns 400 on missing question', async () => {
    const res = await POST(makeRequest({ answer: 'a' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('question is required')
    expect(saveKnowledge).not.toHaveBeenCalled()
  })

  it('AC-4: returns 400 on missing answer', async () => {
    const res = await POST(makeRequest({ question: 'q' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('answer is required')
    expect(saveKnowledge).not.toHaveBeenCalled()
  })

  it('AC-5: returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/twin/teach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-secret' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid JSON body')
  })

  it('AC-6: returns 500 when saveKnowledge returns null', async () => {
    vi.mocked(saveKnowledge).mockResolvedValue(null)
    const res = await POST(makeRequest({ question: 'q', answer: 'a' }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('failed to save knowledge')
  })

  it('AC-7: source_event_id propagates to saveKnowledge.sourceEvents', async () => {
    await POST(makeRequest({ question: 'q', answer: 'a', source_event_id: 'event-uuid-123' }))
    expect(saveKnowledge).toHaveBeenCalledWith(
      'principle',
      'twin',
      'q',
      expect.objectContaining({ sourceEvents: ['event-uuid-123'] })
    )
  })

  it('AC-8: title truncates when question >100 chars', async () => {
    const longQuestion = 'q'.repeat(200)
    await POST(makeRequest({ question: longQuestion, answer: 'a' }))
    const titleArg = vi.mocked(saveKnowledge).mock.calls[0][2]
    expect(titleArg).toHaveLength(100)
    expect(titleArg.endsWith('...')).toBe(true)
  })

  it('trims whitespace from question and answer', async () => {
    await POST(makeRequest({ question: '   ', answer: '   ' }))
    // After trim, both are empty — should hit "question is required" first
    const res = await POST(makeRequest({ question: '   ', answer: '   ' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('question is required')
  })

  // ── Slice 2: escalation linkage ─────────────────────────────────────────────

  it('AC-Slice2-1: when escalation_id provided + save succeeds, escalation row is updated', async () => {
    const chain = makeUpdateChain()
    mockFrom.mockReturnValueOnce(chain)

    const res = await POST(
      makeRequest({
        question: 'q',
        answer: 'a',
        escalation_id: 'esc-1',
      })
    )

    expect(res.status).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith('twin_escalations')
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'answered',
        knowledge_id: 'abc-123-uuid',
        answer: 'a',
      })
    )
    // answered_at must be an ISO string from new Date().toISOString()
    const updateArg = chain.update.mock.calls[0][0]
    expect(typeof updateArg.answered_at).toBe('string')
    expect(updateArg.answered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(chain.eq).toHaveBeenCalledWith('id', 'esc-1')
  })

  it('AC-Slice2-2: when escalation_id absent, no twin_escalations call fires', async () => {
    await POST(makeRequest({ question: 'q', answer: 'a' }))
    expect(mockFrom).not.toHaveBeenCalledWith('twin_escalations')
  })

  it('AC-Slice2-3: linkage failure does not fail the response', async () => {
    // saveKnowledge succeeds but update throws
    mockFrom.mockImplementationOnce(() => {
      throw new Error('db boom')
    })

    const res = await POST(makeRequest({ question: 'q', answer: 'a', escalation_id: 'esc-2' }))

    // Knowledge row was saved → still 200
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.knowledge_id).toBe('abc-123-uuid')
  })
})
