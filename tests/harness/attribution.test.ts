import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
}))

import { recordCommit, recordPR } from '@/lib/harness/attribution'
import { POST } from '@/app/api/harness/record-attribution/route'

function makeInsertBuilder(throws = false) {
  return {
    insert: throws
      ? vi.fn().mockRejectedValue(new Error('db down'))
      : vi.fn().mockResolvedValue({ error: null }),
  }
}

beforeEach(() => vi.clearAllMocks())

// ── recordCommit ──────────────────────────────────────────────────────────────

describe('recordCommit', () => {
  it('inserts a commit row with correct fields', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)
    await recordCommit({
      agentId: 'builder',
      taskId: 'task-42',
      commitSha: 'abc123',
      branch: 'harness/task-42',
    })
    expect(mockFrom).toHaveBeenCalledWith('attribution_log')
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'builder',
        task_id: 'task-42',
        action: 'commit',
        commit_sha: 'abc123',
        branch: 'harness/task-42',
      })
    )
  })

  it('defaults task_id to null when omitted', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)
    await recordCommit({ agentId: 'builder', commitSha: 'def456', branch: 'main' })
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ task_id: null }))
  })

  it('does not throw when DB insert rejects', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder(true))
    await expect(
      recordCommit({ agentId: 'builder', commitSha: 'abc', branch: 'main' })
    ).resolves.toBeUndefined()
  })
})

// ── recordPR ──────────────────────────────────────────────────────────────────

describe('recordPR', () => {
  it('inserts a pr_open row with correct fields', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)
    await recordPR({
      agentId: 'self_repair',
      runId: 'run-99',
      prNumber: 42,
      prUrl: 'https://github.com/loeppkyc/lepios/pull/42',
      branch: 'self-repair/run-99',
    })
    expect(mockFrom).toHaveBeenCalledWith('attribution_log')
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'self_repair',
        run_id: 'run-99',
        action: 'pr_open',
        pr_number: 42,
        pr_url: 'https://github.com/loeppkyc/lepios/pull/42',
        branch: 'self-repair/run-99',
      })
    )
  })

  it('defaults run_id to null when omitted', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)
    await recordPR({
      agentId: 'deployer',
      prNumber: 1,
      prUrl: 'https://github.com/loeppkyc/lepios/pull/1',
      branch: 'main',
    })
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ run_id: null }))
  })

  it('does not throw when DB insert rejects', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder(true))
    await expect(
      recordPR({ agentId: 'self_repair', prNumber: 1, prUrl: 'https://github.com/x', branch: 'b' })
    ).resolves.toBeUndefined()
  })
})

// ── POST /api/harness/record-attribution ─────────────────────────────────────

describe('POST /api/harness/record-attribution', () => {
  function makeReq(body: unknown) {
    return new Request('http://localhost/api/harness/record-attribution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 200 for valid commit body', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const res = await POST(
      makeReq({ action: 'commit', agent_id: 'builder', commit_sha: 'abc', branch: 'main' })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
  })

  it('returns 200 for valid pr_open body', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const res = await POST(
      makeReq({
        action: 'pr_open',
        agent_id: 'self_repair',
        pr_number: 5,
        pr_url: 'https://github.com/loeppkyc/lepios/pull/5',
        branch: 'self-repair/r1',
      })
    )
    expect(res.status).toBe(200)
  })

  it('returns 400 for unknown action', async () => {
    const res = await POST(makeReq({ action: 'delete', agent_id: 'x', branch: 'main' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing required fields', async () => {
    const res = await POST(makeReq({ action: 'commit', branch: 'main' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/harness/record-attribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
    )
    expect(res.status).toBe(400)
  })
})
