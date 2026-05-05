import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

// Derived from 2024-05–2025-04 filed GST return: Line 103 $65,900.59 / Line 101 $731,465.40 = 9.01% on gross.
// Since we store net payouts (after ~18% Amazon fees), effective rate on net is ~10.09%.
// Use 10% as working estimate until current-year return is filed.
const GST_RATE_ESTIMATE = 0.10

// Confirmed May 2026: $2,000 installment credit sitting with CRA for the 2026 GST year.
// Applied against the May 2026–Apr 2027 net tax obligation.
const OPENING_CREDIT_CAD = 2000.0
const OPENING_CREDIT_NOTE = '$2,000 CRA credit carried into 2026 GST year'

// Colin's GST year: May 1 → April 30 (annual filer)
function gstYearBounds(referenceDate: Date): { start: string; end: string; label: string } {
  const month = referenceDate.getMonth() + 1 // 1-indexed
  const year = referenceDate.getFullYear()

  // GST year starts May 1. If we're in Jan–Apr, the current GST year started
  // May 1 of the previous calendar year.
  const gstStartYear = month >= 5 ? year : year - 1
  const gstEndYear = gstStartYear + 1

  return {
    start: `${gstStartYear}-05-01`,
    end: `${gstEndYear}-04-30`,
    label: `May 1, ${gstStartYear} → Apr 30, ${gstEndYear}`,
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export interface GstAccrualResponse {
  currentYear: {
    label: string
    netPayout: number
    estimatedGst: number
    openingCredit: number
    openingCreditNote: string
    netOwing: number
  }
  priorYear: {
    label: string
    netPayout: number
    filedGst: number
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const { start, end, label } = gstYearBounds(now)

  // Current GST year settlements
  const { data: currentSettlements, error: curErr } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', `${start}T00:00:00+00:00`)
    .lte('period_end_at', `${end}T23:59:59+00:00`)

  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 })

  // Prior GST year: May 1, 2024 → Apr 30, 2025
  const { data: priorSettlements, error: priorErr } = await supabase
    .from('amazon_settlements')
    .select('net_payout, period_end_at')
    .gte('period_end_at', '2024-05-01T00:00:00+00:00')
    .lte('period_end_at', '2025-04-30T23:59:59+00:00')

  if (priorErr) return NextResponse.json({ error: priorErr.message }, { status: 500 })

  const currentNetPayout = round2(
    (currentSettlements ?? []).reduce((s, r) => s + (Number(r.net_payout) || 0), 0)
  )
  const estimatedGst = round2(currentNetPayout * GST_RATE_ESTIMATE)
  const netOwing = round2(estimatedGst - OPENING_CREDIT_CAD)

  const priorNetPayout = round2(
    (priorSettlements ?? []).reduce((s, r) => s + (Number(r.net_payout) || 0), 0)
  )

  const response: GstAccrualResponse = {
    currentYear: {
      label,
      netPayout: currentNetPayout,
      estimatedGst,
      openingCredit: OPENING_CREDIT_CAD,
      openingCreditNote: OPENING_CREDIT_NOTE,
      netOwing,
    },
    priorYear: {
      label: 'May 1, 2024 → Apr 30, 2025',
      netPayout: priorNetPayout,
      filedGst: 9101.93, // Actuals — filed with CRA
    },
  }

  return NextResponse.json(response)
}
