/**
 * tests/harness/safety/v2/gate-adapter.test.ts
 *
 * Verifies that runSafetyGateCheck() writes a safety_decisions row even when
 * the diff fetch fails (missing GITHUB_TOKEN, API error, or exception).
 * Root cause: gate-adapter previously returned sdId: null without writing any
 * row, causing 0 rows in safety_decisions for all of Sprint 5.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock persistSafetyDecision so we can assert it was called without a real DB.
// runSafetyDecision is NOT called on the infra-error path, so we spread actual.
vi.mock('@/lib/harness/safety/v2/driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/harness/safety/v2/driver')>()
  return {
    ...actual,
    persistSafetyDecision: vi.fn().mockResolvedValue('sd-infra-test-001'),
  }
})

// Needed to prevent failures-pattern signal from trying real DB
vi.mock('@/lib/failures/log', () => ({
  logFailure: vi.fn().mockResolvedValue({ ok: true }),
}))

import { runSafetyGateCheck } from '@/lib/harness/safety/v2/gate-adapter'
import { persistSafetyDecision } from '@/lib/harness/safety/v2/driver'

const savedToken = process.env.GITHUB_TOKEN

beforeEach(() => {
  delete process.env.GITHUB_TOKEN
  vi.mocked(persistSafetyDecision).mockClear()
  vi.mocked(persistSafetyDecision).mockResolvedValue('sd-infra-test-001')
})

afterEach(() => {
  if (savedToken !== undefined) {
    process.env.GITHUB_TOKEN = savedToken
  } else {
    delete process.env.GITHUB_TOKEN
  }
})

describe('runSafetyGateCheck — no GITHUB_TOKEN (infra_error:config)', () => {
  it('returns non-blocking with action auto_merge', async () => {
    const gate = await runSafetyGateCheck({
      commit_sha: 'abc001',
      branch: 'feat/test',
      task_id: 'task-aaa',
      results: [],
    })
    expect(gate.blocking).toBe(false)
    expect(gate.action).toBe('auto_merge')
    expect(gate.tier).toBe('low')
    expect(gate.infra_error).toBe('config')
  })

  it('writes a safety_decisions row with infra_error reason', async () => {
    const results: string[] = []
    const gate = await runSafetyGateCheck({
      commit_sha: 'abc002',
      branch: 'feat/test',
      task_id: 'task-bbb',
      results,
    })
    expect(persistSafetyDecision).toHaveBeenCalledOnce()
    const arg = vi.mocked(persistSafetyDecision).mock.calls[0]![0]
    expect(arg.commit_sha).toBe('abc002')
    expect(arg.branch).toBe('feat/test')
    expect(arg.task_id).toBe('task-bbb')
    expect(arg.action).toBe('auto_merge')
    expect(arg.tier).toBe('low')
    expect(arg.reason).toContain('infra_error')
    expect(arg.findings).toEqual([])
  })

  it('returns sdId from persistSafetyDecision', async () => {
    const gate = await runSafetyGateCheck({
      commit_sha: 'abc003',
      branch: 'feat/test',
      task_id: 'task-ccc',
      results: [],
    })
    expect(gate.sdId).toBe('sd-infra-test-001')
  })

  it('pushes safety-diff-fetch-failed into results', async () => {
    const results: string[] = []
    await runSafetyGateCheck({
      commit_sha: 'abc004',
      branch: 'feat/test',
      task_id: 'task-ddd',
      results,
    })
    expect(results.some((r) => r.includes('safety-diff-fetch-failed'))).toBe(true)
  })

  it('returns non-blocking even when persistSafetyDecision throws', async () => {
    vi.mocked(persistSafetyDecision).mockRejectedValueOnce(new Error('DB down'))
    const gate = await runSafetyGateCheck({
      commit_sha: 'abc005',
      branch: 'feat/test',
      task_id: 'task-eee',
      results: [],
    })
    expect(gate.blocking).toBe(false)
    expect(gate.sdId).toBeNull()
  })
})
