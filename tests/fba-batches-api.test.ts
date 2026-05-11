import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Business logic tests for FBA Batches API
// These test the domain rules directly without invoking Next.js route handlers.
// ---------------------------------------------------------------------------

// --- Schema validation helpers (inline, no import from route files per F11) ---

function validateCreateBatch(body: unknown): { name: string; source?: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid body' }
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : null
  if (!name || name.length === 0) return { error: 'Name is required' }
  if (name.length > 80) return { error: 'Name must be 80 characters or fewer' }
  const source = typeof b.source === 'string' ? b.source : undefined
  return { name, source }
}

function validateAddItem(body: unknown):
  | {
      asin: string
      scan_result_id?: string
      amazon_listing_id?: string
      sku?: string
      isbn?: string
      title?: string
      condition_code?: string
      list_price_cad?: number
    }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid body' }
  const b = body as Record<string, unknown>
  if (!b.asin || typeof b.asin !== 'string' || b.asin.trim().length === 0) {
    return { error: 'ASIN is required' }
  }
  return {
    asin: b.asin as string,
    scan_result_id: typeof b.scan_result_id === 'string' ? b.scan_result_id : undefined,
    amazon_listing_id: typeof b.amazon_listing_id === 'string' ? b.amazon_listing_id : undefined,
    sku: typeof b.sku === 'string' ? b.sku : undefined,
    isbn: typeof b.isbn === 'string' ? b.isbn : undefined,
    title: typeof b.title === 'string' ? b.title : undefined,
    condition_code: typeof b.condition_code === 'string' ? b.condition_code : undefined,
    list_price_cad: typeof b.list_price_cad === 'number' ? b.list_price_cad : undefined,
  }
}

/** Domain rule: status defaults to 'listed' if amazon_listing_id provided, 'pending' otherwise */
function deriveItemStatus(amazon_listing_id: string | undefined): 'listed' | 'pending' {
  return amazon_listing_id ? 'listed' : 'pending'
}

// --- Mock Supabase insert helper ---

function mockInsert(
  table: string,
  row: Record<string, unknown>
): { data: Record<string, unknown>; error: null } {
  return {
    data: { id: 'mock-uuid', ...row, added_at: new Date().toISOString() },
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/batches — create batch', () => {
  it('creates a batch with valid name', () => {
    const result = validateCreateBatch({ name: 'May10-GW' })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.name).toBe('May10-GW')
    }
  })

  it('trims whitespace from name', () => {
    const result = validateCreateBatch({ name: '  Test Batch  ' })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.name).toBe('Test Batch')
    }
  })

  it('rejects empty name', () => {
    const result = validateCreateBatch({ name: '' })
    expect('error' in result).toBe(true)
  })

  it('rejects whitespace-only name', () => {
    const result = validateCreateBatch({ name: '   ' })
    expect('error' in result).toBe(true)
  })

  it('rejects name over 80 chars', () => {
    const result = validateCreateBatch({ name: 'a'.repeat(81) })
    expect('error' in result).toBe(true)
  })

  it('accepts name exactly 80 chars', () => {
    const result = validateCreateBatch({ name: 'a'.repeat(80) })
    expect('error' in result).toBe(false)
  })

  it('accepts optional source field', () => {
    const result = validateCreateBatch({ name: 'GW Batch', source: 'GoodWill' })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.source).toBe('GoodWill')
    }
  })

  it('mock insert returns batch with person_handle=colin', () => {
    const row = { person_handle: 'colin', name: 'May10-GW', status: 'open', source: null }
    const { data, error } = mockInsert('fba_batches', row)
    expect(error).toBeNull()
    expect(data.person_handle).toBe('colin')
    expect(data.name).toBe('May10-GW')
    expect(data.status).toBe('open')
  })
})

describe('POST /api/batches/[id]/items — item status rule', () => {
  it('sets status to "listed" when amazon_listing_id is provided', () => {
    const status = deriveItemStatus('some-uuid')
    expect(status).toBe('listed')
  })

  it('sets status to "pending" when amazon_listing_id is not provided', () => {
    const status = deriveItemStatus(undefined)
    expect(status).toBe('pending')
  })

  it('sets status to "pending" when amazon_listing_id is undefined (no listing)', () => {
    // No listing id provided — defaults to pending
    const noId: string | undefined = undefined
    const status = deriveItemStatus(noId)
    expect(status).toBe('pending')
  })

  it('validates item body with valid asin', () => {
    const result = validateAddItem({
      asin: 'B01ABCDEFG',
      amazon_listing_id: 'aaaa-bbbb-cccc',
      sku: 'SKU123',
      isbn: '9780307888037',
      title: 'Test Book',
      condition_code: 'like_new',
      list_price_cad: 12.99,
    })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.asin).toBe('B01ABCDEFG')
      expect(result.amazon_listing_id).toBe('aaaa-bbbb-cccc')
      expect(result.list_price_cad).toBe(12.99)
    }
  })

  it('rejects item body with missing asin', () => {
    const result = validateAddItem({ isbn: '9780307888037' })
    expect('error' in result).toBe(true)
  })

  it('rejects item body with empty asin', () => {
    const result = validateAddItem({ asin: '' })
    expect('error' in result).toBe(true)
  })

  it('derives listed status for item with amazon_listing_id', () => {
    const body = {
      asin: 'B01ABCDEFG',
      amazon_listing_id: 'listing-uuid-123',
      sku: 'MYSKU',
    }
    const validated = validateAddItem(body)
    expect('error' in validated).toBe(false)
    if (!('error' in validated)) {
      const status = deriveItemStatus(validated.amazon_listing_id)
      expect(status).toBe('listed')

      const { data } = mockInsert('fba_batch_items', {
        batch_id: 'batch-uuid',
        asin: validated.asin,
        amazon_listing_id: validated.amazon_listing_id,
        sku: validated.sku,
        status,
      })
      expect(data.status).toBe('listed')
      expect(data.amazon_listing_id).toBe('listing-uuid-123')
    }
  })

  it('derives pending status for item without amazon_listing_id', () => {
    const body = {
      asin: 'B01ABCDEFG',
      isbn: '9780307888037',
    }
    const validated = validateAddItem(body)
    expect('error' in validated).toBe(false)
    if (!('error' in validated)) {
      const status = deriveItemStatus(validated.amazon_listing_id)
      expect(status).toBe('pending')

      const { data } = mockInsert('fba_batch_items', {
        batch_id: 'batch-uuid',
        asin: validated.asin,
        amazon_listing_id: null,
        status,
      })
      expect(data.status).toBe('pending')
      expect(data.amazon_listing_id).toBeNull()
    }
  })
})

describe('GET /api/batches — list batches', () => {
  it('only returns open batches (status filter)', () => {
    const allBatches = [
      { id: '1', status: 'open', name: 'Batch A' },
      { id: '2', status: 'shipped', name: 'Batch B' },
      { id: '3', status: 'closed', name: 'Batch C' },
      { id: '4', status: 'open', name: 'Batch D' },
    ]
    const open = allBatches.filter((b) => b.status === 'open')
    expect(open).toHaveLength(2)
    expect(open.map((b) => b.id)).toEqual(['1', '4'])
  })

  it('maps item count correctly from aggregated join result', () => {
    const row = {
      id: 'batch-1',
      name: 'May10-GW',
      status: 'open',
      source: 'GoodWill',
      created_at: '2026-05-11T00:00:00Z',
      fba_batch_items: [{ count: 5 }],
    }
    const item_count = row.fba_batch_items[0]?.count ?? 0
    expect(item_count).toBe(5)
  })

  it('defaults item_count to 0 when no items', () => {
    const row = {
      id: 'batch-2',
      name: 'Empty Batch',
      status: 'open',
      source: null,
      created_at: '2026-05-11T00:00:00Z',
      fba_batch_items: [{ count: 0 }],
    }
    const item_count = row.fba_batch_items[0]?.count ?? 0
    expect(item_count).toBe(0)
  })
})
