import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export const revalidate = 0

export async function GET(request: Request) {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') ?? '2026-04'

  const [year, mo] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, mo, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`

  const [eventsRes, settlementsRes] = await Promise.all([
    gate.supabase
      .from('amazon_financial_events')
      .select('event_type, gross_contribution, fees_contribution, refunds_contribution')
      .gte('posted_date', start)
      .lte('posted_date', end),
    gate.supabase
      .from('amazon_settlements')
      .select('id, period_start_at, period_end_at, net_payout, currency')
      .gte('period_start_at', `${start}T00:00:00Z`)
      .lt('period_start_at', `${String(year)}-${String(mo + 1).padStart(2, '0')}-01T00:00:00Z`)
      .order('period_start_at', { ascending: true }),
  ])

  if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  if (settlementsRes.error)
    return NextResponse.json({ error: settlementsRes.error.message }, { status: 500 })

  const events = eventsRes.data ?? []
  const settlements = settlementsRes.data ?? []

  let grossSales = 0
  let amazonFees = 0
  let refunds = 0
  let shipmentCount = 0
  let refundCount = 0

  for (const ev of events) {
    if (ev.event_type === 'ShipmentEvent') {
      grossSales += ev.gross_contribution ?? 0
      amazonFees += ev.fees_contribution ?? 0
      shipmentCount++
    } else if (ev.event_type === 'RefundEvent') {
      refunds += ev.refunds_contribution ?? 0
      amazonFees += ev.fees_contribution ?? 0
      refundCount++
    }
  }

  const totalNetPayout = settlements.reduce((s, r) => s + (r.net_payout ?? 0), 0)
  const parsed = grossSales !== 0 || amazonFees !== 0 || refunds !== 0

  return NextResponse.json({
    month,
    grossSales: Math.round(grossSales * 100) / 100,
    amazonFees: Math.round(amazonFees * 100) / 100,
    refunds: Math.round(refunds * 100) / 100,
    netRevenue: Math.round((grossSales + amazonFees + refunds) * 100) / 100,
    totalNetPayout: Math.round(totalNetPayout * 100) / 100,
    shipmentCount,
    refundCount,
    parsed,
    settlements: settlements.map((s) => ({
      id: s.id,
      periodStart: s.period_start_at,
      periodEnd: s.period_end_at,
      netPayout: s.net_payout,
      currency: s.currency,
    })),
  })
}

export type RevenueBreakdownResponse = {
  month: string
  grossSales: number
  amazonFees: number
  refunds: number
  netRevenue: number
  totalNetPayout: number
  shipmentCount: number
  refundCount: number
  parsed: boolean
  settlements: Array<{
    id: string
    periodStart: string
    periodEnd: string
    netPayout: number
    currency: string
  }>
}
