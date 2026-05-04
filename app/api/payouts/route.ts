import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface SettlementRow {
  id: string
  periodStart: string
  periodEnd: string
  gross: number
  feesTotal: number
  refundsTotal: number
  reimbursements: number
  netPayout: number
  fundTransferStatus: string
  currency: string
}

export interface MonthRollup {
  month: string   // 'YYYY-MM'
  label: string
  gross: number
  feesTotal: number
  refundsTotal: number
  reimbursements: number
  netPayout: number
  settlementCount: number
}

export interface PayoutsResponse {
  year: number
  settlements: SettlementRow[]
  monthlyRollups: MonthRollup[]
  ytd: {
    gross: number
    feesTotal: number
    refundsTotal: number
    reimbursements: number
    netPayout: number
    settlementCount: number
  }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function r2(n: number) { return Math.round(n * 100) / 100 }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('amazon_settlements')
    .select('id, period_start_at, period_end_at, gross, fees_total, refunds_total, reimbursements_total_cad, net_payout, fund_transfer_status, currency')
    .gte('period_end_at', `${year}-01-01`)
    .lte('period_end_at', `${year}-12-31`)
    .order('period_end_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []

  const settlements: SettlementRow[] = rows.map(r => ({
    id: r.id as string,
    periodStart: (r.period_start_at as string).slice(0, 10),
    periodEnd: (r.period_end_at as string).slice(0, 10),
    gross: r2(Number(r.gross ?? 0)),
    feesTotal: r2(Number(r.fees_total ?? 0)),
    refundsTotal: r2(Number(r.refunds_total ?? 0)),
    reimbursements: r2(Number(r.reimbursements_total_cad ?? 0)),
    netPayout: r2(Number(r.net_payout ?? 0)),
    fundTransferStatus: (r.fund_transfer_status as string) ?? '',
    currency: (r.currency as string) ?? 'CAD',
  }))

  // Monthly rollups
  const monthMap = new Map<string, { gross: number; fees: number; refunds: number; reimb: number; net: number; count: number }>()
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    monthMap.set(key, { gross: 0, fees: 0, refunds: 0, reimb: 0, net: 0, count: 0 })
  }
  for (const s of settlements) {
    const key = s.periodEnd.slice(0, 7)
    const cur = monthMap.get(key)
    if (!cur) continue
    cur.gross += s.gross
    cur.fees += s.feesTotal
    cur.refunds += s.refundsTotal
    cur.reimb += s.reimbursements
    cur.net += s.netPayout
    cur.count++
  }

  const monthlyRollups: MonthRollup[] = Array.from(monthMap.entries()).map(([month, v]) => {
    const m = parseInt(month.slice(5), 10)
    return {
      month,
      label: `${MONTH_LABELS[m - 1]} ${year}`,
      gross: r2(v.gross),
      feesTotal: r2(v.fees),
      refundsTotal: r2(v.refunds),
      reimbursements: r2(v.reimb),
      netPayout: r2(v.net),
      settlementCount: v.count,
    }
  })

  const ytd = {
    gross: r2(settlements.reduce((s, r) => s + r.gross, 0)),
    feesTotal: r2(settlements.reduce((s, r) => s + r.feesTotal, 0)),
    refundsTotal: r2(settlements.reduce((s, r) => s + r.refundsTotal, 0)),
    reimbursements: r2(settlements.reduce((s, r) => s + r.reimbursements, 0)),
    netPayout: r2(settlements.reduce((s, r) => s + r.netPayout, 0)),
    settlementCount: settlements.length,
  }

  return NextResponse.json({ year, settlements, monthlyRollups, ytd } satisfies PayoutsResponse)
}
