/**
 * Unit tests for lib/harness/safety/index.ts (orchestrator).
 *
 * Spec: docs/specs/safety-agent.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerate, MockOllamaUnreachable } = vi.hoisted(() => {
  class MockOllamaUnreachable extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'OllamaUnreachableError'
    }
  }
  return { mockGenerate: vi.fn(), MockOllamaUnreachable }
})

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/ollama/client', () => ({
  generate: mockGenerate,
  OllamaUnreachableError: MockOllamaUnreachable,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { runSafetyCheck } from '@/lib/harness/safety'

beforeEach(() => {
  mockGenerate.mockReset()
  mockFrom.mockReset()
})

function approvalChain(insertedRows: Record<string, unknown>[]) {
  // Default mock: requestApproval inserts + selects single, sendApprovalCard inserts
  return mockFrom.mockImplementation(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {}
    c.insert = (row: Record<string, unknown>) => {
      insertedRows.push(row)
      c.select = () => ({ single: () => Promise.resolve({ data: { id: 'approval-uuid' }, error: null }) })
      // For sendApprovalCard, .insert directly returns Promise — provide a then
      c.then = (resolve: (v: unknown) => unknown) => resolve({ error: null })
      return c
    }
    return c
  })
}

describe('runSafetyCheck — staticOnly path (pre-commit hook)', () => {
  it('approves immediately when static check passes', async () => {
    const r = await runSafetyCheck({
      context: 'pre-commit',
      proposedAction: { diff: '+const a = 1' },
      requestedBy: 'pre-commit-hook',
      staticOnly: true,
    })
    expect(r.decision).toBe('approved_immediately')
    expect(r.worstSeverity).toBe('pass')
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('approves immediately on warn (still allowed in fast path)', async () => {
    const r = await runSafetyCheck({
      context: 'pre-commit',
      proposedAction: { diff: '+const x = process.env.GITHUB_TOKEN' },
      requestedBy: 'pre-commit-hook',
      staticOnly: true,
    })
    expect(r.decision).toBe('approved_immediately')
    expect(r.worstSeverity).toBe('warn')
  })

  it('rejects on block in fast path (pre-commit fails)', async () => {
    const r = await runSafetyCheck({
      context: 'pre-commit',
      proposedAction: { sql: 'DROP TABLE conversations;' },
      requestedBy: 'pre-commit-hook',
      staticOnly: true,
    })
    expect(r.decision).toBe('rejected')
    expect(r.worstSeverity).toBe('block')
    expect(r.rationale).toContain('static check blocked')
  })
})

describe('runSafetyCheck — full orchestrator (Coordinator/Builder path)', () => {
  it('approves without LLM when static passes AND no review-path match', async () => {
    const r = await runSafetyCheck({
      context: 'builder hand-off',
      proposedAction: { diff: '+const a = 1' },
      filePaths: ['lib/orb/file-upload.ts'], // not a review-recommended path
      requestedBy: 'builder',
    })
    expect(r.decision).toBe('approved_immediately')
    expect(r.worstSeverity).toBe('pass')
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('runs LLM when filePaths match review-recommended (app/api/) even on pass', async () => {
    mockGenerate.mockResolvedValue({ text: 'PASS\nNothing concerning.' })
    const r = await runSafetyCheck({
      context: 'builder hand-off',
      proposedAction: { diff: '+const a = 1' },
      filePaths: ['app/api/chat/route.ts'],
      requestedBy: 'builder',
    })
    expect(r.decision).toBe('approved_immediately')
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('queues approval when static returns warn', async () => {
    mockGenerate.mockResolvedValue({ text: 'WARN\nALTER on RLS table.' })
    const inserted: Record<string, unknown>[] = []
    approvalChain(inserted)

    const r = await runSafetyCheck({
      context: 'coordinator change',
      proposedAction: { sql: 'ALTER TABLE harness_config ADD COLUMN x int;' },
      requestedBy: 'coordinator',
    })
    expect(r.decision).toBe('pending_human_review')
    expect(r.approvalId).toBe('approval-uuid')
    expect(r.worstSeverity).toBe('warn')

    // Both requestApproval (agent_events insert) and sendApprovalCard
    // (outbound_notifications insert) should have queued
    expect(inserted.length).toBeGreaterThanOrEqual(2)
    expect(inserted.find((r) => r.action === 'safety.review.requested')).toBeDefined()
    expect(inserted.find((r) => r.channel === 'telegram')).toBeDefined()
  })

  it('queues approval when static returns block', async () => {
    mockGenerate.mockResolvedValue({ text: 'BLOCK\nDROP TABLE removes all data.' })
    const inserted: Record<string, unknown>[] = []
    approvalChain(inserted)

    const r = await runSafetyCheck({
      context: 'builder pre-commit',
      proposedAction: { sql: 'DROP TABLE conversations;' },
      requestedBy: 'builder',
    })
    expect(r.decision).toBe('pending_human_review')
    expect(r.worstSeverity).toBe('block')
  })

  it('rejected when approval queueing itself fails', async () => {
    mockGenerate.mockResolvedValue({ text: 'BLOCK\nbad' })
    mockFrom.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {}
      c.insert = () => {
        c.select = () => ({ single: () => Promise.resolve({ data: null, error: { message: 'rls denied' } }) })
        return c
      }
      return c
    })

    const r = await runSafetyCheck({
      context: 'x',
      proposedAction: { sql: 'DROP TABLE x;' },
      requestedBy: 'builder',
    })
    expect(r.decision).toBe('rejected')
    expect(r.rationale).toContain('approval queue failed')
  })

  it('LLM unreachable propagates as block (fail-closed)', async () => {
    mockGenerate.mockRejectedValue(new MockOllamaUnreachable('connect ECONNREFUSED'))
    const inserted: Record<string, unknown>[] = []
    approvalChain(inserted)

    const r = await runSafetyCheck({
      context: 'builder hand-off',
      proposedAction: { diff: '+const x = 1' },
      filePaths: ['app/api/chat/route.ts'], // forces LLM
      requestedBy: 'builder',
    })
    expect(r.decision).toBe('pending_human_review')
    expect(r.worstSeverity).toBe('block')
    expect(r.llmResult?.rationale).toContain('ollama unreachable')
  })
})
