import { NextResponse } from 'next/server'
import { readOsSheet, parseDollar } from '@/lib/sheets/client'

export const revalidate = 3600

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export interface MonthlyPnlRow {
  month: string
  revenue: number
  units: number
  orders: number
  amazonFees: number
  estPayout: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
  marginPct: number | null
  sessions: number
}

export interface GoalRow {
  month: string
  salesGoal: number
  actualSales: number
  buyGoal: number
  actualBought: number
  estProfit: number
  actualProfit: number
}

export interface MonthlyPnlResponse {
  months: MonthlyPnlRow[]
  totals: Omit<MonthlyPnlRow, 'month' | 'marginPct'> & { marginPct: number | null }
  comparison2025: MonthlyPnlRow | null
  goals: GoalRow[]
}

export async function GET() {
  let pnlRaw: string[][]
  let goalsRaw: string[][]

  try {
    ;[pnlRaw, goalsRaw] = await Promise.all([
      readOsSheet('📊 Monthly P&L', 30),
      readOsSheet('🎯 Goal Tracking', 20),
    ])
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Sheets read failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }

  // P&L: headers at row 4 (index 4), data rows 5-16 (months Jan-Dec)
  const months: MonthlyPnlRow[] = []
  let totals: MonthlyPnlResponse['totals'] | null = null
  let comparison2025: MonthlyPnlRow | null = null

  for (const row of pnlRaw.slice(4)) {
    const label = (row[0] ?? '').trim()
    if (!label) continue

    const isMonth = MONTH_NAMES.some((m) => label.startsWith(m))
    const isTotals = label.includes('TOTALS') || label.includes('YTD')
    const is2025 = label.includes('2025 Full Year')

    if (!isMonth && !isTotals && !is2025) continue

    const parsed = {
      month: label,
      revenue: parseDollar(row[1]),
      units: parseInt((row[2] ?? '0').replace(/[^0-9]/g, ''), 10) || 0,
      orders: parseInt((row[3] ?? '0').replace(/[^0-9]/g, ''), 10) || 0,
      amazonFees: parseDollar(row[4]),
      estPayout: parseDollar(row[5]),
      cogs: parseDollar(row[6]),
      grossProfit: parseDollar(row[7]),
      expenses: parseDollar(row[8]),
      netProfit: parseDollar(row[9]),
      marginPct: row[10] ? parseFloat((row[10] ?? '').replace('%', '')) || null : null,
      sessions: parseInt((row[11] ?? '0').replace(/[^0-9]/g, ''), 10) || 0,
    }

    if (isMonth) months.push(parsed)
    else if (isTotals && !totals) totals = parsed
    else if (is2025) comparison2025 = parsed
  }

  // Goals: headers at row 2 (index 2), data rows 3+ (months)
  const goals: GoalRow[] = []
  for (const row of goalsRaw.slice(3)) {
    const month = (row[0] ?? '').trim()
    if (!month || !MONTH_NAMES.some((m) => month.startsWith(m))) continue
    goals.push({
      month,
      salesGoal: parseDollar(row[1]),
      actualSales: parseDollar(row[2]),
      buyGoal: parseDollar(row[3]),
      actualBought: parseDollar(row[4]),
      estProfit: parseDollar(row[5]),
      actualProfit: parseDollar(row[6]),
    })
  }

  return NextResponse.json({
    months,
    totals: totals ?? {
      month: '2026 YTD',
      revenue: 0, units: 0, orders: 0, amazonFees: 0,
      estPayout: 0, cogs: 0, grossProfit: 0, expenses: 0,
      netProfit: 0, marginPct: null, sessions: 0,
    },
    comparison2025,
    goals,
  } satisfies MonthlyPnlResponse)
}
