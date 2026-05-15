import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface BalanceSheetEntryLite {
  id: string
  name: string
  account_type: 'asset' | 'liability'
  category: string
  balance: number
  as_of_date: string
  notes: string | null
  sort_order: number
}

export interface NetWorthSnapshot {
  id: string
  snapshot_date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  breakdown: Record<string, unknown> | null
  notes: string | null
  created_at: string
}

export interface CategoryTotal {
  category: string
  account_type: 'asset' | 'liability'
  total: number
}

export interface PillarSplit {
  business: number
  personal: number
}

export interface NetWorthResponse {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  asOfDate: string | null
  byCategory: CategoryTotal[]
  byPillar: PillarSplit
  rows: BalanceSheetEntryLite[]
  latestSnapshot: NetWorthSnapshot | null
  changeSinceSnapshot: number | null
  vehiclesAutoValue: number | null
  inventoryAutoValue: number | null
  inventorySnapshotDate: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const isPersonal = (category: string) => category.startsWith('personal_')

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Parallel fetches: balance_sheet_entries, snapshots, vehicles, inventory.
  const [
    { data: entries, error: entriesErr },
    { data: snapshots, error: snapErr },
    { data: vehicles },
    { data: inventorySnaps },
  ] = await Promise.all([
    supabase
      .from('balance_sheet_entries')
      .select('id, name, account_type, category, balance, as_of_date, notes, sort_order')
      .in('account_type', ['asset', 'liability'])
      .order('account_type', { ascending: false })
      .order('sort_order', { ascending: true }),
    supabase
      .from('net_worth_snapshots')
      .select(
        'id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at'
      )
      .order('snapshot_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('vehicles')
      .select('current_value_estimate, current_value_updated_at, name')
      .not('current_value_estimate', 'is', null),
    supabase
      .from('inventory_snapshots')
      .select('value_at_cost, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1),
  ])

  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })

  const latestSnapshot =
    snapshots && snapshots.length > 0
      ? ({
          ...snapshots[0],
          total_assets: Number(snapshots[0].total_assets),
          total_liabilities: Number(snapshots[0].total_liabilities),
          net_worth: Number(snapshots[0].net_worth),
        } as NetWorthSnapshot)
      : null

  // Dedup: when auto-pull tables have data, exclude overlapping balance_sheet_entries rows.
  const hasVehicles = (vehicles ?? []).length > 0
  const hasInventory = (inventorySnaps ?? []).length > 0

  const filteredEntries = (entries ?? []).filter((e) => {
    if (hasVehicles && e.account_type === 'asset' && e.category === 'equipment') {
      if (e.name.toLowerCase().includes('vehicle')) return false
    }
    if (hasInventory && e.account_type === 'asset' && e.category === 'inventory') return false
    return true
  })

  const rows: BalanceSheetEntryLite[] = filteredEntries.map((e) => ({
    ...e,
    balance: Number(e.balance),
    account_type: e.account_type as 'asset' | 'liability',
  }))

  let totalAssets = 0
  let totalLiabilities = 0
  let businessSum = 0
  let personalSum = 0
  const byCatMap = new Map<string, CategoryTotal>()
  let mostRecentDate: string | null = null

  for (const r of rows) {
    const signed = r.account_type === 'asset' ? r.balance : -r.balance
    if (r.account_type === 'asset') totalAssets += r.balance
    else totalLiabilities += r.balance

    if (isPersonal(r.category)) personalSum += signed
    else businessSum += signed

    const key = `${r.account_type}:${r.category}`
    const existing = byCatMap.get(key)
    if (existing) existing.total = r2(existing.total + r.balance)
    else
      byCatMap.set(key, {
        category: r.category,
        account_type: r.account_type,
        total: r2(r.balance),
      })

    if (!mostRecentDate || r.as_of_date > mostRecentDate) mostRecentDate = r.as_of_date
  }

  // Inject synthetic totals from auto-pull tables.
  let vehiclesAutoValue: number | null = null
  if (hasVehicles) {
    vehiclesAutoValue = (vehicles ?? []).reduce(
      (sum, v) => sum + Number(v.current_value_estimate),
      0
    )
    totalAssets += vehiclesAutoValue
    businessSum += vehiclesAutoValue
    byCatMap.set('asset:vehicle', {
      category: 'vehicle',
      account_type: 'asset',
      total: r2(vehiclesAutoValue),
    })
  }

  let inventoryAutoValue: number | null = null
  let inventorySnapshotDate: string | null = null
  if (hasInventory) {
    inventoryAutoValue = Number(inventorySnaps![0].value_at_cost)
    inventorySnapshotDate = inventorySnaps![0].snapshot_date
    totalAssets += inventoryAutoValue
    businessSum += inventoryAutoValue
    byCatMap.set('asset:inventory', {
      category: 'inventory',
      account_type: 'asset',
      total: r2(inventoryAutoValue),
    })
  }

  const netWorth = r2(totalAssets - totalLiabilities)
  const changeSinceSnapshot = latestSnapshot ? r2(netWorth - latestSnapshot.net_worth) : null

  const body: NetWorthResponse = {
    totalAssets: r2(totalAssets),
    totalLiabilities: r2(totalLiabilities),
    netWorth,
    asOfDate: mostRecentDate,
    byCategory: Array.from(byCatMap.values()).sort((a, b) =>
      a.account_type === b.account_type ? b.total - a.total : a.account_type === 'asset' ? -1 : 1
    ),
    byPillar: { business: r2(businessSum), personal: r2(personalSum) },
    rows,
    latestSnapshot,
    changeSinceSnapshot,
    vehiclesAutoValue,
    inventoryAutoValue,
    inventorySnapshotDate,
  }

  return NextResponse.json(body)
}
