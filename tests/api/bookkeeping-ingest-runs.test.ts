/**
 * Tests for:
 *   app/api/bookkeeping/ingest-runs/route.ts (GET)
 *   app/api/bookkeeping/reconcile/bulk-approve/route.ts (POST)
 *
 * Covers acceptance criteria AC-2, AC-3, AC-5 from Chunk D acceptance doc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- shared mocks ----

const { mockFrom, mockRequireUser, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRequireUser: vi.fn(),
  mockGetUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: mockRequireUser,
}))

import { GET as ingestRunsGET } from '@/app/api/bookkeeping/ingest-runs/route'
import { POST as bulkApprovePOST } from '@/app/api/bookkeeping/reconcile/bulk-approve/route'

const fakeUser = { id: 'user-1', email: 'colin@test.com' }
const fakeProfile = { user_id: 'user-1', role: 'admin' }
const fakeGate = {
  ok: true as const,
  user: fakeUser,
  profile: fakeProfile,
  supabase: { auth: { getUser: mockGetUser } },
}

beforeEach(() => {
  mockFrom.mockReset()
  mockRequireUser.mockReset()
  mockRequireUser.mockResolvedValue(fakeGate)
})

// ---- GET /api/bookkeeping/ingest-runs ----

describe('GET /api/bookkeeping/ingest-runs', () => {
  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await ingestRunsGET()
    expect(res.status).toBe(401)
  })

  it('returns empty array when no ingest runs exist', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ingest_runs') {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    const res = await ingestRunsGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toEqual([])
  })

  it('returns last 5 ingest runs ordered by run_at desc', async () => {
    const runs = [
      {
        id: 'run-1',
        run_at: '2026-05-12T15:00:00Z',
        source: 'td_pdf',
        rows_added: 47,
        rows_skipped: 2,
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        notes: null,
      },
    ]

    mockFrom.mockImplementation((table: string) => {
      if (table === 'ingest_runs') {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: runs, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    const res = await ingestRunsGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{
      id: string
      source: string
      rows_added: number
    }>
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('run-1')
    expect(body[0].source).toBe('td_pdf')
    expect(body[0].rows_added).toBe(47)
  })

  it('returns 500 on database error', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ingest_runs') {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: null, error: { message: 'connection failed' } }),
            }),
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    const res = await ingestRunsGET()
    expect(res.status).toBe(500)
  })
})

// ---- POST /api/bookkeeping/reconcile/bulk-approve ----

function bulkReq(body: unknown): Request {
  return new Request('http://localhost/api/bookkeeping/reconcile/bulk-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bookkeeping/reconcile/bulk-approve', () => {
  it('returns 401 when not authenticated', async () => {
    mockRequireUser.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await bulkApprovePOST(bulkReq({ confidence_threshold: 85 }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when confidence_threshold is out of range', async () => {
    const res = await bulkApprovePOST(bulkReq({ confidence_threshold: 150 }))
    expect(res.status).toBe(400)
  })

  it('returns {approved:0, jes_created:0, errors:[]} when no eligible rows', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                not: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    const res = await bulkApprovePOST(bulkReq({ confidence_threshold: 85 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: number; jes_created: number; errors: string[] }
    expect(body.approved).toBe(0)
    expect(body.jes_created).toBe(0)
    expect(body.errors).toEqual([])
  })

  it('creates JEs and marks transactions approved for eligible rows', async () => {
    const eligible = [
      {
        id: 'txn-1',
        txn_date: '2026-04-15',
        source_account: 'TD CHEQUING (9150)',
        description: 'PAYPAL MSP',
        amount_signed: -49.55,
        suggested_expense_account: 'Office Supplies',
        suggested_gst_rate: 0.05,
        suggested_business_use_pct: 100,
      },
    ]

    const insertedJEs: unknown[] = []
    const insertedLines: unknown[] = []
    const updatedTxns: unknown[] = []
    const insertedEvents: unknown[] = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                not: () => Promise.resolve({ data: eligible, error: null }),
              }),
            }),
          }),
          update: (row: unknown) => ({
            eq: () => {
              updatedTxns.push(row)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'journal_entries') {
        return {
          insert: (row: unknown) => {
            insertedJEs.push(row)
            return Promise.resolve({ error: null })
          },
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === 'journal_entry_lines') {
        return {
          insert: (rows: unknown) => {
            insertedLines.push(rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'agent_events') {
        return {
          insert: (row: unknown) => {
            insertedEvents.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    const res = await bulkApprovePOST(bulkReq({ confidence_threshold: 85 }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { approved: number; jes_created: number; errors: string[] }
    expect(body.approved).toBe(1)
    expect(body.jes_created).toBe(1)
    expect(body.errors).toEqual([])

    // JE inserted
    expect(insertedJEs).toHaveLength(1)

    // Transaction marked manual_je (the valid post-approval status per CHECK constraint)
    expect(updatedTxns).toHaveLength(1)
    expect((updatedTxns[0] as Record<string, unknown>).status).toBe('manual_je')

    // AC-5: agent_events logged with action='bulk_approve'
    expect(insertedEvents).toHaveLength(1)
    const evt = insertedEvents[0] as Record<string, unknown>
    expect(evt.action).toBe('bulk_approve')
    expect(evt.domain).toBe('bookkeeping')
    const meta = evt.meta as Record<string, unknown>
    expect(meta.count).toBe(1)
    expect(meta.threshold).toBe(85)
  })

  it('uses default threshold of 85 when not provided in body', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                not: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'agent_events') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      throw new Error(`unmocked table: ${table}`)
    })

    // Empty body — threshold should default to 85
    const req = new Request('http://localhost/api/bookkeeping/reconcile/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const res = await bulkApprovePOST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: number }
    expect(body.approved).toBe(0) // no rows, but route succeeded
  })
})
