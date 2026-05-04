import { NextResponse } from 'next/server'
import { readOsSheet, parseDollar } from '@/lib/sheets/client'

export const revalidate = 3600

// Sheet names per year — 2026 is current, prior years have year suffix
const SHEET_NAMES: Record<number, string> = {
  2026: '💰 Personal Expenses',
  2025: '💰 Personal Expenses 2025',
}

export interface PersonalExpenseRow {
  month: string
  categories: Record<string, number>
  total: number
}

export interface PersonalExpensesResponse {
  year: number
  headers: string[]
  rows: PersonalExpenseRow[]
  categoryTotals: Record<string, number>
  grandTotal: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const sheetName = SHEET_NAMES[year]
  if (!sheetName) {
    return NextResponse.json({ error: `No sheet configured for year ${year}` }, { status: 400 })
  }

  let raw: string[][]
  try {
    raw = await readOsSheet(sheetName, 30)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Sheets read failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  // Row 0: title, Row 1: empty, Row 2: headers, Row 3+: monthly data
  const headerRow = raw[2] ?? []
  const headers = headerRow.slice(1, -1).map((h) => h.trim()).filter(Boolean) // exclude Month col + Total col

  const rows: PersonalExpenseRow[] = []
  const categoryTotals: Record<string, number> = {}

  for (const row of raw.slice(3)) {
    const month = (row[0] ?? '').trim()
    if (!month || month.toLowerCase() === 'total' || !month.match(/January|February|March|April|May|June|July|August|September|October|November|December/i)) continue

    const categories: Record<string, number> = {}
    let rowTotal = 0

    for (let i = 0; i < headers.length; i++) {
      const cat = headers[i]
      const val = parseDollar(row[i + 1])
      categories[cat] = val
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + val
      rowTotal += val
    }

    rows.push({ month, categories, total: Math.round(rowTotal * 100) / 100 })
  }

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  return NextResponse.json({
    year,
    headers,
    rows,
    categoryTotals: Object.fromEntries(
      Object.entries(categoryTotals).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    grandTotal: Math.round(grandTotal * 100) / 100,
  } satisfies PersonalExpensesResponse)
}
