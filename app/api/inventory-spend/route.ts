import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

/**
 * GET /api/inventory-spend
 *
 * Queries journal_entry_lines for COGS/inventory accounts and returns
 * spend grouped by: this month, this quarter, YTD, and by category.
 *
 * Category detection uses keyword matching on description and account_full_name.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01'
}

function quarterStart(dateStr: string): string {
  const m = parseInt(dateStr.slice(5, 7), 10)
  const qm = m <= 3 ? '01' : m <= 6 ? '04' : m <= 9 ? '07' : '10'
  return dateStr.slice(0, 4) + '-' + qm + '-01'
}

function yearStart(dateStr: string): string {
  return dateStr.slice(0, 4) + '-01-01'
}

/** Keyword-based category detection for inventory spend */
function detectCategory(accountName: string, description: string | null): string {
  const hay = ((accountName ?? '') + ' ' + (description ?? '')).toLowerCase()
  if (hay.includes('book') || hay.includes('pallet') || hay.includes('textbook'))
    return 'Books / Pallets'
  if (hay.includes('lego') || hay.includes('toy') || hay.includes('brick')) return 'LEGO / Toys'
  if (hay.includes('lego')) return 'LEGO / Toys'
  if (hay.includes('electronics') || hay.includes('tech')) return 'Electronics'
  return 'Other'
}

interface JeLineRow {
  account_full_name: string
  description: string | null
  debit: number
  credit: number
}

interface JeHeaderRow {
  je_date: string
}

export interface InventorySpendResponse {
  thisMonth: number
  thisQuarter: number
  ytd: number
  byCategory: Record<string, number>
  periodStart: string
  today: string
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = isoToday()
  const ytdStart = yearStart(today)

  // Fetch journal entries with COGS/inventory accounts, YTD
  const { data: headers, error: hErr } = await supabase
    .from('journal_entries')
    .select('id, je_date')
    .gte('je_date', ytdStart)
    .lte('je_date', today)
    .order('je_date', { ascending: true })

  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 })

  const jeIds = (headers ?? []).map((h) => (h as JeHeaderRow & { id: string }).id)

  if (jeIds.length === 0) {
    return NextResponse.json({
      thisMonth: 0,
      thisQuarter: 0,
      ytd: 0,
      byCategory: {},
      periodStart: ytdStart,
      today,
    } satisfies InventorySpendResponse)
  }

  // Build a map from je_id → je_date
  const jeDateMap = new Map<string, string>()
  for (const h of (headers ?? []) as Array<JeHeaderRow & { id: string }>) {
    jeDateMap.set(h.id, h.je_date)
  }

  // Fetch COGS/inventory/purchase lines with journal_entry_id for date lookup
  const { data: linesWithIds, error: lErr2 } = await supabase
    .from('journal_entry_lines')
    .select('journal_entry_id, account_full_name, description, debit, credit')
    .in('journal_entry_id', jeIds)
    .or(
      [
        'account_full_name.ilike.%Cost of Goods%',
        'account_full_name.ilike.%COGS%',
        'account_full_name.ilike.%Inventory%',
        'account_full_name.ilike.%Purchase%',
      ].join(',')
    )

  if (lErr2) return NextResponse.json({ error: lErr2.message }, { status: 500 })

  const qStart = quarterStart(today)
  const mStart = monthStart(today)

  let thisMonth = 0
  let thisQuarter = 0
  let ytd = 0
  const byCategory: Record<string, number> = {}

  for (const line of (linesWithIds ?? []) as Array<JeLineRow & { journal_entry_id: string }>) {
    const jeDate = jeDateMap.get(line.journal_entry_id)
    if (!jeDate) continue

    // Net debit (inventory spend = debit line)
    const spend = Number(line.debit) - Number(line.credit)
    if (spend <= 0) continue

    // YTD: all from ytdStart (already filtered by header query)
    ytd += spend

    // Quarter
    if (jeDate >= qStart) thisQuarter += spend

    // Month
    if (jeDate >= mStart) thisMonth += spend

    // Category
    const cat = detectCategory(line.account_full_name ?? '', line.description)
    byCategory[cat] = (byCategory[cat] ?? 0) + spend
  }

  // Round all values
  const byCategoryRounded: Record<string, number> = {}
  for (const [k, v] of Object.entries(byCategory)) {
    byCategoryRounded[k] = round2(v)
  }

  return NextResponse.json({
    thisMonth: round2(thisMonth),
    thisQuarter: round2(thisQuarter),
    ytd: round2(ytd),
    byCategory: byCategoryRounded,
    periodStart: ytdStart,
    today,
  } satisfies InventorySpendResponse)
}
