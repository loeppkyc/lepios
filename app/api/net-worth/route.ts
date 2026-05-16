import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Changed from revalidate=0: FX rate refreshes hourly; balance data is infrequent.
// See C6 acceptance doc § FX rate source.
export const revalidate = 3600

export interface BalanceSheetEntryLite {
  id: string
  name: string
  account_type: 'asset' | 'liability'
  category: string
  balance: number
  balance_native: number
  balance_cad: number
  currency: 'CAD' | 'USD'
  as_of_date: string
  notes: string | null
  sort_order: number
  source: 'manual' | 'auto_sync'
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
  fxRate: number
  fxRateDate: string
  fxRateFallback: boolean
}

// TODO: tune with real data — fallback constant per Principle 11.
// Bank of Canada FXUSDCAD daily rate is fetched at runtime when reachable.
const FALLBACK_FX_RATE = 1.37

const r2 = (n: number) => Math.round(n * 100) / 100
const isPersonal = (category: string) => category.startsWith('personal_')

async function fetchFxRate(): Promise<{ rate: number; date: string; fallback: boolean }> {
  try {
    const r = await fetch(
      'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1',
      { next: { revalidate: 3600 } }
    )
    if (!r.ok) throw new Error(`Bank of Canada API returned ${r.status}`)
    const data = (await r.json()) as {
      observations?: Array<{ d: string; FXUSDCAD: { v: string } }>
    }
    const obs = data.observations?.[0]
    if (!obs) throw new Error('No observations in Bank of Canada response')
    return { rate: Number(obs.FXUSDCAD.v), date: obs.d, fallback: false }
  } catch {
    return { rate: FALLBACK_FX_RATE, date: 'fallback', fallback: true }
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch FX rate in parallel with DB queries.
  const [fxResult, entriesResult, snapshotsResult] = await Promise.all([
    fetchFxRate(),
    supabase
      .from('balance_sheet_entries')
      .select(
        'id, name, account_type, category, balance, as_of_date, notes, sort_order, source, currency'
      )
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
  ])

  const { rate: fxRate, date: fxRateDate, fallback: fxRateFallback } = fxResult
  const { data: entries, error: entriesErr } = entriesResult
  const { data: snapshots, error: snapErr } = snapshotsResult

  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })

  const rows: BalanceSheetEntryLite[] = (entries ?? []).map((e) => {
    const nativeBalance = Number(e.balance)
    // Guard against missing column (before migration or if currency is null from DB).
    const currency = ((e.currency as string | null | undefined) ?? 'CAD') as 'CAD' | 'USD'
    const cadBalance = currency === 'USD' ? r2(nativeBalance * fxRate) : nativeBalance
    return {
      ...e,
      balance: cadBalance,
      balance_native: nativeBalance,
      balance_cad: cadBalance,
      currency,
      account_type: e.account_type as 'asset' | 'liability',
      source: (e.source as 'manual' | 'auto_sync') ?? 'manual',
    }
  })

  const latestSnapshot =
    snapshots && snapshots.length > 0
      ? ({
          ...snapshots[0],
          total_assets: Number(snapshots[0].total_assets),
          total_liabilities: Number(snapshots[0].total_liabilities),
          net_worth: Number(snapshots[0].net_worth),
        } as NetWorthSnapshot)
      : null

  let totalAssets = 0
  let totalLiabilities = 0
  let businessSum = 0
  let personalSum = 0
  const byCatMap = new Map<string, CategoryTotal>()
  let mostRecentDate: string | null = null

  for (const r of rows) {
    // r.balance is already the CAD-converted value for USD rows.
    const cadBalance = r.balance
    const signed = r.account_type === 'asset' ? cadBalance : -cadBalance
    if (r.account_type === 'asset') totalAssets += cadBalance
    else totalLiabilities += cadBalance

    if (isPersonal(r.category)) personalSum += signed
    else businessSum += signed

    const key = `${r.account_type}:${r.category}`
    const existing = byCatMap.get(key)
    if (existing) existing.total = r2(existing.total + cadBalance)
    else
      byCatMap.set(key, {
        category: r.category,
        account_type: r.account_type,
        total: r2(cadBalance),
      })

    if (!mostRecentDate || r.as_of_date > mostRecentDate) mostRecentDate = r.as_of_date
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
    fxRate,
    fxRateDate,
    fxRateFallback,
  }

  return NextResponse.json(body)
}
