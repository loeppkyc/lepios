import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface PendingTxn {
  id: string
  txn_date: string
  source_account: string
  description: string
  amount_signed: number
  vendor_extracted: string | null
  suggested_expense_account: string | null
  suggested_gst_rate: number | null
  suggested_business_use_pct: number | null
  confidence: number | null
  matched_rule_id: string | null
  matched_rule_name: string | null
}

export interface AccountOption {
  full_name: string
  qb_type: string
}

export interface ReconcileQueue {
  pending: PendingTxn[]
  accounts: AccountOption[]
  totalNeedsReview: number
}

export async function GET() {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: pending, error: pErr } = await supabase
    .from('pending_transactions')
    .select(
      'id, txn_date, source_account, description, amount_signed, vendor_extracted, suggested_expense_account, suggested_gst_rate, suggested_business_use_pct, confidence, matched_rule_id'
    )
    .eq('status', 'needs_review')
    .order('txn_date', { ascending: false })

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  const ruleIds = Array.from(
    new Set((pending ?? []).map((p) => p.matched_rule_id).filter((x): x is string => Boolean(x)))
  )
  let ruleNameMap: Record<string, string> = {}
  if (ruleIds.length > 0) {
    const { data: rules } = await supabase
      .from('vendor_rules')
      .select('id, rule_name')
      .in('id', ruleIds)
    ruleNameMap = Object.fromEntries(
      (rules ?? []).map((r) => [r.id as string, r.rule_name as string])
    )
  }

  const { data: accounts, error: aErr } = await supabase
    .from('chart_of_accounts')
    .select('full_name, qb_type')
    .eq('is_active', true)
    .in('qb_type', [
      'Expenses',
      'Cost of Goods Sold',
      'Other Current Assets',
      'Income',
      'Other Current Liabilities',
    ])
    .order('full_name', { ascending: true })

  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const payload: ReconcileQueue = {
    pending: (pending ?? []).map((p) => ({
      id: p.id as string,
      txn_date: p.txn_date as string,
      source_account: p.source_account as string,
      description: p.description as string,
      amount_signed: Number(p.amount_signed),
      vendor_extracted: (p.vendor_extracted as string | null) ?? null,
      suggested_expense_account: (p.suggested_expense_account as string | null) ?? null,
      suggested_gst_rate: p.suggested_gst_rate == null ? null : Number(p.suggested_gst_rate),
      suggested_business_use_pct:
        p.suggested_business_use_pct == null ? null : Number(p.suggested_business_use_pct),
      confidence: p.confidence == null ? null : Number(p.confidence),
      matched_rule_id: (p.matched_rule_id as string | null) ?? null,
      matched_rule_name: p.matched_rule_id
        ? (ruleNameMap[p.matched_rule_id as string] ?? null)
        : null,
    })),
    accounts: (accounts ?? []).map((a) => ({
      full_name: a.full_name as string,
      qb_type: a.qb_type as string,
    })),
    totalNeedsReview: pending?.length ?? 0,
  }

  return NextResponse.json(payload)
}
