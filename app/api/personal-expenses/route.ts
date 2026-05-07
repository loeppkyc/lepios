import { NextResponse } from 'next/server'
import { readOsSheet, parseDollar } from '@/lib/sheets/client'

export const revalidate = 3600

// Sheet names per year
const COLIN_SHEET_NAMES: Record<number, string> = {
  2026: '💰 Personal Expenses',
  2025: '💰 Personal Expenses 2025',
}

const MEGAN_SHEET_NAMES: Record<number, string> = {
  2026: 'Megan Expenses 2026',
  // Megan 2025 sheet not yet available
}

export type Person = 'colin' | 'megan'

export interface CategoryTotal {
  name: string
  person: Person
  total: number
}

export interface MonthRow {
  month: string
  colin: number
  megan: number
  total: number
  // Per-category breakdown for that month, keyed by `${person}|${category}`
  categories: Record<string, number>
}

export interface PersonalExpensesResponse {
  year: number
  // Existing v1 fields kept for backwards-compat with tests / external callers
  headers: string[]
  rows: { month: string; categories: Record<string, number>; total: number }[]
  categoryTotals: Record<string, number>
  grandTotal: number
  // v2 fields (combined Colin + Megan)
  combinedRows: MonthRow[]
  categories: CategoryTotal[]
  totals: {
    colin: number
    megan: number
    combined: number
  }
}

interface SheetExtract {
  headers: string[]
  byMonth: Record<string, Record<string, number>> // month → category → amount
  monthOrder: string[]
}

function extractSheet(raw: string[][]): SheetExtract {
  // Row 0: title, Row 1: empty, Row 2: headers, Row 3+: monthly data
  const headerRow = raw[2] ?? []
  // Drop "Month" col + last "Total" col
  const headers = headerRow
    .slice(1, -1)
    .map((h) => (h ?? '').trim())
    .filter(Boolean)

  const byMonth: Record<string, Record<string, number>> = {}
  const monthOrder: string[] = []
  const MONTH_RE =
    /January|February|March|April|May|June|July|August|September|October|November|December/i

  for (const row of raw.slice(3)) {
    const month = (row[0] ?? '').trim()
    if (!month || month.toLowerCase() === 'total' || !MONTH_RE.test(month)) continue
    if (!(month in byMonth)) {
      byMonth[month] = {}
      monthOrder.push(month)
    }
    for (let i = 0; i < headers.length; i++) {
      const cat = headers[i]
      const val = parseDollar(row[i + 1])
      byMonth[month][cat] = (byMonth[month][cat] ?? 0) + val
    }
  }

  return { headers, byMonth, monthOrder }
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const colinSheet = COLIN_SHEET_NAMES[year]
  if (!colinSheet) {
    return NextResponse.json(
      { error: `No Colin sheet configured for year ${year}` },
      { status: 400 }
    )
  }
  const meganSheet = MEGAN_SHEET_NAMES[year] // optional — may be undefined

  let colinRaw: string[][] = []
  let meganRaw: string[][] = []

  try {
    colinRaw = await readOsSheet(colinSheet, 30)
  } catch (e) {
    return NextResponse.json(
      { error: `Sheets read failed (Colin): ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  if (meganSheet) {
    try {
      meganRaw = await readOsSheet(meganSheet, 30)
    } catch {
      // Tolerate missing Megan sheet — proceed with Colin only.
      meganRaw = []
    }
  }

  const colin = extractSheet(colinRaw)
  const megan = extractSheet(meganRaw)

  // Union all months (Colin's order first, then any Megan-only months — though typically same)
  const allMonths = [...colin.monthOrder]
  for (const m of megan.monthOrder) {
    if (!allMonths.includes(m)) allMonths.push(m)
  }

  // Build combined per-month rows
  const combinedRows: MonthRow[] = allMonths.map((month) => {
    const cCats = colin.byMonth[month] ?? {}
    const mCats = megan.byMonth[month] ?? {}
    const cSum = Object.values(cCats).reduce((s, v) => s + v, 0)
    const mSum = Object.values(mCats).reduce((s, v) => s + v, 0)

    const merged: Record<string, number> = {}
    for (const [cat, val] of Object.entries(cCats)) {
      if (val > 0) merged[`colin|${cat}`] = r2(val)
    }
    for (const [cat, val] of Object.entries(mCats)) {
      if (val > 0) merged[`megan|${cat}`] = r2(val)
    }
    return {
      month,
      colin: r2(cSum),
      megan: r2(mSum),
      total: r2(cSum + mSum),
      categories: merged,
    }
  })

  // Per-category totals across the year, tagged by person
  const categoryTotalsMap = new Map<string, CategoryTotal>()
  for (const month of allMonths) {
    for (const [cat, val] of Object.entries(colin.byMonth[month] ?? {})) {
      const k = `colin|${cat}`
      const existing = categoryTotalsMap.get(k)
      if (existing) existing.total += val
      else categoryTotalsMap.set(k, { name: cat, person: 'colin', total: val })
    }
    for (const [cat, val] of Object.entries(megan.byMonth[month] ?? {})) {
      const k = `megan|${cat}`
      const existing = categoryTotalsMap.get(k)
      if (existing) existing.total += val
      else categoryTotalsMap.set(k, { name: cat, person: 'megan', total: val })
    }
  }
  const categories = [...categoryTotalsMap.values()]
    .map((c) => ({ ...c, total: r2(c.total) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)

  const totals = {
    colin: r2(combinedRows.reduce((s, r) => s + r.colin, 0)),
    megan: r2(combinedRows.reduce((s, r) => s + r.megan, 0)),
    combined: r2(combinedRows.reduce((s, r) => s + r.total, 0)),
  }

  // Backwards-compat v1 fields (Colin only — preserves existing API consumers)
  const v1CategoryTotals: Record<string, number> = {}
  for (const month of colin.monthOrder) {
    for (const [cat, val] of Object.entries(colin.byMonth[month] ?? {})) {
      v1CategoryTotals[cat] = (v1CategoryTotals[cat] ?? 0) + val
    }
  }
  const v1Rows = colin.monthOrder.map((month) => {
    const cats = colin.byMonth[month] ?? {}
    const total = Object.values(cats).reduce((s, v) => s + v, 0)
    return {
      month,
      categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, r2(v)])),
      total: r2(total),
    }
  })
  const v1GrandTotal = r2(v1Rows.reduce((s, r) => s + r.total, 0))

  const body: PersonalExpensesResponse = {
    year,
    headers: colin.headers,
    rows: v1Rows,
    categoryTotals: Object.fromEntries(
      Object.entries(v1CategoryTotals).map(([k, v]) => [k, r2(v)])
    ),
    grandTotal: v1GrandTotal,
    combinedRows,
    categories,
    totals,
  }

  return NextResponse.json(body)
}
