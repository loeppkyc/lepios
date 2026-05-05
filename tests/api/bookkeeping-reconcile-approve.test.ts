/**
 * Tests for app/api/bookkeeping/reconcile/approve/route.ts.
 *
 * The approve endpoint converts a needs_review pending_transactions row into
 * a double-entry journal_entry + lines, mirroring scripts/bookkeeping/ingest-bank-csv.py.
 * Tests validate: input validation, JE math (GST split), status transition,
 * optional vendor_rule learning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/bookkeeping/reconcile/approve/route'

interface TableState {
  pending_transactions?: {
    txn?: Record<string, unknown> | null
    updateError?: { message: string } | null
    captured?: { update?: Record<string, unknown>; eq?: { col: string; value: unknown } }[]
  }
  chart_of_accounts?: {
    accounts: { full_name: string }[]
  }
  journal_entries?: {
    insertError?: { message: string } | null
    captured?: Record<string, unknown>[]
    deleteCalled?: boolean
  }
  journal_entry_lines?: {
    insertError?: { message: string } | null
    captured?: Record<string, unknown>[][]
  }
  vendor_rules?: {
    insert?: Record<string, unknown> | null
    insertError?: { message: string } | null
    captured?: Record<string, unknown>[]
  }
}

function buildMockFrom(state: TableState) {
  return (table: string) => {
    if (table === 'pending_transactions') {
      const ptState = state.pending_transactions ?? {}
      ptState.captured = ptState.captured ?? []
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: ptState.txn ?? null,
                error: ptState.txn ? null : { message: 'not found' },
              }),
          }),
        }),
        update: (row: Record<string, unknown>) => ({
          eq: (col: string, value: unknown) => {
            ptState.captured!.push({ update: row, eq: { col, value } })
            return Promise.resolve({ error: ptState.updateError ?? null })
          },
        }),
      }
    }
    if (table === 'chart_of_accounts') {
      const accs = state.chart_of_accounts?.accounts ?? []
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => {
                // eq() chain assumed to filter on full_name + is_active; return first match
                return Promise.resolve({ data: accs[0] ?? null, error: null })
              },
            }),
          }),
        }),
      }
    }
    if (table === 'journal_entries') {
      const jeState = state.journal_entries ?? {}
      jeState.captured = jeState.captured ?? []
      return {
        insert: (row: Record<string, unknown>) => {
          jeState.captured!.push(row)
          return Promise.resolve({ error: jeState.insertError ?? null })
        },
        delete: () => ({
          eq: () => {
            jeState.deleteCalled = true
            return Promise.resolve({ error: null })
          },
        }),
      }
    }
    if (table === 'journal_entry_lines') {
      const jelState = state.journal_entry_lines ?? {}
      jelState.captured = jelState.captured ?? []
      return {
        insert: (rows: Record<string, unknown>[]) => {
          jelState.captured!.push(rows)
          return Promise.resolve({ error: jelState.insertError ?? null })
        },
      }
    }
    if (table === 'vendor_rules') {
      const vrState = state.vendor_rules ?? {}
      vrState.captured = vrState.captured ?? []
      return {
        insert: (row: Record<string, unknown>) => {
          vrState.captured!.push(row)
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: vrState.insert ?? null,
                  error: vrState.insertError ?? (vrState.insert ? null : { message: 'no rule' }),
                }),
            }),
          }
        },
      }
    }
    throw new Error(`unmocked table: ${table}`)
  }
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/bookkeeping/reconcile/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockFrom.mockReset()
})

describe('POST /api/bookkeeping/reconcile/approve — input validation', () => {
  it('returns 400 when id is missing', async () => {
    mockFrom.mockImplementation(buildMockFrom({}))
    const res = await POST(
      postReq({ expense_account: 'SOFTWARE', gst_rate: 0.05, business_use_pct: 100 })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when expense_account is missing', async () => {
    mockFrom.mockImplementation(buildMockFrom({}))
    const res = await POST(postReq({ id: 'abc', gst_rate: 0.05, business_use_pct: 100 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when gst_rate is out of range', async () => {
    mockFrom.mockImplementation(buildMockFrom({}))
    const res = await POST(
      postReq({ id: 'a', expense_account: 'X', gst_rate: 0.6, business_use_pct: 100 })
    )
    expect(res.status).toBe(400)
    const res2 = await POST(
      postReq({ id: 'a', expense_account: 'X', gst_rate: -0.05, business_use_pct: 100 })
    )
    expect(res2.status).toBe(400)
  })

  it('returns 400 when body is not valid JSON', async () => {
    mockFrom.mockImplementation(buildMockFrom({}))
    const res = await POST(
      new Request('http://localhost/api/bookkeeping/reconcile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/bookkeeping/reconcile/approve — txn lookup', () => {
  it('returns 404 when txn not found', async () => {
    mockFrom.mockImplementation(
      buildMockFrom({
        pending_transactions: { txn: null },
      })
    )
    const res = await POST(
      postReq({ id: 'missing', expense_account: 'X', gst_rate: 0.05, business_use_pct: 100 })
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 when txn is already approved', async () => {
    mockFrom.mockImplementation(
      buildMockFrom({
        pending_transactions: {
          txn: {
            id: 'a',
            txn_date: '2026-04-02',
            source_account: 'TD CHEQUING (9150)',
            description: 'PAYPAL MSP',
            amount_signed: -49.55,
            status: 'approved',
            matched_rule_id: null,
            suggested_expense_account: null,
          },
        },
      })
    )
    const res = await POST(
      postReq({ id: 'a', expense_account: 'Subcontractors', gst_rate: 0.05, business_use_pct: 100 })
    )
    expect(res.status).toBe(409)
  })

  it('returns 400 when expense_account is not in chart_of_accounts', async () => {
    mockFrom.mockImplementation(
      buildMockFrom({
        pending_transactions: {
          txn: {
            id: 'a',
            txn_date: '2026-04-02',
            source_account: 'TD CHEQUING (9150)',
            description: 'PAYPAL MSP',
            amount_signed: -49.55,
            status: 'needs_review',
            matched_rule_id: null,
            suggested_expense_account: null,
          },
        },
        chart_of_accounts: { accounts: [] },
      })
    )
    const res = await POST(
      postReq({ id: 'a', expense_account: 'BOGUS', gst_rate: 0.05, business_use_pct: 100 })
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/bookkeeping/reconcile/approve — JE construction (money out)', () => {
  it('builds 3-line JE with GST split for an expense at 5%', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'a',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'OFFICE STORE',
          amount_signed: -105,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'OFFICE EXPENSES' }] },
      journal_entries: {},
      journal_entry_lines: {},
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({
        id: 'a',
        expense_account: 'OFFICE EXPENSES',
        gst_rate: 0.05,
        business_use_pct: 100,
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; je_id: string; total: number; lines: number }
    expect(body.ok).toBe(true)
    expect(body.lines).toBe(3)
    expect(body.total).toBe(105)

    const lines = state.journal_entry_lines!.captured![0] as Array<{
      account_full_name: string
      debit: number
      credit: number
      line_no: number
    }>
    // Line 1: DR OFFICE EXPENSES pretax (=100)
    expect(lines[0].account_full_name).toBe('OFFICE EXPENSES')
    expect(lines[0].debit).toBe(100)
    expect(lines[0].credit).toBe(0)
    // Line 2: DR GST/HST Payable (=5)
    expect(lines[1].account_full_name).toBe('GST/HST Payable')
    expect(lines[1].debit).toBe(5)
    expect(lines[1].credit).toBe(0)
    // Line 3: CR TD CHEQUING (=105)
    expect(lines[2].account_full_name).toBe('TD CHEQUING (9150)')
    expect(lines[2].debit).toBe(0)
    expect(lines[2].credit).toBe(105)
  })

  it('builds 2-line JE with no GST line at 0%', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'b',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'CRA PAYMENT',
          amount_signed: -2000,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'GST/HST Suspense' }] },
      journal_entries: {},
      journal_entry_lines: {},
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({ id: 'b', expense_account: 'GST/HST Suspense', gst_rate: 0, business_use_pct: 100 })
    )
    expect(res.status).toBe(200)
    const lines = state.journal_entry_lines!.captured![0] as Array<{
      account_full_name: string
      debit: number
      credit: number
    }>
    expect(lines).toHaveLength(2)
    expect(lines[0].debit).toBe(2000)
    expect(lines[1].credit).toBe(2000)
  })

  it('flips sign convention for incoming money (deposit)', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'c',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'GST REFUND',
          amount_signed: 220.5, // positive = deposit
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: "Owner's Equity" }] },
      journal_entries: {},
      journal_entry_lines: {},
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({ id: 'c', expense_account: "Owner's Equity", gst_rate: 0, business_use_pct: 100 })
    )
    expect(res.status).toBe(200)
    const lines = state.journal_entry_lines!.captured![0] as Array<{
      account_full_name: string
      debit: number
      credit: number
    }>
    // Money in: DR source, CR account
    expect(lines[0].account_full_name).toBe('TD CHEQUING (9150)')
    expect(lines[0].debit).toBe(220.5)
    expect(lines[1].account_full_name).toBe("Owner's Equity")
    expect(lines[1].credit).toBe(220.5)
  })

  it('handles 13% HST split correctly', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'd',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'HST VENDOR',
          amount_signed: -113,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'OFFICE EXPENSES' }] },
      journal_entries: {},
      journal_entry_lines: {},
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({
        id: 'd',
        expense_account: 'OFFICE EXPENSES',
        gst_rate: 0.13,
        business_use_pct: 100,
      })
    )
    expect(res.status).toBe(200)
    const lines = state.journal_entry_lines!.captured![0] as Array<{
      debit: number
      credit: number
      account_full_name: string
    }>
    // pretax = 113 / 1.13 = 100; gst = 13
    expect(lines[0].debit).toBe(100)
    expect(lines[1].debit).toBe(13)
    expect(lines[2].credit).toBe(113)
  })
})

describe('POST /api/bookkeeping/reconcile/approve — rule learning', () => {
  it('inserts a vendor_rules row when learn_rule is provided', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'e',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'NEW VENDOR XYZ',
          amount_signed: -50,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'SOFTWARE' }] },
      journal_entries: {},
      journal_entry_lines: {},
      vendor_rules: { insert: { id: 'rule-id-1', rule_name: 'NEW VENDOR' } },
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({
        id: 'e',
        expense_account: 'SOFTWARE',
        gst_rate: 0.05,
        business_use_pct: 100,
        learn_rule: {
          rule_name: 'NEW VENDOR',
          match_pattern: 'NEW VENDOR',
          match_type: 'contains',
        },
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ruleCreated: { id: string } | null }
    expect(body.ruleCreated).toEqual({ id: 'rule-id-1', rule_name: 'NEW VENDOR' })

    const captured = state.vendor_rules!.captured![0]
    expect(captured.rule_name).toBe('NEW VENDOR')
    expect(captured.match_pattern).toBe('NEW VENDOR')
    expect(captured.match_type).toBe('contains')
    expect(captured.expense_account).toBe('SOFTWARE')
    expect(captured.source_account).toBe('TD CHEQUING (9150)')
    expect(captured.source).toBe('auto_learned')
  })

  it('does not insert rule when learn_rule is null', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'f',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'KNOWN VENDOR',
          amount_signed: -50,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'SOFTWARE' }] },
      journal_entries: {},
      journal_entry_lines: {},
      vendor_rules: { captured: [] },
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({
        id: 'f',
        expense_account: 'SOFTWARE',
        gst_rate: 0.05,
        business_use_pct: 100,
        learn_rule: null,
      })
    )
    expect(res.status).toBe(200)
    expect(state.vendor_rules!.captured).toEqual([])
  })
})

describe('POST /api/bookkeeping/reconcile/approve — error rollback', () => {
  it('rolls back JE insert when line insert fails', async () => {
    const state: TableState = {
      pending_transactions: {
        txn: {
          id: 'g',
          txn_date: '2026-04-02',
          source_account: 'TD CHEQUING (9150)',
          description: 'X',
          amount_signed: -50,
          status: 'needs_review',
          matched_rule_id: null,
          suggested_expense_account: null,
        },
      },
      chart_of_accounts: { accounts: [{ full_name: 'SOFTWARE' }] },
      journal_entries: {},
      journal_entry_lines: { insertError: { message: 'lines failed' } },
    }
    mockFrom.mockImplementation(buildMockFrom(state))

    const res = await POST(
      postReq({ id: 'g', expense_account: 'SOFTWARE', gst_rate: 0.05, business_use_pct: 100 })
    )
    expect(res.status).toBe(500)
    expect(state.journal_entries!.deleteCalled).toBe(true)
  })
})
