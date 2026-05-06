import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Categories that are direct selling/inventory costs for an FBA business.
// Anything matched here is COGS, not OpEx. Negative-balance categories (refunds)
// reduce COGS as expected via signed sums.
const COGS_FBA_FEE_CATEGORIES = new Set([
  // Direct selling/transaction fees
  'FBA Selling Fees (Amazon.ca)',
  'FBA Transactions Fees (Amazon.ca)',
  'FBA Inventory and Inbound Services Fees (Amazon.ca)',
  'Other Transaction Fees (Amazon.ca)',
  'Seller Fulfilled Selling Fees (Amazon.ca)',
  'Fulfillment Centre Charges',
  'Amazon Seller Fees and Charges',
  'Shipping and delivery expense',
  // Refund / chargeback adjustments (typically negative balances)
  'FBA Transactions Fees Refunds (Amazon.ca)',
  'Seller Fee Refunds (Amazon.ca)',
  'Refund Administration Fees (Amazon.ca)',
])

// Legacy category names defensive-matched (unlikely to appear but harmless).
const COGS_LEGACY_CATEGORIES = new Set([
  'Inventory — Books (Pallets)',
  'Inventory',
  'Shipping & Delivery',
])

const r2 = (n: number) => Math.round(n * 100) / 100

export interface MonthlyCogsBreakdown {
  beginningInventory: number | null
  endingInventory: number | null
  purchases: number
  fbaFees: number
  inventoryDrawdown: number | null // β + P − E, or null if either snapshot missing
}

export interface MonthlyPnlRow {
  month: string // 'YYYY-MM'
  revenue: number
  cogs: number | null
  cogsApprox: boolean
  cogsBreakdown: MonthlyCogsBreakdown
  grossProfit: number | null
  opex: number
  netProfit: number | null
}

export interface CategoryPnlRow {
  category: string
  total: number
  isCogs: boolean
}

export interface PnlResponse {
  year: number
  months: MonthlyPnlRow[]
  categories: CategoryPnlRow[]
  totals: {
    revenue: number
    cogs: number | null
    grossProfit: number | null
    opex: number
    netProfit: number | null
    fbaFeesIncludedInCogs: number
    inventoryDrawdownIncludedInCogs: number
    monthsMissingSnapshot: number
  }
}

interface SnapshotRow {
  snapshot_date: string
  value_at_cost: number
}

interface CogsEntryRow {
  purchased_at: string
  total_cost_cad: number
}

interface PalletInvoiceRow {
  invoice_month: string
  total_cost_cad: number
}

function monthKey(d: string): string {
  return d.slice(0, 7)
}

function lastDayOfMonth(year: number, monthIdx0: number): string {
  const next = new Date(Date.UTC(year, monthIdx0 + 1, 1))
  next.setUTCDate(next.getUTCDate() - 1)
  return next.toISOString().slice(0, 10)
}

function firstDayOfMonth(year: number, monthIdx0: number): string {
  return new Date(Date.UTC(year, monthIdx0, 1)).toISOString().slice(0, 10)
}

// Find the snapshot ON OR BEFORE the target date (closest preceding).
function snapshotOnOrBefore(snapshots: SnapshotRow[], target: string): number | null {
  let best: SnapshotRow | null = null
  for (const s of snapshots) {
    if (s.snapshot_date <= target) {
      if (!best || s.snapshot_date > best.snapshot_date) best = s
    }
  }
  return best ? Number(best.value_at_cost) : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get('year')

  if (!yearStr || !/^\d{4}$/.test(yearStr)) {
    return NextResponse.json({ error: 'year required (YYYY)' }, { status: 400 })
  }
  const year = parseInt(yearStr, 10)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Revenue: settlements bucketed by period_end_at month
  const { data: settlements, error: settErr } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', `${year}-01-01T00:00:00+00:00`)
    .lte('period_end_at', `${year}-12-31T23:59:59+00:00`)

  if (settErr) return NextResponse.json({ error: settErr.message }, { status: 500 })

  // Expenses: pretax, by date + category
  const { data: expenses, error: expErr } = await supabase
    .from('business_expenses')
    .select('date, category, pretax')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)

  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

  // Inventory snapshots — pull a wider window so we can find "preceding" for Jan
  const { data: snapshotData, error: snapErr } = await supabase
    .from('inventory_snapshots')
    .select('snapshot_date, value_at_cost')
    .order('snapshot_date', { ascending: true })

  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })
  const snapshots: SnapshotRow[] = (snapshotData ?? []).map((s) => ({
    snapshot_date: s.snapshot_date,
    value_at_cost: Number(s.value_at_cost),
  }))

  // Per-ASIN purchases (cogs_entries)
  const { data: cogsData, error: cogsErr } = await supabase
    .from('cogs_entries')
    .select('purchased_at, total_cost_cad')
    .gte('purchased_at', `${year}-01-01`)
    .lte('purchased_at', `${year}-12-31`)

  if (cogsErr) return NextResponse.json({ error: cogsErr.message }, { status: 500 })
  const cogsEntries: CogsEntryRow[] = (cogsData ?? []).map((c) => ({
    purchased_at: c.purchased_at,
    total_cost_cad: Number(c.total_cost_cad),
  }))

  // Pallet purchases (pallet_invoices) — schema has invoice_month as date (first-of-month)
  const { data: palletData, error: palletErr } = await supabase
    .from('pallet_invoices')
    .select('invoice_month, total_cost_cad')
    .gte('invoice_month', `${year}-01-01`)
    .lte('invoice_month', `${year}-12-31`)

  if (palletErr) {
    // pallet_invoices may not have total_cost_cad column in all schemas; tolerate gracefully
    // by treating as empty rather than 500-ing.
    // (but still surface the error in dev — log via server log)
    console.warn('[pnl] pallet_invoices query failed:', palletErr.message)
  }
  const palletInvoices: PalletInvoiceRow[] = (palletData ?? []).map((p) => ({
    invoice_month: p.invoice_month,
    total_cost_cad: Number(p.total_cost_cad ?? 0),
  }))

  // Build empty buckets
  const rev: Record<string, number> = {}
  const purchasesByMonth: Record<string, number> = {}
  const fbaByMonth: Record<string, number> = {}
  const opexByMonth: Record<string, number> = {}
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    rev[key] = 0
    purchasesByMonth[key] = 0
    fbaByMonth[key] = 0
    opexByMonth[key] = 0
  }

  // Revenue
  for (const s of settlements ?? []) {
    const month = (s.period_end_at as string).slice(0, 7)
    if (month in rev) rev[month] += Number(s.net_payout) || 0
  }

  // Expenses → split into FBA (COGS), legacy COGS, or OpEx
  const categoryTotals: Record<string, number> = {}
  for (const e of expenses ?? []) {
    const month = monthKey(e.date as string)
    const pretax = Number(e.pretax) || 0
    const cat = e.category as string
    if (COGS_FBA_FEE_CATEGORIES.has(cat) || COGS_LEGACY_CATEGORIES.has(cat)) {
      fbaByMonth[month] = (fbaByMonth[month] ?? 0) + pretax
    } else {
      opexByMonth[month] = (opexByMonth[month] ?? 0) + pretax
    }
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + pretax
  }

  // Purchases (cogs_entries + pallet_invoices)
  for (const c of cogsEntries) {
    const month = monthKey(c.purchased_at)
    if (month in purchasesByMonth) purchasesByMonth[month] += c.total_cost_cad
  }
  for (const p of palletInvoices) {
    const month = monthKey(p.invoice_month)
    if (month in purchasesByMonth) purchasesByMonth[month] += p.total_cost_cad
  }

  // Build monthly rows with periodic-inventory COGS
  let monthsMissingSnapshot = 0
  let totalFbaFees = 0
  let totalDrawdown = 0
  let anyMonthHasNullCogs = false

  const months: MonthlyPnlRow[] = Object.keys(rev)
    .sort()
    .map((month) => {
      const monthIdx0 = parseInt(month.slice(5, 7), 10) - 1
      const monthStart = firstDayOfMonth(year, monthIdx0)
      const monthEnd = lastDayOfMonth(year, monthIdx0)

      // Beginning = snapshot on or before (monthStart - 1 day)
      // Ending    = snapshot on or before monthEnd
      const startMinus1 = new Date(Date.UTC(year, monthIdx0, 0)).toISOString().slice(0, 10)
      const beginningInventory = snapshotOnOrBefore(snapshots, startMinus1)
      const endingInventory = snapshotOnOrBefore(snapshots, monthEnd)

      const purchases = r2(purchasesByMonth[month] ?? 0)
      const fbaFees = r2(fbaByMonth[month] ?? 0)
      const opex = r2(opexByMonth[month] ?? 0)
      const revenue = r2(rev[month] ?? 0)

      // Periodic drawdown only valid if BOTH snapshots exist AND ending is from a snapshot
      // dated within or after this month (so it actually reflects ending). Use a tighter check:
      // both snapshots must exist AND beginning ≠ ending (i.e., a fresh snapshot for this month).
      let inventoryDrawdown: number | null = null
      const haveBoth = beginningInventory != null && endingInventory != null
      // Require at least one snapshot dated within or after this month for "ending" to be meaningful
      const hasFreshEnding = snapshots.some(
        (s) => s.snapshot_date >= monthStart && s.snapshot_date <= monthEnd
      )
      if (haveBoth && hasFreshEnding) {
        inventoryDrawdown = r2(beginningInventory + purchases - endingInventory)
      }

      let cogs: number | null = null
      let cogsApprox = false
      if (inventoryDrawdown != null) {
        cogs = r2(inventoryDrawdown + fbaFees)
      } else if (fbaFees !== 0) {
        // Approximate: only the FBA fees portion
        cogs = r2(fbaFees)
        cogsApprox = true
        monthsMissingSnapshot += 1
      } else {
        // No data at all for this month
        cogs = null
        anyMonthHasNullCogs = true
      }

      const grossProfit = cogs != null ? r2(revenue - cogs) : null
      const netProfit = grossProfit != null ? r2(grossProfit - opex) : null

      if (inventoryDrawdown != null) totalDrawdown += inventoryDrawdown
      totalFbaFees += fbaFees

      return {
        month,
        revenue,
        cogs,
        cogsApprox,
        cogsBreakdown: {
          beginningInventory: beginningInventory != null ? r2(beginningInventory) : null,
          endingInventory: endingInventory != null ? r2(endingInventory) : null,
          purchases,
          fbaFees,
          inventoryDrawdown,
        },
        grossProfit,
        opex,
        netProfit,
      }
    })

  const categories: CategoryPnlRow[] = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([category, total]) => ({
      category,
      total: r2(total),
      isCogs: COGS_FBA_FEE_CATEGORIES.has(category) || COGS_LEGACY_CATEGORIES.has(category),
    }))

  // Totals — sum monthly rows; null contagion if any cogs is null AND no fbaFees fallback
  let totalRevenue = 0
  let totalCogs: number | null = 0
  let totalGross: number | null = 0
  let totalOpex = 0
  let totalNet: number | null = 0
  for (const m of months) {
    totalRevenue += m.revenue
    totalOpex += m.opex
    if (m.cogs == null) {
      totalCogs = null
      totalGross = null
      totalNet = null
    } else {
      if (totalCogs != null) totalCogs += m.cogs
      if (totalGross != null) totalGross += m.grossProfit ?? 0
      if (totalNet != null) totalNet += m.netProfit ?? 0
    }
  }

  // If we never found null but anyMonthHasNullCogs is true, that's a bug — keep contagion robust
  if (anyMonthHasNullCogs) {
    totalCogs = null
    totalGross = null
    totalNet = null
  }

  const body: PnlResponse = {
    year,
    months,
    categories,
    totals: {
      revenue: r2(totalRevenue),
      cogs: totalCogs != null ? r2(totalCogs) : null,
      grossProfit: totalGross != null ? r2(totalGross) : null,
      opex: r2(totalOpex),
      netProfit: totalNet != null ? r2(totalNet) : null,
      fbaFeesIncludedInCogs: r2(totalFbaFees),
      inventoryDrawdownIncludedInCogs: r2(totalDrawdown),
      monthsMissingSnapshot,
    },
  }

  return NextResponse.json(body)
}
