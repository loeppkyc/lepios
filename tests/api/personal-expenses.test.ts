/**
 * Tests for app/api/personal-expenses/route.ts.
 *
 * Validates:
 *   - Auth: no auth check on this endpoint (public-ish, reads from sheets)
 *     — but we test sheet-read failure handling
 *   - v1 backwards-compat: headers, rows, categoryTotals, grandTotal still present
 *   - v2: combinedRows, categories, totals fields present
 *   - Megan sheet absence is tolerated (Colin-only data still returned)
 *   - Person tagging on categories
 *   - Combined math: row.total = colin + megan
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockReadOsSheet } = vi.hoisted(() => ({
  mockReadOsSheet: vi.fn(),
}))

vi.mock('@/lib/sheets/client', () => ({
  readOsSheet: mockReadOsSheet,
  parseDollar: (val: string | undefined): number => {
    if (!val || val === '$-' || val === '-' || val.trim() === '') return 0
    const negative = val.startsWith('-') || val.startsWith('(')
    const cleaned = val.replace(/[^0-9.]/g, '')
    if (!cleaned) return 0
    const n = parseFloat(cleaned)
    if (!Number.isFinite(n)) return 0
    return negative ? -n : n
  },
}))

import { GET } from '@/app/api/personal-expenses/route'

beforeEach(() => {
  mockReadOsSheet.mockReset()
})

function colinSheet(): string[][] {
  return [
    ['PERSONAL EXPENSES 2026 — COLIN LOEPPKY'],
    [],
    ['Month', 'Bell Mobility', 'Electricity', 'Groceries', 'Total'],
    ['January 2026', '$121.05', '$121.34', '$1,019.27', '$1,261.66'],
    ['February 2026', '$0.00', '$117.62', '$545.87', '$663.49'],
  ]
}

function meganSheet(): string[][] {
  return [
    ['MEGAN EXPENSES 2026'],
    [],
    ['Month', 'Rent', 'Cora Ninja Class', 'Mom Debt Payment', 'Total Expenditure'],
    ['January 2026', '$2,095.00', '$145.00', '$400.00', '$2,640.00'],
    ['February 2026', '$2,095.00', '$145.00', '$400.00', '$2,640.00'],
  ]
}

function req(year = 2026): Request {
  return new Request(`http://localhost/api/personal-expenses?year=${year}`)
}

describe('GET /api/personal-expenses — sheet read errors', () => {
  it('500-equivalent (502) when Colin sheet fails', async () => {
    mockReadOsSheet.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req(2026))
    expect(res.status).toBe(502)
  })

  it('rejects unconfigured year', async () => {
    const res = await GET(req(2020))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/personal-expenses — Colin only (Megan sheet missing)', () => {
  it('returns Colin data when Megan sheet read fails', async () => {
    mockReadOsSheet
      .mockResolvedValueOnce(colinSheet())
      .mockRejectedValueOnce(new Error('Megan sheet 404'))
    const res = await GET(req(2026))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals.colin).toBeGreaterThan(0)
    expect(body.totals.megan).toBe(0)
    expect(body.categories.every((c: { person: string }) => c.person === 'colin')).toBe(true)
  })
})

describe('GET /api/personal-expenses — combined Colin + Megan', () => {
  beforeEach(() => {
    mockReadOsSheet.mockResolvedValueOnce(colinSheet()).mockResolvedValueOnce(meganSheet())
  })

  it('combined row.total = colin + megan', async () => {
    const res = await GET(req(2026))
    const body = await res.json()
    const jan = body.combinedRows.find((r: { month: string }) => r.month === 'January 2026')
    expect(jan).toBeDefined()
    expect(jan.colin).toBeCloseTo(121.05 + 121.34 + 1019.27, 2)
    expect(jan.megan).toBeCloseTo(2095 + 145 + 400, 2)
    expect(jan.total).toBeCloseTo(jan.colin + jan.megan, 2)
  })

  it('categories tagged by person', async () => {
    const res = await GET(req(2026))
    const body = await res.json()
    const colinCats = body.categories.filter((c: { person: string }) => c.person === 'colin')
    const meganCats = body.categories.filter((c: { person: string }) => c.person === 'megan')
    expect(colinCats.length).toBeGreaterThan(0)
    expect(meganCats.length).toBeGreaterThan(0)
    expect(colinCats.some((c: { name: string }) => c.name === 'Groceries')).toBe(true)
    expect(meganCats.some((c: { name: string }) => c.name === 'Rent')).toBe(true)
  })

  it('totals.combined = totals.colin + totals.megan', async () => {
    const res = await GET(req(2026))
    const body = await res.json()
    expect(body.totals.combined).toBeCloseTo(body.totals.colin + body.totals.megan, 2)
  })

  it('preserves v1 fields (headers, rows, categoryTotals, grandTotal)', async () => {
    const res = await GET(req(2026))
    const body = await res.json()
    expect(Array.isArray(body.headers)).toBe(true)
    expect(Array.isArray(body.rows)).toBe(true)
    expect(typeof body.categoryTotals).toBe('object')
    expect(typeof body.grandTotal).toBe('number')
    // v1 should match Colin only (totals.colin)
    expect(body.grandTotal).toBeCloseTo(body.totals.colin, 2)
  })

  it('Megan rent shows up in monthly per-month breakdown with person prefix', async () => {
    const res = await GET(req(2026))
    const body = await res.json()
    const jan = body.combinedRows.find((r: { month: string }) => r.month === 'January 2026')
    expect(jan.categories['megan|Rent']).toBeCloseTo(2095, 2)
    expect(jan.categories['colin|Groceries']).toBeCloseTo(1019.27, 2)
  })
})
