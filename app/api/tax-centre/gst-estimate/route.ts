import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

/**
 * GET /api/tax-centre/gst-estimate?quarter=2026-Q1
 *
 * Returns a live GST owing estimate based on:
 *  - GST collected: Amazon GST is collected/remitted by Amazon (marketplace facilitator).
 *    Colin does NOT collect GST on Amazon sales — Line 103 = $0.
 *  - ITCs (Input Tax Credits): GST paid on business expenses = tax_amount from business_expenses.
 *  - Net owing = 0 (collected) - ITCs = credit position.
 *
 * Quarter format: YYYY-Q{1-4}
 * Default: current calendar quarter.
 */

interface QuarterBounds {
  label: string
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
}

function parseQuarter(q: string | null): QuarterBounds {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentQ = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4

  let targetYear = year
  let targetQ = currentQ

  if (q) {
    const m = q.match(/^(\d{4})-Q([1-4])$/)
    if (m) {
      targetYear = parseInt(m[1], 10)
      targetQ = parseInt(m[2], 10)
    }
  }

  const quarterMonths: Record<number, { start: string; end: string; label: string }> = {
    1: {
      start: `${targetYear}-01-01`,
      end: `${targetYear}-03-31`,
      label: `Q1 ${targetYear} (Jan–Mar)`,
    },
    2: {
      start: `${targetYear}-04-01`,
      end: `${targetYear}-06-30`,
      label: `Q2 ${targetYear} (Apr–Jun)`,
    },
    3: {
      start: `${targetYear}-07-01`,
      end: `${targetYear}-09-30`,
      label: `Q3 ${targetYear} (Jul–Sep)`,
    },
    4: {
      start: `${targetYear}-10-01`,
      end: `${targetYear}-12-31`,
      label: `Q4 ${targetYear} (Oct–Dec)`,
    },
  }

  return quarterMonths[targetQ]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface GstEstimateResponse {
  quarter: string
  /** GST collected on sales — always $0 for Colin (Amazon marketplace facilitator) */
  gst_collected: number
  /** ITCs: GST paid on business expenses (tax_amount from business_expenses) */
  itc_credits: number
  /** net_owing = gst_collected - itc_credits (negative = refund/credit) */
  net_owing: number
  /** Recommended set-aside amount (0 if in credit position) */
  set_aside_recommendation: number
  expense_count: number
  note: string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const quarterParam = searchParams.get('quarter')
  const bounds = parseQuarter(quarterParam)

  const { data: expenses, error } = await supabase
    .from('business_expenses')
    .select('tax_amount, pretax, business_use_pct')
    .gte('date', bounds.start)
    .lte('date', bounds.end)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (expenses ?? []) as Array<{
    tax_amount: number
    pretax: number
    business_use_pct: number
  }>

  // ITCs: only the business portion of GST paid
  let itcCredits = 0
  for (const e of rows) {
    const businessFraction = e.business_use_pct / 100
    itcCredits += Number(e.tax_amount) * businessFraction
  }
  itcCredits = round2(itcCredits)

  // Amazon marketplace facilitator: Colin does NOT collect GST on Amazon sales
  const gstCollected = 0

  const netOwing = round2(gstCollected - itcCredits)
  // If net_owing < 0 → credit position → no set-aside needed
  const setAsideRecommendation = netOwing > 0 ? netOwing : 0

  return NextResponse.json({
    quarter: bounds.label,
    gst_collected: gstCollected,
    itc_credits: itcCredits,
    net_owing: netOwing,
    set_aside_recommendation: setAsideRecommendation,
    expense_count: rows.length,
    note:
      'Amazon collects and remits GST/HST on your behalf (marketplace facilitator). ' +
      'GST collected on sales = $0 for CRA purposes. ITCs are from business_expenses.tax_amount.',
  } satisfies GstEstimateResponse)
}
