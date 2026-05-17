import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scoreMatch, greedyPair } from '@/lib/reconciliation/scoring'

// POST /api/reconciliation/statement-match
// Body: { month: 'YYYY-MM', account?: string }
// Runs the auto-matcher against pending_transactions for the given month,
// pairs them with receipts, and writes results to statement_receipt_matches.
export async function POST(request: Request) {
  let body: { month?: unknown; account?: unknown }
  try {
    body = (await request.json()) as { month?: unknown; account?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { month, account } = body
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 })
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

  // Receipts window: ±15 days around the month
  const rFrom = new Date(year, mo - 1, 1)
  rFrom.setDate(rFrom.getDate() - 15)
  const rTo = new Date(year, mo - 1, lastDay)
  rTo.setDate(rTo.getDate() + 15)

  // Fetch unmatched debits in this month (debits only — credits are payments/refunds, not purchases)
  let txnQuery = supabase
    .from('pending_transactions')
    .select('id, txn_date, description, vendor_extracted, amount_abs, source_account')
    .gte('txn_date', from)
    .lte('txn_date', to)
    .eq('is_debit', true)
    .not('id', 'in', `(SELECT transaction_id FROM statement_receipt_matches)`)

  if (typeof account === 'string' && account) {
    txnQuery = txnQuery.eq('source_account', account)
  }

  const [{ data: txnRows, error: tErr }, { data: receiptRows, error: rErr }] = await Promise.all([
    txnQuery,
    supabase
      .from('receipts')
      .select('id, receipt_date, upload_date, vendor, total, pretax, tax_amount')
      .gte('receipt_date', rFrom.toISOString().slice(0, 10))
      .lte('receipt_date', rTo.toISOString().slice(0, 10))
      .neq('match_status', 'matched'),
  ])

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

  const transactions = txnRows ?? []
  const receipts = receiptRows ?? []

  // Score every transaction × receipt pair
  type RawPair = { score: number; receiptId: string; expenseId: string }
  const rawPairs: RawPair[] = []
  for (const txn of transactions) {
    const txnAmount = Number(txn.amount_abs)
    if (!txnAmount || txnAmount <= 0) continue
    for (const receipt of receipts) {
      const receiptTotal =
        Number(receipt.total ?? 0) || Number(receipt.pretax ?? 0) + Number(receipt.tax_amount ?? 0)
      if (!receiptTotal || receiptTotal <= 0) continue
      const score = scoreMatch(
        receiptTotal,
        receipt.receipt_date ?? receipt.upload_date,
        receipt.vendor ?? '',
        txnAmount,
        txn.txn_date,
        txn.vendor_extracted ?? txn.description ?? ''
      )
      if (score < 999) rawPairs.push({ score, receiptId: receipt.id, expenseId: txn.id })
    }
  }

  const { autoMatches } = greedyPair(rawPairs)

  // Build review pairs: pairs scored 1.0–3.0 (needsReview count from greedyPair is a count, not IDs)
  // Re-derive review pairs from rawPairs for INSERT
  const claimedReceipts = new Set(autoMatches.map((m) => m.receiptId))
  const claimedTxns = new Set(autoMatches.map((m) => m.expenseId))
  const sorted = [...rawPairs].sort((a, b) => a.score - b.score)
  const reviewMatches: Array<{ receiptId: string; txnId: string; score: number }> = []
  for (const pair of sorted) {
    if (claimedReceipts.has(pair.receiptId) || claimedTxns.has(pair.expenseId)) continue
    if (pair.score > 1.0 && pair.score <= 3.0) {
      reviewMatches.push({ receiptId: pair.receiptId, txnId: pair.expenseId, score: pair.score })
      claimedReceipts.add(pair.receiptId)
      claimedTxns.add(pair.expenseId)
    }
  }

  // Upsert matches — skip conflicts (transaction already matched by a prior run)
  const inserts = [
    ...autoMatches.map(({ receiptId, expenseId }) => ({
      transaction_id: expenseId,
      receipt_id: receiptId,
      match_score:
        rawPairs.find((p) => p.receiptId === receiptId && p.expenseId === expenseId)?.score ?? 0,
      match_status: 'auto',
    })),
    ...reviewMatches.map(({ receiptId, txnId, score }) => ({
      transaction_id: txnId,
      receipt_id: receiptId,
      match_score: score,
      match_status: 'review',
    })),
  ]

  if (inserts.length > 0) {
    const { error: iErr } = await supabase
      .from('statement_receipt_matches')
      .upsert(inserts, { onConflict: 'transaction_id', ignoreDuplicates: true })
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  }

  return NextResponse.json({
    processed: transactions.length,
    autoMatched: autoMatches.length,
    needsReview: reviewMatches.length,
    unmatched: transactions.length - autoMatches.length - reviewMatches.length,
  })
}
