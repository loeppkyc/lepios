import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Supabase service client ──────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/memory/decision/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-xyz'
const NEW_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PRIOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const VALID_BODY = {
  topic: 'Memory layer architecture',
  chosen_path: 'extend digital_twin scope; 3 new tables; no new component row',
  source: 'redline_session' as const,
}

function makeRequest(body: unknown, headerOverrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/memory/decision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VALID_SECRET}`,
      ...headerOverrides,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// Builder pattern that mirrors @supabase/supabase-js's chained fluent API.
// `from('decisions_log').insert({...}).select('id').single()` resolves to
// { data, error }. We capture the inserted row via the `insert` spy.
function makeInsertBuilder(
  opts: {
    insertResult?: { data: { id: string } | null; error: Error | null }
  } = {}
) {
  const result = opts.insertResult ?? { data: { id: NEW_ID }, error: null }
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

function makeUpdateBuilder(opts: { error?: Error | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ data: null, error: opts.error ?? null })
  const update = vi.fn().mockReturnValue({ eq })
  return { update, eq }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  // Default: insert succeeds, no superseder.
  mockFrom.mockReturnValue(makeInsertBuilder())
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/memory/decision — auth', () => {
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

  it('does not call Supabase on unauthorized request', async () => {
    const req = makeRequest(VALID_BODY, { Authorization: 'Bearer wrong' })
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('skips auth check entirely when CRON_SECRET is unset (dev mode)', async () => {
    delete process.env.CRON_SECRET
    const req = makeRequest(VALID_BODY, { Authorization: '' })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/memory/decision — validation', () => {
  it('returns 400 on invalid JSON body', async () => {
    const req = makeRequest('not-json{{', {})
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 400 when topic is missing', async () => {
    const { topic: _topic, ...without } = VALID_BODY
    const req = makeRequest(without)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
  })

  it('returns 400 when chosen_path is empty', async () => {
    const req = makeRequest({ ...VALID_BODY, chosen_path: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when source is not in the allowed enum', async () => {
    const req = makeRequest({ ...VALID_BODY, source: 'random_source' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when category is not in the allowed enum', async () => {
    const req = makeRequest({ ...VALID_BODY, category: 'made-up' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when supersedes_id is not a UUID', async () => {
    const req = makeRequest({ ...VALID_BODY, supersedes_id: 'not-a-uuid' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('does not call Supabase on validation failure', async () => {
    const req = makeRequest({ ...VALID_BODY, source: 'bad' })
    await POST(req)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/memory/decision — happy path', () => {
  it('returns 201 with ok:true and id on a minimal valid body', async () => {
    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe(NEW_ID)
  })

  it('inserts row with defaults applied (category=architecture, decided_by=colin)', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)

    const req = makeRequest(VALID_BODY)
    await POST(req)

    expect(mockFrom).toHaveBeenCalledWith('decisions_log')
    const row = builder.insert.mock.calls[0][0]
    expect(row.topic).toBe(VALID_BODY.topic)
    expect(row.chosen_path).toBe(VALID_BODY.chosen_path)
    expect(row.source).toBe(VALID_BODY.source)
    expect(row.category).toBe('architecture')
    expect(row.decided_by).toBe('colin')
    expect(row.options_considered).toEqual([])
    expect(row.related_files).toEqual([])
    expect(row.tags).toEqual([])
    expect(row.supersedes_id).toBeNull()
  })

  it('passes through options_considered, tags, related_files when provided', async () => {
    const builder = makeInsertBuilder()
    mockFrom.mockReturnValue(builder)

    const req = makeRequest({
      ...VALID_BODY,
      category: 'data-model',
      decided_by: 'coordinator',
      options_considered: [
        { label: 'A', summary: 'option A', rejected_reason: 'too narrow' },
        { label: 'B' },
      ],
      tags: ['memory-layer', 'twin'],
      related_files: ['docs/harness/MEMORY_LAYER_SPEC.md'],
      reason: 'because',
      context: 'see spec',
      source_ref: 'docs/harness/MEMORY_LAYER_SPEC.md',
    })
    await POST(req)

    const row = builder.insert.mock.calls[0][0]
    expect(row.category).toBe('data-model')
    expect(row.decided_by).toBe('coordinator')
    expect(row.options_considered).toHaveLength(2)
    expect(row.tags).toEqual(['memory-layer', 'twin'])
    expect(row.related_files).toEqual(['docs/harness/MEMORY_LAYER_SPEC.md'])
    expect(row.reason).toBe('because')
    expect(row.context).toBe('see spec')
    expect(row.source_ref).toBe('docs/harness/MEMORY_LAYER_SPEC.md')
  })
})

// ── Supersession ──────────────────────────────────────────────────────────────

describe('POST /api/memory/decision — supersession', () => {
  it('updates the prior row when supersedes_id is provided', async () => {
    const insertBuilder = makeInsertBuilder()
    const updateBuilder = makeUpdateBuilder()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount += 1
      return callCount === 1 ? insertBuilder : updateBuilder
    })

    const req = makeRequest({ ...VALID_BODY, supersedes_id: PRIOR_ID })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(updateBuilder.update).toHaveBeenCalled()
    const updateArgs = updateBuilder.update.mock.calls[0][0]
    expect(updateArgs.superseded_at).toBeTypeOf('string')
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', PRIOR_ID)
  })

  it('returns 500 when the supersede UPDATE fails (does not silently half-succeed)', async () => {
    const insertBuilder = makeInsertBuilder()
    const updateBuilder = makeUpdateBuilder({ error: new Error('FK violation') })
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount += 1
      return callCount === 1 ? insertBuilder : updateBuilder
    })

    const req = makeRequest({ ...VALID_BODY, supersedes_id: PRIOR_ID })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('supersede failed')
  })
})

// ── DB failure ────────────────────────────────────────────────────────────────

describe('POST /api/memory/decision — db failure', () => {
  it('returns 500 when the insert errors', async () => {
    const builder = makeInsertBuilder({
      insertResult: { data: null, error: new Error('connection refused') },
    })
    mockFrom.mockReturnValue(builder)

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('connection refused')
  })
})
