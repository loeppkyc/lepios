/**
 * Tests for app/api/bookkeeping/reconcile/route.ts (GET queue) and
 * app/api/bookkeeping/reconcile/reject/route.ts (POST reject).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET as queueGET } from '@/app/api/bookkeeping/reconcile/route'
import { POST as rejectPOST } from '@/app/api/bookkeeping/reconcile/reject/route'

beforeEach(() => {
  mockFrom.mockReset()
})

// ---- GET /api/bookkeeping/reconcile ----

describe('GET /api/bookkeeping/reconcile', () => {
  it('returns pending list + accounts list + count', async () => {
    const pending = [
      {
        id: 'p1',
        txn_date: '2026-04-02',
        source_account: 'TD CHEQUING (9150)',
        description: 'PAYPAL MSP',
        amount_signed: -49.55,
        vendor_extracted: null,
        suggested_expense_account: 'Subcontractors',
        suggested_gst_rate: 0,
        suggested_business_use_pct: 100,
        confidence: 85,
        matched_rule_id: 'r1',
      },
    ]
    const rules = [{ id: 'r1', rule_name: 'PayPal MSP' }]
    const accounts = [
      { full_name: 'Subcontractors', qb_type: 'Expenses' },
      { full_name: 'OFFICE EXPENSES', qb_type: 'Expenses' },
    ]

    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: pending, error: null }),
            }),
          }),
        }
      }
      if (table === 'vendor_rules') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: rules, error: null }),
          }),
        }
      }
      if (table === 'chart_of_accounts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: accounts, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await queueGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      pending: Array<{ id: string; matched_rule_name: string | null }>
      accounts: Array<{ full_name: string }>
      totalNeedsReview: number
    }
    expect(body.totalNeedsReview).toBe(1)
    expect(body.pending[0].id).toBe('p1')
    expect(body.pending[0].matched_rule_name).toBe('PayPal MSP')
    expect(body.accounts).toHaveLength(2)
  })

  it('returns empty list when nothing is pending', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'chart_of_accounts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await queueGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { totalNeedsReview: number; pending: unknown[] }
    expect(body.totalNeedsReview).toBe(0)
    expect(body.pending).toEqual([])
  })
})

// ---- POST /api/bookkeeping/reconcile/reject ----

function rejectReq(body: unknown): Request {
  return new Request('http://localhost/api/bookkeeping/reconcile/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/bookkeeping/reconcile/reject', () => {
  it('returns 400 when body is invalid JSON', async () => {
    const res = await rejectPOST(rejectReq('not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when reason is missing', async () => {
    const res = await rejectPOST(rejectReq({ id: 'a', reason: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when reason is whitespace only', async () => {
    const res = await rejectPOST(rejectReq({ id: 'a', reason: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when txn not found', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
            }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await rejectPOST(rejectReq({ id: 'missing', reason: 'because' }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when txn is already rejected', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: 'a', status: 'rejected' }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await rejectPOST(rejectReq({ id: 'a', reason: 'already rejected' }))
    expect(res.status).toBe(409)
  })

  it('marks the txn rejected with reason and timestamp', async () => {
    const captured: Record<string, unknown>[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'pending_transactions') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'a', status: 'needs_review' }, error: null }),
            }),
          }),
          update: (row: Record<string, unknown>) => ({
            eq: () => {
              captured.push(row)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await rejectPOST(rejectReq({ id: 'a', reason: 'duplicate' }))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
    expect(captured[0].status).toBe('rejected')
    expect(captured[0].review_notes).toBe('duplicate')
    expect(typeof captured[0].reviewed_at).toBe('string')
  })
})
