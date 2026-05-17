import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface AccountSummary {
  source_account: string
  total: number
  matched: number // auto + manual confirmed
  review: number // engine uncertain, needs Colin
  dismissed: number // Colin said "no receipt"
  unmatched: number // not yet in statement_receipt_matches
}

export interface StatementSummaryResponse {
  month: string
  accounts: AccountSummary[]
  can_close: boolean // true when every debit is matched or dismissed
}

// GET /api/reconciliation/statement-summary?month=YYYY-MM
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [year, mo] = month.split('-').map(Number)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  const [{ data: txnRows, error: tErr }, { data: matchRows, error: mErr }] = await Promise.all([
    supabase
      .from('pending_transactions')
      .select('id, source_account')
      .gte('txn_date', from)
      .lte('txn_date', to)
      .eq('is_debit', true),
    supabase.from('statement_receipt_matches').select('transaction_id, match_status'),
  ])

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const transactions = txnRows ?? []
  const matchMap = new Map((matchRows ?? []).map((m) => [m.transaction_id, m.match_status]))

  // Group by account
  const accountMap = new Map<string, AccountSummary>()
  for (const txn of transactions) {
    if (!accountMap.has(txn.source_account)) {
      accountMap.set(txn.source_account, {
        source_account: txn.source_account,
        total: 0,
        matched: 0,
        review: 0,
        dismissed: 0,
        unmatched: 0,
      })
    }
    const summary = accountMap.get(txn.source_account)!
    summary.total++
    const status = matchMap.get(txn.id)
    if (status === 'auto' || status === 'manual') summary.matched++
    else if (status === 'review') summary.review++
    else if (status === 'dismissed') summary.dismissed++
    else summary.unmatched++
  }

  const accounts = [...accountMap.values()].sort((a, b) =>
    a.source_account.localeCompare(b.source_account)
  )
  const can_close = accounts.every((a) => a.unmatched === 0 && a.review === 0)

  return NextResponse.json({ month, accounts, can_close } satisfies StatementSummaryResponse)
}
