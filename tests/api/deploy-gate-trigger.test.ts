/**
 * Unit tests for app/api/harness/deploy-gate/trigger/route.ts.
 * Covers auth, body validation, agent_events write, and tests_passed=false path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/harness/deploy-gate/trigger/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'
const VALID_TASK_ID = '885ff1e3-baed-4512-8e7a-8335995ea057'
const VALID_RUN_ID = 'b49f21bb-b304-4380-97ce-c037e832727a'
const VALID_BRANCH = `harness/task-${VALID_TASK_ID}`

const VALID_BODY = {
  task_id: VALID_TASK_ID,
  branch: VALID_BRANCH,
  commit_sha: 'abc1234',
  run_id: VALID_RUN_ID,
  tests_passed: true,
}

function makeRequest(body: object, headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/harness/deploy-gate/trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
    body: JSON.stringify(body),
  })
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  mockFrom.mockReturnValue(makeInsertBuilder())
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/harness/deploy-gate/trigger — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: '' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('does not write agent_events on unauthorized request', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong' })
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Body validation ───────────────────────────────────────────────────────────

describe('POST /api/harness/deploy-gate/trigger — validation', () => {
  it('returns 400 when branch does not start with "harness/task-"', async () => {
    const req = makeRequest({ ...VALID_BODY, branch: 'feat/some-feature' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when task_id is not a valid UUID', async () => {
    const req = makeRequest({ ...VALID_BODY, task_id: 'not-a-uuid' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when run_id is not a valid UUID', async () => {
    const req = makeRequest({ ...VALID_BODY, run_id: 'also-not-a-uuid' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when commit_sha is too short (< 7 chars)', async () => {
    const req = makeRequest({ ...VALID_BODY, commit_sha: 'abc12' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when commit_sha contains non-hex chars', async () => {
    const req = makeRequest({ ...VALID_BODY, commit_sha: 'xyz1234' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when tests_passed is missing', async () => {
    const { tests_passed: _, ...bodyWithout } = VALID_BODY
    const req = makeRequest(bodyWithout)
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('does not write agent_events on validation failure', async () => {
    const req = makeRequest({ ...VALID_BODY, branch: 'main' })
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/harness/deploy-gate/trigger — happy path', () => {
  it('returns 200 with ok:true and event_id', async () => {
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.event_id).toBe('string')
    expect(body.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('writes exactly one agent_events row', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(b.insert).toHaveBeenCalledTimes(1)
  })

  it('agent_events row has task_type=deploy_gate_triggered and status=success', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest(VALID_BODY)
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.task_type).toBe('deploy_gate_triggered')
    expect(row.status).toBe('success')
  })

  it('agent_events row meta contains all input fields plus received_at', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest(VALID_BODY)
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.meta.task_id).toBe(VALID_TASK_ID)
    expect(row.meta.branch).toBe(VALID_BRANCH)
    expect(row.meta.commit_sha).toBe('abc1234')
    expect(row.meta.run_id).toBe(VALID_RUN_ID)
    expect(row.meta.tests_passed).toBe(true)
    expect(typeof row.meta.received_at).toBe('string')
  })

  it('event_id in response matches id written to agent_events', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    const body = await res.json()

    const row = b.insert.mock.calls[0][0]
    expect(row.id).toBe(body.event_id)
  })

  it('accepts full 40-char commit SHA', async () => {
    const req = makeRequest({ ...VALID_BODY, commit_sha: 'a'.repeat(40) })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── tests_passed=false path ───────────────────────────────────────────────────

describe('POST /api/harness/deploy-gate/trigger — tests_passed=false', () => {
  it('still returns 200 when tests_passed=false', async () => {
    const req = makeRequest({ ...VALID_BODY, tests_passed: false })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('writes agent_events row with status=error when tests_passed=false', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest({ ...VALID_BODY, tests_passed: false })
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.task_type).toBe('deploy_gate_triggered')
  })

  it('output_summary mentions tests_passed=false', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest({ ...VALID_BODY, tests_passed: false })
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.output_summary).toContain('tests_passed=false')
  })

  it('meta.tests_passed is false in the logged row', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)

    const req = makeRequest({ ...VALID_BODY, tests_passed: false })
    await POST(req)

    const row = b.insert.mock.calls[0][0]
    expect(row.meta.tests_passed).toBe(false)
  })
})
