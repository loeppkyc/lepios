import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { LifeMilestone } from '@/app/api/life-milestones/route'

export const revalidate = 0

export type YearVerdict = 'winning' | 'flat' | 'tightening' | 'expanding' | null

export interface YearRow {
  year: number
  jan1Liquid: number | null
  yearEndLiquid: number | null
  isYtd: boolean
  delta: number | null
  deltaPct: number | null
  milestoneCount: number
  debtEliminated: number
  verdict: YearVerdict
}

export interface AnnualReviewResponse {
  years: YearRow[]
  milestones: LifeMilestone[]
  currentLive: {
    totalAssets: number
    totalLiabilities: number
    netWorth: number
  }
  headline: string
}

interface SnapshotRow {
  snapshot_date: string
  net_worth: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function snapshotOnOrBefore(snapshots: SnapshotRow[], target: string): SnapshotRow | null {
  let best: SnapshotRow | null = null
  for (const s of snapshots) {
    if (s.snapshot_date <= target) {
      if (!best || s.snapshot_date > best.snapshot_date) best = s
    }
  }
  return best
}

function computeVerdict(
  delta: number | null,
  debtEliminated: number,
  cashFlat: boolean
): YearVerdict {
  if (delta == null) return null
  // Wealth grew despite cash drop, AND debt was eliminated → winning
  if (delta >= 0 && debtEliminated > 0) return 'winning'
  if (cashFlat && debtEliminated > 0) return 'winning'
  if (delta > 0) return 'expanding'
  if (Math.abs(delta) < 5000) return 'flat'
  return 'tightening'
}

function buildHeadline(currentYearRow: YearRow | null, currentLiveNetWorth: number): string {
  if (!currentYearRow) return 'No data yet — add a Jan 1 net worth snapshot to start tracking.'

  const yr = currentYearRow.year
  const start = currentYearRow.jan1Liquid
  const end = currentLiveNetWorth
  const debt = currentYearRow.debtEliminated

  if (start == null) {
    return `${yr} YTD: net worth ${end >= 0 ? 'is' : 'is at'} ${fmt(end)}. Add a Jan 1 ${yr} snapshot to compare year-over-year.`
  }

  const delta = end - start
  const fmtD = (n: number) => (n >= 0 ? '+' : '') + fmt(n)

  if (currentYearRow.verdict === 'winning') {
    return `${yr} YTD: liquid ${fmt(start)} → ${fmt(end)} (${fmtD(delta)})${debt > 0 ? ` + eliminated ${fmt(debt)} of debt` : ''}. **You're winning.**`
  }
  if (currentYearRow.verdict === 'flat') {
    return `${yr} YTD: liquid roughly flat at ${fmt(end)}${debt > 0 ? `, but eliminated ${fmt(debt)} of debt` : ''}.${debt > 0 ? " You're winning." : ''}`
  }
  if (currentYearRow.verdict === 'expanding') {
    return `${yr} YTD: liquid ${fmt(start)} → ${fmt(end)} (${fmtD(delta)}). Expanding.`
  }
  if (currentYearRow.verdict === 'tightening') {
    return `${yr} YTD: liquid ${fmt(start)} → ${fmt(end)} (${fmtD(delta)}). Tightening — review what changed.`
  }
  return `${yr} YTD in progress.`
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) {
    return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  }
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1) All net_worth_snapshots for historical lookups
  const { data: snapsData, error: snapErr } = await supabase
    .from('net_worth_snapshots')
    .select('snapshot_date, net_worth')
    .order('snapshot_date', { ascending: true })

  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })
  const snapshots: SnapshotRow[] = (snapsData ?? []).map((s) => ({
    snapshot_date: s.snapshot_date,
    net_worth: Number(s.net_worth),
  }))

  // 2) All life milestones
  const { data: msData, error: msErr } = await supabase
    .from('life_milestones')
    .select(
      'id, milestone_date, category, title, description, money_impact, created_at, updated_at'
    )
    .order('milestone_date', { ascending: false })

  if (msErr) return NextResponse.json({ error: msErr.message }, { status: 500 })
  const milestones: LifeMilestone[] = (msData ?? []).map((m) => ({
    ...m,
    money_impact: m.money_impact == null ? null : Number(m.money_impact),
  }))

  // 3) Live current balance sheet for current-year row
  const { data: bseData, error: bseErr } = await supabase
    .from('balance_sheet_entries')
    .select('account_type, balance')
    .in('account_type', ['asset', 'liability'])

  if (bseErr) return NextResponse.json({ error: bseErr.message }, { status: 500 })

  let liveAssets = 0
  let liveLiab = 0
  for (const r of bseData ?? []) {
    const bal = Number(r.balance)
    if (r.account_type === 'asset') liveAssets += bal
    else liveLiab += bal
  }
  const liveNetWorth = r2(liveAssets - liveLiab)

  // 4) Determine the year range from milestones + snapshots
  const allYears = new Set<number>()
  const currentYear = new Date().getUTCFullYear()
  allYears.add(currentYear)
  for (const s of snapshots) allYears.add(parseInt(s.snapshot_date.slice(0, 4), 10))
  for (const m of milestones) allYears.add(parseInt(m.milestone_date.slice(0, 4), 10))

  const years: YearRow[] = []
  for (const yr of [...allYears].sort((a, b) => b - a)) {
    const isYtd = yr === currentYear

    // Jan 1 = snapshot on or before Dec 31 of previous year
    const jan1Snap = snapshotOnOrBefore(snapshots, `${yr - 1}-12-31`)
    const jan1Liquid = jan1Snap?.net_worth ?? null

    // Year-end: for past years, snapshot at Dec 31 (or closest preceding next year)
    // For current year, use live net worth
    let yearEndLiquid: number | null
    if (isYtd) {
      yearEndLiquid = liveNetWorth
    } else {
      const decSnap = snapshotOnOrBefore(snapshots, `${yr}-12-31`)
      // require the snapshot to be in or after this year
      yearEndLiquid = decSnap && decSnap.snapshot_date >= `${yr}-01-01` ? decSnap.net_worth : null
    }

    const delta =
      jan1Liquid != null && yearEndLiquid != null ? r2(yearEndLiquid - jan1Liquid) : null
    const deltaPct =
      delta != null && jan1Liquid != null && jan1Liquid !== 0
        ? r2((delta / Math.abs(jan1Liquid)) * 100)
        : null

    // Debt eliminated this year = sum of money_impact on category='debt' milestones in year
    let debtEliminated = 0
    let count = 0
    for (const m of milestones) {
      if (m.milestone_date.startsWith(`${yr}-`)) {
        count += 1
        if (m.category === 'debt' && m.money_impact != null) {
          debtEliminated += m.money_impact
        }
      }
    }

    const cashFlat = delta != null && Math.abs(delta) < 5000
    const verdict = computeVerdict(delta, debtEliminated, cashFlat)

    years.push({
      year: yr,
      jan1Liquid: jan1Liquid != null ? r2(jan1Liquid) : null,
      yearEndLiquid: yearEndLiquid != null ? r2(yearEndLiquid) : null,
      isYtd,
      delta,
      deltaPct,
      milestoneCount: count,
      debtEliminated: r2(debtEliminated),
      verdict,
    })
  }

  const currentYearRow = years.find((y) => y.isYtd) ?? null
  const headline = buildHeadline(currentYearRow, liveNetWorth)

  const body: AnnualReviewResponse = {
    years,
    milestones,
    currentLive: {
      totalAssets: r2(liveAssets),
      totalLiabilities: r2(liveLiab),
      netWorth: liveNetWorth,
    },
    headline,
  }

  return NextResponse.json(body)
}
