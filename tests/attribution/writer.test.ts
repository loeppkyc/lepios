/**
 * Unit tests for lib/attribution/writer.ts and app/api/attribution route.
 * 7 required test cases from attribution-acceptance.md.
 * Mocks @/lib/supabase/service — no real Supabase connection needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { recordAttribution } from '@/lib/attribution/writer'
import { GET } from '@/app/api/attribution/[entity_type]/[entity_id]/route'

// ── Supabase mock builders ────────────────────────────────────────────────────

function makeInsertBuilder(error: unknown = null) {
  return {
    insert: vi.fn().mockResolvedValue({ data: null, error }),
  }
}

function makeSelectBuilder(rows: unknown[] = [], error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  }
  return builder
}

// ── Helper: make a GET request to the attribution route ───────────────────────

function makeGetRequest(
  entityType: string,
  entityId: string,
  headerOverrides: Record<string, string> = {}
): Request {
  return new Request(`http://localhost/api/attribution/${entityType}/${entityId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer test-cron-secret`,
      ...headerOverrides,
    },
  })
}

function makeParams(entityType: string, entityId: string) {
  return Promise.resolve({ entity_type: entityType, entity_id: entityId })
}

const VALID_UUID = '885ff1e3-baed-4512-8e7a-8335995ea057'
const VALID_CRON_SECRET = 'test-cron-secret'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_CRON_SECRET
})

// ── Test 1: recordAttribution success ─────────────────────────────────────────

describe('recordAttribution — success', () => {
  it('inserts one row into entity_attribution, returns void, does not throw', async () => {
    const insertBuilder = makeInsertBuilder()
    mockFrom.mockReturnValue(insertBuilder)

    const result = await recordAttribution(
      {
        actor_type: 'improvement_engine',
        source_task_id: VALID_UUID,
        run_id: 'run-uuid-1234',
      },
      { type: 'task_queue', id: VALID_UUID },
      'created',
      { fingerprint: 'abc123', category: 'tooling' }
    )

    expect(result).toBeUndefined()
    expect(mockFrom).toHaveBeenCalledWith('entity_attribution')
    expect(insertBuilder.insert).toHaveBeenCalledOnce()

    const insertArg = insertBuilder.insert.mock.calls[0][0]
    expect(insertArg.entity_type).toBe('task_queue')
    expect(insertArg.entity_id).toBe(VALID_UUID)
    expect(insertArg.action).toBe('created')
    expect(insertArg.actor_type).toBe('improvement_engine')
    expect(insertArg.source_task_id).toBe(VALID_UUID)
    expect(insertArg.details).toEqual({ fingerprint: 'abc123', category: 'tooling' })
  })
})

// ── Test 2: recordAttribution Supabase error — non-fatal ──────────────────────

describe('recordAttribution — Supabase error', () => {
  it('does NOT throw on insert failure; logs attribution.write_failed to agent_events', async () => {
    const agentEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'entity_attribution') {
        return {
          insert: vi.fn().mockRejectedValue(new Error('Supabase unavailable')),
        }
      }
      // agent_events insert (fallback logger)
      return { insert: agentEventsInsert }
    })

    // Must not throw
    await expect(
      recordAttribution(
        { actor_type: 'coordinator' },
        { type: 'task_queue', id: VALID_UUID },
        'coordinator_fired'
      )
    ).resolves.toBeUndefined()

    // Must have logged attribution.write_failed
    expect(agentEventsInsert).toHaveBeenCalledOnce()
    const logArg = agentEventsInsert.mock.calls[0][0]
    expect(logArg.action).toBe('attribution.write_failed')
    expect(logArg.status).toBe('error')
  })
})

// ── Test 3: recordAttribution minimal context ─────────────────────────────────

describe('recordAttribution — minimal context', () => {
  it('inserts row with nulls for all optional fields; no runtime error', async () => {
    const insertBuilder = makeInsertBuilder()
    mockFrom.mockReturnValue(insertBuilder)

    await expect(
      recordAttribution({ actor_type: 'cron' }, { type: 'task_queue', id: VALID_UUID }, 'created')
    ).resolves.toBeUndefined()

    const insertArg = insertBuilder.insert.mock.calls[0][0]
    expect(insertArg.actor_type).toBe('cron')
    expect(insertArg.actor_id).toBeNull()
    expect(insertArg.run_id).toBeNull()
    expect(insertArg.coordinator_session_id).toBeNull()
    expect(insertArg.source_task_id).toBeNull()
    expect(insertArg.commit_sha).toBeNull()
    expect(insertArg.details).toBeNull()
  })
})

// ── Test 4: Query route — 200 + correct shape ─────────────────────────────────

describe('GET /api/attribution/[entity_type]/[entity_id] — success', () => {
  it('returns 200 with records array and count', async () => {
    const fakeRows = [
      {
        id: VALID_UUID,
        action: 'created',
        actor_type: 'improvement_engine',
        actor_id: null,
        run_id: 'run-uuid-abc',
        coordinator_session_id: null,
        source_task_id: VALID_UUID,
        occurred_at: '2026-04-24T10:00:00Z',
        details: { fingerprint: 'abc' },
      },
    ]

    mockFrom.mockReturnValue(makeSelectBuilder(fakeRows))

    const req = makeGetRequest('task_queue', VALID_UUID)
    const res = await GET(req, { params: makeParams('task_queue', VALID_UUID) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.records).toHaveLength(1)
    expect(body.records[0].action).toBe('created')
    expect(body.records[0].actor_type).toBe('improvement_engine')
  })
})

// ── Test 5: Query route — unknown UUID returns empty result ───────────────────

describe('GET /api/attribution/[entity_type]/[entity_id] — unknown entity', () => {
  it('returns 200 with { records: [], count: 0 } for unknown UUID', async () => {
    mockFrom.mockReturnValue(makeSelectBuilder([]))

    const unknownId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const req = makeGetRequest('task_queue', unknownId)
    const res = await GET(req, { params: makeParams('task_queue', unknownId) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.records).toEqual([])
    expect(body.count).toBe(0)
  })
})

// ── Test 6: Query route — invalid UUID returns 400 ───────────────────────────

describe('GET /api/attribution/[entity_type]/[entity_id] — invalid UUID', () => {
  it('returns 400 for non-UUID entity_id', async () => {
    const req = makeGetRequest('task_queue', 'not-a-uuid')
    const res = await GET(req, { params: makeParams('task_queue', 'not-a-uuid') })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

// ── Test 7: Query route — no auth returns 401 ────────────────────────────────

describe('GET /api/attribution/[entity_type]/[entity_id] — no auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const req = makeGetRequest('task_queue', VALID_UUID, { Authorization: '' })
    const res = await GET(req, { params: makeParams('task_queue', VALID_UUID) })

    expect(res.status).toBe(401)
  })
})
