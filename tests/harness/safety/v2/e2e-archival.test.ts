/**
 * Unit tests for lib/harness/safety/v2/e2e/archival.ts.
 *
 * `logFailure` is mocked because the archival contract is what matters here —
 * not the failures_log write path (which has its own tests in
 * tests/failures/log.test.ts on main).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/failures/log', () => ({
  logFailure: vi.fn(),
}))

import { archiveE2EFailures } from '@/lib/harness/safety/v2/e2e/archival'
import { logFailure } from '@/lib/failures/log'
import type { E2EResult } from '@/lib/harness/safety/v2/e2e/types'

const logFailureMock = vi.mocked(logFailure)

beforeEach(() => {
  logFailureMock.mockReset()
  logFailureMock.mockResolvedValue({
    ok: true,
    id: 'aaa',
    failure_number: 'F-N99',
    status: 'open',
    is_recurrence: false,
  })
})

function makeResult(pass: boolean, assertions: E2EResult['assertions']): E2EResult {
  return { pass, assertions, duration_ms: 100 }
}

describe('archiveE2EFailures — write rules', () => {
  it('writes nothing when E2EResult is all-pass', async () => {
    const out = await archiveE2EFailures({
      result: makeResult(true, [{ url: 'https://x/a', pass: true }]),
      pr_number: 42,
      commit_sha: 'abc1234',
      files_changed: ['app/page.tsx'],
    })
    expect(out.archived_failure_ids).toEqual([])
    expect(logFailureMock).not.toHaveBeenCalled()
  })

  it('writes one row per failed assertion', async () => {
    logFailureMock
      .mockResolvedValueOnce({
        ok: true,
        id: 'id1',
        failure_number: 'F-N100',
        status: 'open',
        is_recurrence: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        id: 'id2',
        failure_number: 'F-N101',
        status: 'open',
        is_recurrence: false,
      })

    const out = await archiveE2EFailures({
      result: makeResult(false, [
        { url: 'https://x/a', pass: true },
        { url: 'https://x/b', pass: false, reason: 'navigation_error: timeout' },
        { url: 'https://x/c', pass: false, reason: 'missing_text: Welcome' },
      ]),
      pr_number: 42,
      commit_sha: 'abc1234',
      files_changed: ['app/page.tsx'],
    })
    expect(out.archived_failure_ids).toEqual(['id1', 'id2'])
    expect(logFailureMock).toHaveBeenCalledTimes(2)
  })

  it('skips logFailure rows that returned ok=false', async () => {
    logFailureMock.mockResolvedValueOnce({ ok: false, error: 'db down' }).mockResolvedValueOnce({
      ok: true,
      id: 'id2',
      failure_number: 'F-N100',
      status: 'open',
      is_recurrence: false,
    })

    const out = await archiveE2EFailures({
      result: makeResult(false, [
        { url: 'https://x/a', pass: false, reason: 'r1' },
        { url: 'https://x/b', pass: false, reason: 'r2' },
      ]),
      pr_number: 42,
      commit_sha: 'abc1234',
      files_changed: [],
    })
    expect(out.archived_failure_ids).toEqual(['id2'])
  })
})

describe('archiveE2EFailures — severity classification', () => {
  it('navigation_error → critical', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [
        { url: 'https://x/a', pass: false, reason: 'navigation_error: timeout' },
      ]),
      pr_number: 1,
      commit_sha: 'a',
      files_changed: [],
    })
    expect(logFailureMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }))
  })

  it('5xx status → critical', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [
        {
          url: 'https://x/a',
          pass: false,
          reason: 'status_mismatch: expected 200, got 500',
          status: 500,
        },
      ]),
      pr_number: 1,
      commit_sha: 'a',
      files_changed: [],
    })
    expect(logFailureMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }))
  })

  it('200-with-missing-text → high (not critical)', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [
        {
          url: 'https://x/a',
          pass: false,
          reason: 'missing_text: Welcome',
          status: 200,
        },
      ]),
      pr_number: 1,
      commit_sha: 'a',
      files_changed: [],
    })
    expect(logFailureMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'high' }))
  })
})

describe('archiveE2EFailures — payload shape', () => {
  it('signature.type = route-500 for HTTP failures', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [
        {
          url: 'https://x/a',
          pass: false,
          reason: 'status_mismatch: expected 200, got 500',
          status: 500,
        },
      ]),
      pr_number: 7,
      commit_sha: 'sha7',
      files_changed: ['app/api/r/route.ts'],
    })
    const arg = logFailureMock.mock.calls[0][0]
    expect(arg.pattern_signature.type).toBe('route-500')
  })

  it('signature.type = manual for content failures', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [
        { url: 'https://x/a', pass: false, reason: 'missing_text: foo', status: 200 },
      ]),
      pr_number: 7,
      commit_sha: 'sha7',
      files_changed: [],
    })
    const arg = logFailureMock.mock.calls[0][0]
    expect(arg.pattern_signature.type).toBe('manual')
  })

  it('trigger_context = safety_agent', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [{ url: 'https://x/a', pass: false, reason: 'r' }]),
      pr_number: 7,
      commit_sha: 'sha7',
      files_changed: [],
    })
    const arg = logFailureMock.mock.calls[0][0]
    expect(arg.trigger_context).toBe('safety_agent')
  })

  it('trigger_ref uses pr_number when present, else commit_sha[:8]', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [{ url: 'https://x/a', pass: false, reason: 'r' }]),
      pr_number: 99,
      commit_sha: 'abc1234567',
      files_changed: [],
    })
    expect(logFailureMock.mock.calls[0][0].trigger_ref).toBe('99')

    logFailureMock.mockClear()
    await archiveE2EFailures({
      result: makeResult(false, [{ url: 'https://x/a', pass: false, reason: 'r' }]),
      pr_number: null,
      commit_sha: 'abc1234567',
      files_changed: [],
    })
    expect(logFailureMock.mock.calls[0][0].trigger_ref).toBe('abc12345')
  })

  it('lesson is reason-specific', async () => {
    await archiveE2EFailures({
      result: makeResult(false, [{ url: 'https://x/a', pass: false, reason: 'console_errors: 3' }]),
      pr_number: 1,
      commit_sha: 'a',
      files_changed: [],
    })
    expect(logFailureMock.mock.calls[0][0].lesson).toContain('Console errors')
  })
})
