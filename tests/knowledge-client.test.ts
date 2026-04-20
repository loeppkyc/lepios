/**
 * Unit tests for lib/knowledge/client.ts public functions.
 *
 * Mocks @/lib/supabase/service so no real Supabase connection is needed.
 * The mock exposes mockFrom and mockRpc as vi.fn()s configured per-test.
 *
 * RLS enforcement and real FTS behaviour require a live Supabase connection —
 * see scripts/verify-rag.ts for end-to-end verification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Ollama client (embed is used by findKnowledge + saveKnowledge) ───────

const { mockEmbed } = vi.hoisted(() => ({ mockEmbed: vi.fn() }))

vi.mock('@/lib/ollama/client', () => {
  class OllamaUnreachableError extends Error {
    override readonly name = 'OllamaUnreachableError'
    constructor(cause?: unknown) { super('Ollama is unreachable'); void cause }
  }
  return {
    embed: mockEmbed,
    OllamaUnreachableError,
  }
})

import { OllamaUnreachableError } from '@/lib/ollama/client'

// ── Mock service client ───────────────────────────────────────────────────────

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}))

import {
  logEvent,
  logError,
  logSuccess,
  saveKnowledge,
  findKnowledge,
  retrieveContext,
  markUsed,
} from '@/lib/knowledge/client'

// ── Builder factories ─────────────────────────────────────────────────────────

/** A chainable builder that resolves with `result` at the final awaited step. */
function makeInsertBuilder(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

function makeSelectBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const resolved = vi.fn().mockResolvedValue(result)
  const builder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: resolved,
    // Allow await on the builder itself (for queries that don't call .single())
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Default: Ollama unreachable — legacy FTS tests use the FTS-only fallback path.
  // Hybrid-specific tests override this per-test with mockEmbed.mockResolvedValue(...).
  mockEmbed.mockRejectedValue(new OllamaUnreachableError())
})

// ── logEvent ──────────────────────────────────────────────────────────────────

describe('logEvent', () => {
  it('returns event id on success', async () => {
    const b = makeInsertBuilder({ data: { id: 'evt-123' }, error: null })
    mockFrom.mockReturnValue(b)

    const id = await logEvent('pageprofit', 'scan', { actor: 'user', status: 'success' })

    expect(id).toBe('evt-123')
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(b.insert).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'pageprofit', action: 'scan', actor: 'user', status: 'success' }),
    )
  })

  it('returns null on Supabase error — never throws', async () => {
    const b = makeInsertBuilder({ data: null, error: { message: 'insert failed' } })
    mockFrom.mockReturnValue(b)

    const id = await logEvent('pageprofit', 'scan')
    expect(id).toBeNull()
  })

  it('truncates inputSummary to 500 chars', async () => {
    const b = makeInsertBuilder({ data: { id: 'evt-1' }, error: null })
    mockFrom.mockReturnValue(b)

    const longSummary = 'x'.repeat(600)
    await logEvent('d', 'a', { inputSummary: longSummary })

    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.input_summary).toHaveLength(500)
  })

  it('uses "system" as default actor', async () => {
    const b = makeInsertBuilder({ data: { id: 'e' }, error: null })
    mockFrom.mockReturnValue(b)

    await logEvent('d', 'a')
    expect(b.insert.mock.calls[0][0].actor).toBe('system')
  })
})

// ── logError ──────────────────────────────────────────────────────────────────

describe('logError', () => {
  it('sets status=failure and extracts error message and type', async () => {
    const b = makeInsertBuilder({ data: { id: 'evt-err' }, error: null })
    mockFrom.mockReturnValue(b)

    await logError('pageprofit', 'scan', new TypeError('something went wrong'))

    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.status).toBe('failure')
    expect(inserted.error_message).toBe('something went wrong')
    expect(inserted.error_type).toBe('TypeError')
  })

  it('accepts non-Error objects (coerces to Error)', async () => {
    const b = makeInsertBuilder({ data: { id: 'e' }, error: null })
    mockFrom.mockReturnValue(b)

    await logError('d', 'a', 'plain string error')
    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.error_message).toBe('plain string error')
  })
})

// ── logSuccess ────────────────────────────────────────────────────────────────

describe('logSuccess', () => {
  it('sets status=success and output_summary', async () => {
    const b = makeInsertBuilder({ data: { id: 'e' }, error: null })
    mockFrom.mockReturnValue(b)

    await logSuccess('pageprofit', 'scan', 'scan completed OK')
    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.status).toBe('success')
    expect(inserted.output_summary).toBe('scan completed OK')
  })
})

// ── saveKnowledge ─────────────────────────────────────────────────────────────

describe('saveKnowledge', () => {
  it('returns knowledge id on success', async () => {
    const b = makeInsertBuilder({ data: { id: 'know-1' }, error: null })
    mockFrom.mockReturnValue(b)

    const id = await saveKnowledge('error_fix', 'pageprofit', 'Keepa token exhaustion')
    expect(id).toBe('know-1')
    expect(mockFrom).toHaveBeenCalledWith('knowledge')
    expect(b.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'error_fix',
        domain: 'pageprofit',
        title: 'Keepa token exhaustion',
      }),
    )
  })

  it('returns null on Supabase error — never throws', async () => {
    const b = makeInsertBuilder({ data: null, error: { message: 'fail' } })
    mockFrom.mockReturnValue(b)

    const id = await saveKnowledge('tip', 'system', 'Test')
    expect(id).toBeNull()
  })

  it('defaults confidence to 0.5 when not provided', async () => {
    const b = makeInsertBuilder({ data: { id: 'k' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveKnowledge('tip', 'system', 'Test')
    expect(b.insert.mock.calls[0][0].confidence).toBe(0.5)
  })

  it('truncates title to 300 chars', async () => {
    const b = makeInsertBuilder({ data: { id: 'k' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveKnowledge('tip', 'system', 'T'.repeat(400))
    expect(b.insert.mock.calls[0][0].title).toHaveLength(300)
  })
})

// ── findKnowledge ─────────────────────────────────────────────────────────────

describe('findKnowledge', () => {
  it('returns knowledge entries on success', async () => {
    const entries = [
      { id: 'k1', category: 'error_fix', domain: 'pageprofit', title: 'Keepa exhaustion',
        confidence: 0.8, times_used: 2, times_helpful: 2,
        created_at: '', updated_at: '' },
    ]
    const b = makeSelectBuilder({ data: entries, error: null })
    mockFrom.mockReturnValue(b)

    const result = await findKnowledge('Keepa token exhaustion')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('k1')
  })

  it('returns empty array on Supabase error — never throws', async () => {
    const b = makeSelectBuilder({ data: null, error: { message: 'fail' } })
    mockFrom.mockReturnValue(b)

    const result = await findKnowledge('anything')
    expect(result).toEqual([])
  })

  it('returns empty array for empty query (no FTS applied)', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    const result = await findKnowledge('   ')
    expect(result).toEqual([])
    expect(b.textSearch).not.toHaveBeenCalled()
  })

  it('applies category filter when provided', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    await findKnowledge('test', { category: 'principle' })
    expect(b.eq).toHaveBeenCalledWith('category', 'principle')
  })

  it('applies domain filter when provided', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    await findKnowledge('test', { domain: 'pageprofit' })
    expect(b.eq).toHaveBeenCalledWith('domain', 'pageprofit')
  })

  it('filters out short words (<3 chars) before FTS', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    // "to be" are both <3 chars — no FTS call expected
    await findKnowledge('to be')
    expect(b.textSearch).not.toHaveBeenCalled()
  })
})

// ── retrieveContext ───────────────────────────────────────────────────────────

describe('retrieveContext', () => {
  it('returns formatted context string when entries exist', async () => {
    const entries = [
      { id: 'k1', category: 'error_fix', domain: 'pageprofit',
        title: 'Keepa token exhaustion', problem: 'Ran out of tokens',
        solution: 'Use stats_only=true', context: null,
        confidence: 0.8, times_used: 1, times_helpful: 1,
        created_at: '', updated_at: '' },
    ]
    const b = makeSelectBuilder({ data: entries, error: null })
    mockFrom.mockReturnValue(b)
    mockRpc.mockResolvedValue({ error: null })

    const ctx = await retrieveContext('Keepa tokens')

    expect(ctx).toContain('Relevant Knowledge')
    expect(ctx).toContain('Keepa token exhaustion')
    expect(ctx).toContain('Use stats_only=true')
  })

  it('returns empty string when no entries found', async () => {
    const b = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(b)

    const ctx = await retrieveContext('nothing matches this query at all xyz')
    expect(ctx).toBe('')
  })

  it('fires markUsed via RPC (fire-and-forget) — does not await', async () => {
    const entries = [
      { id: 'k1', category: 'tip', domain: 'system', title: 'Test',
        confidence: 0.5, times_used: 0, times_helpful: 0,
        created_at: '', updated_at: '' },
    ]
    const b = makeSelectBuilder({ data: entries, error: null })
    mockFrom.mockReturnValue(b)
    mockRpc.mockResolvedValue({ error: null })

    await retrieveContext('test')

    // Give the fire-and-forget a tick to settle
    await new Promise((r) => setTimeout(r, 10))
    expect(mockRpc).toHaveBeenCalledWith('knowledge_mark_used', { p_id: 'k1', p_helpful: true })
  })
})

// ── markUsed ──────────────────────────────────────────────────────────────────

describe('markUsed', () => {
  it('calls knowledge_mark_used RPC with id and helpful=true', async () => {
    mockRpc.mockResolvedValue({ error: null })

    await markUsed('k-123', true)

    expect(mockRpc).toHaveBeenCalledWith('knowledge_mark_used', { p_id: 'k-123', p_helpful: true })
  })

  it('calls RPC with helpful=false', async () => {
    mockRpc.mockResolvedValue({ error: null })

    await markUsed('k-123', false)
    expect(mockRpc).toHaveBeenCalledWith('knowledge_mark_used', { p_id: 'k-123', p_helpful: false })
  })

  it('does not throw on RPC error', async () => {
    mockRpc.mockRejectedValue(new Error('rpc failed'))

    await expect(markUsed('k-123')).resolves.toBeUndefined()
  })
})

// ── findKnowledge — hybrid search (Step 5) ────────────────────────────────────

const FAKE_EMBEDDING = new Array(768).fill(0.1)

const ENTRY = {
  id: 'k1', category: 'error_fix', domain: 'pageprofit', title: 'Keepa exhaustion',
  confidence: 0.8, times_used: 2, times_helpful: 2, created_at: '', updated_at: '',
  problem: null, solution: null, context: null, entity: null,
  last_used_at: null, source_events: null, tags: null, embedding_id: null,
}

describe('findKnowledge — hybrid search (Step 5)', () => {
  it('calls match_knowledge RPC when Ollama embed succeeds', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)

    // FTS query
    const ftsBuilder = makeSelectBuilder({ data: [], error: null })
    mockFrom.mockReturnValue(ftsBuilder)

    // Vector RPC
    mockRpc.mockResolvedValue({ data: [{ ...ENTRY, similarity: 0.9 }], error: null })

    const result = await findKnowledge('Keepa token exhaustion')

    expect(mockEmbed).toHaveBeenCalledWith('Keepa token exhaustion')
    expect(mockRpc).toHaveBeenCalledWith(
      'match_knowledge',
      expect.objectContaining({ query_embedding: FAKE_EMBEDDING }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('k1')
  })

  it('falls back to FTS-only when Ollama is unreachable', async () => {
    // Import the error class through the mock so we get the same reference
    const { OllamaUnreachableError } = await import('@/lib/ollama/client')
    mockEmbed.mockRejectedValue(new OllamaUnreachableError())

    const ftsBuilder = makeSelectBuilder({ data: [ENTRY], error: null })
    mockFrom.mockReturnValue(ftsBuilder)

    const result = await findKnowledge('Keepa token exhaustion')

    // Should not call match_knowledge RPC
    expect(mockRpc).not.toHaveBeenCalledWith('match_knowledge', expect.anything())
    // Should still return FTS results
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('k1')
  })

  it('falls back to FTS-only when match_knowledge RPC returns an error', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)

    const ftsBuilder = makeSelectBuilder({ data: [ENTRY], error: null })
    mockFrom.mockReturnValue(ftsBuilder)

    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } })

    const result = await findKnowledge('Keepa token exhaustion')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('k1')
  })

  it('merges vector + FTS results with 60/40 weighting (vector result ranked first)', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)

    const ftsEntry  = { ...ENTRY, id: 'fts-only', title: 'FTS only entry' }
    const vecEntry  = { ...ENTRY, id: 'vec-only', title: 'Vector only entry', similarity: 0.95 }
    const bothEntry = { ...ENTRY, id: 'both',     title: 'In both results',   similarity: 0.70 }

    // FTS returns ftsEntry + bothEntry (no embedding)
    const ftsBuilder = makeSelectBuilder({ data: [bothEntry, ftsEntry], error: null })
    mockFrom.mockReturnValue(ftsBuilder)

    // Vector RPC returns vecEntry + bothEntry (with similarity)
    mockRpc.mockResolvedValue({
      data: [vecEntry, bothEntry],
      error: null,
    })

    const result = await findKnowledge('test', { limit: 10 })

    // All three entries should appear
    const ids = result.map((r) => r.id)
    expect(ids).toContain('vec-only')
    expect(ids).toContain('fts-only')
    expect(ids).toContain('both')

    // vecEntry has high vector similarity (0.95 * 0.6 = 0.57) so it should rank near top
    expect(ids.indexOf('vec-only')).toBeLessThan(ids.indexOf('fts-only'))
  })

  it('returns empty array for blank query without calling embed or RPC', async () => {
    const result = await findKnowledge('   ')

    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalledWith('match_knowledge', expect.anything())
    expect(result).toEqual([])
  })
})

// ── saveKnowledge — auto-embed (Step 5) ───────────────────────────────────────

describe('saveKnowledge — auto-embed (Step 5)', () => {
  it('stores embedding when Ollama is reachable', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)

    const b = makeInsertBuilder({ data: { id: 'k-new' }, error: null })
    mockFrom.mockReturnValue(b)

    await saveKnowledge('tip', 'system', 'Test knowledge entry')

    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.embedding).toBeTruthy()
    // Should be a JSON string of the embedding array
    expect(JSON.parse(inserted.embedding as string)).toHaveLength(768)
  })

  it('saves row without embedding when Ollama is unreachable', async () => {
    const { OllamaUnreachableError } = await import('@/lib/ollama/client')
    mockEmbed.mockRejectedValue(new OllamaUnreachableError())

    const b = makeInsertBuilder({ data: { id: 'k-new' }, error: null })
    mockFrom.mockReturnValue(b)

    const id = await saveKnowledge('tip', 'system', 'Test knowledge entry')

    // Row should still be saved
    expect(id).toBe('k-new')
    const inserted = b.insert.mock.calls[0][0]
    expect(inserted.embedding).toBeNull()
  })

  it('returns null on Supabase insert error even when embed succeeds', async () => {
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING)

    const b = makeInsertBuilder({ data: null, error: { message: 'insert failed' } })
    mockFrom.mockReturnValue(b)

    const id = await saveKnowledge('tip', 'system', 'Test')
    expect(id).toBeNull()
  })
})
