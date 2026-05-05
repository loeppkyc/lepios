/**
 * Tests for app/api/bookkeeping/qb-export/route.ts (GET) and
 * app/api/bookkeeping/qb-export/mark/route.ts (POST).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET as qbGET } from '@/app/api/bookkeeping/qb-export/route'
import { POST as markPOST } from '@/app/api/bookkeeping/qb-export/mark/route'

beforeEach(() => {
  mockFrom.mockReset()
})

const SAMPLE_JES = [
  {
    id: 'je-1',
    je_number: 'AUTO-20260402-abcd12',
    je_date: '2026-04-02',
    name: 'PayPal MSP',
    description: 'PAYPAL MSP',
    total_debit: 50,
    total_credit: 50,
    exported_to_qb_at: null,
  },
  {
    id: 'je-2',
    je_number: 'AUTO-20260413-deadbe',
    je_date: '2026-04-13',
    name: 'Capital One MC',
    description: 'CAPTL ONE MC U7U6X5',
    total_debit: 966.36,
    total_credit: 966.36,
    exported_to_qb_at: null,
  },
]

const SAMPLE_LINES = [
  {
    journal_entry_id: 'je-1',
    line_no: 1,
    account_full_name: 'Subcontractors',
    description: 'PAYPAL MSP',
    debit: 47.19,
    credit: 0,
  },
  {
    journal_entry_id: 'je-1',
    line_no: 2,
    account_full_name: 'GST/HST Payable',
    description: null,
    debit: 2.81,
    credit: 0,
  },
  {
    journal_entry_id: 'je-1',
    line_no: 3,
    account_full_name: 'TD CHEQUING (9150)',
    description: 'PAYPAL MSP',
    debit: 0,
    credit: 50,
  },
  {
    journal_entry_id: 'je-2',
    line_no: 1,
    account_full_name: "Owner's Equity:Owner's Draw",
    description: 'CAPTL ONE MC',
    debit: 966.36,
    credit: 0,
  },
  {
    journal_entry_id: 'je-2',
    line_no: 2,
    account_full_name: 'TD CHEQUING (9150)',
    description: 'CAPTL ONE MC',
    debit: 0,
    credit: 966.36,
  },
]

function makeJeQueryChain(data: unknown[], opts: { withIs: boolean; withFromTo?: boolean }) {
  // Replicates the supabase chain in app/api/bookkeeping/qb-export/route.ts:
  //   .from(...).select(...).eq(...).order(...).order(...)  optionally .is(...).gte(...).lte(...)
  // The route assigns to a `query` var and conditionally chains .is/.gte/.lte before awaiting.
  // We just need any terminal to resolve with our data.
  const terminal = Promise.resolve({ data, error: null }) as unknown as {
    then: Promise<{ data: unknown[]; error: null }>['then']
    is: () => typeof terminal
    gte: () => typeof terminal
    lte: () => typeof terminal
  }
  // Add chainable .is/.gte/.lte that all return the same terminal promise
  ;(terminal as unknown as { is: () => unknown }).is = () => terminal
  ;(terminal as unknown as { gte: () => unknown }).gte = () => terminal
  ;(terminal as unknown as { lte: () => unknown }).lte = () => terminal
  return terminal
}

function jeMock(data: unknown[]) {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({
          order: () => makeJeQueryChain(data, { withIs: true, withFromTo: true }),
        }),
      }),
    }),
  }
}

function jelMock(data: unknown[]) {
  return {
    select: () => ({
      in: () => ({
        order: () => ({
          order: () => Promise.resolve({ data, error: null }),
        }),
      }),
    }),
  }
}

// ---- GET /api/bookkeeping/qb-export (JSON summary) ----

describe('GET /api/bookkeeping/qb-export — summary mode', () => {
  it('returns count, total, range, and JE list', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') return jeMock(SAMPLE_JES)
      throw new Error(`unmocked: ${table}`)
    })

    const res = await qbGET(new Request('http://localhost/api/bookkeeping/qb-export'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      unexportedCount: number
      unexportedTotal: number
      earliestDate: string
      latestDate: string
      jes: Array<{ id: string }>
    }
    expect(body.unexportedCount).toBe(2)
    expect(body.unexportedTotal).toBe(1016.36)
    expect(body.earliestDate).toBe('2026-04-02')
    expect(body.latestDate).toBe('2026-04-13')
    expect(body.jes).toHaveLength(2)
  })

  it('returns zeros when nothing pending', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') return jeMock([])
      throw new Error(`unmocked: ${table}`)
    })

    const res = await qbGET(new Request('http://localhost/api/bookkeeping/qb-export'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      unexportedCount: number
      unexportedTotal: number
      earliestDate: string | null
    }
    expect(body.unexportedCount).toBe(0)
    expect(body.unexportedTotal).toBe(0)
    expect(body.earliestDate).toBeNull()
  })
})

// ---- GET /api/bookkeeping/qb-export?format=csv ----

describe('GET /api/bookkeeping/qb-export — CSV mode', () => {
  it('returns CSV with QBO header and one row per JE line', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') return jeMock(SAMPLE_JES)
      if (table === 'journal_entry_lines') return jelMock(SAMPLE_LINES)
      throw new Error(`unmocked: ${table}`)
    })

    const res = await qbGET(new Request('http://localhost/api/bookkeeping/qb-export?format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toMatch(/lepios-qb-export-/)
    expect(res.headers.get('X-Lepios-Je-Ids')).toBe('je-1,je-2')

    const csv = await res.text()
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('*JournalNo,*Date,*Account,*Debits,*Credits,Description,Name')
    // 5 sample lines + 1 header = 6 rows
    expect(lines).toHaveLength(6)
    // Date format = MM/DD/YYYY
    expect(lines[1]).toContain('04/02/2026')
    expect(lines[1]).toContain('Subcontractors')
    expect(lines[1]).toContain('47.19')
  })

  it('returns header-only CSV when nothing pending', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') return jeMock([])
      throw new Error(`unmocked: ${table}`)
    })

    const res = await qbGET(new Request('http://localhost/api/bookkeeping/qb-export?format=csv'))
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('*JournalNo,*Date,*Account,*Debits,*Credits,Description,Name')
    expect(csv.trim().split('\n')).toHaveLength(1)
  })

  it('escapes CSV special chars (quotes, commas)', async () => {
    const trickyLines = [
      {
        journal_entry_id: 'je-1',
        line_no: 1,
        account_full_name: 'OFFICE',
        description: 'desc, with comma',
        debit: 100,
        credit: 0,
      },
      {
        journal_entry_id: 'je-1',
        line_no: 2,
        account_full_name: 'TD CHEQUING (9150)',
        description: 'has "quotes"',
        debit: 0,
        credit: 100,
      },
    ]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') return jeMock([SAMPLE_JES[0]])
      if (table === 'journal_entry_lines') return jelMock(trickyLines)
      throw new Error(`unmocked: ${table}`)
    })

    const res = await qbGET(new Request('http://localhost/api/bookkeeping/qb-export?format=csv'))
    const csv = await res.text()
    expect(csv).toContain('"desc, with comma"')
    expect(csv).toContain('"has ""quotes"""')
  })
})

// ---- POST /api/bookkeeping/qb-export/mark ----

function markReq(body: unknown): Request {
  return new Request('http://localhost/api/bookkeeping/qb-export/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/bookkeeping/qb-export/mark', () => {
  it('returns 400 when body is invalid JSON', async () => {
    const res = await markPOST(markReq('not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when je_ids array is empty', async () => {
    const res = await markPOST(markReq({ je_ids: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when je_ids is not an array', async () => {
    const res = await markPOST(markReq({ je_ids: 'not array' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when je_ids exceeds 5000', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `id-${i}`)
    const res = await markPOST(markReq({ je_ids: ids }))
    expect(res.status).toBe(400)
  })

  it('marks JEs as exported with timestamp + batch', async () => {
    const captured: Record<string, unknown>[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') {
        return {
          update: (row: Record<string, unknown>) => {
            captured.push(row)
            return {
              in: () => ({
                eq: () => ({
                  is: () => ({
                    select: () =>
                      Promise.resolve({ data: [{ id: 'je-1' }, { id: 'je-2' }], error: null }),
                  }),
                }),
              }),
            }
          },
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await markPOST(markReq({ je_ids: ['je-1', 'je-2'] }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      marked: number
      batch: string
      exported_at: string
    }
    expect(body.ok).toBe(true)
    expect(body.marked).toBe(2)
    expect(body.batch).toMatch(/^manual-/)
    expect(captured[0].exported_to_qb_at).toBeTruthy()
    expect(captured[0].exported_to_qb_batch).toBeTruthy()
  })

  it('honors custom batch label', async () => {
    const captured: Record<string, unknown>[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') {
        return {
          update: (row: Record<string, unknown>) => {
            captured.push(row)
            return {
              in: () => ({
                eq: () => ({
                  is: () => ({
                    select: () => Promise.resolve({ data: [{ id: 'je-1' }], error: null }),
                  }),
                }),
              }),
            }
          },
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await markPOST(markReq({ je_ids: ['je-1'], batch: 'april-q1-export' }))
    expect(res.status).toBe(200)
    expect(captured[0].exported_to_qb_batch).toBe('april-q1-export')
  })

  it('unmark mode clears exported_to_qb_at', async () => {
    const captured: Record<string, unknown>[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'journal_entries') {
        return {
          update: (row: Record<string, unknown>) => {
            captured.push(row)
            return {
              in: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const res = await markPOST(markReq({ je_ids: ['je-1'], unmark: true }))
    expect(res.status).toBe(200)
    expect(captured[0].exported_to_qb_at).toBeNull()
    expect(captured[0].exported_to_qb_batch).toBeNull()
  })
})
