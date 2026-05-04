import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scoreMatch, greedyPair } from '@/lib/reconciliation/scoring'
import type { Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

// POST /api/reconciliation/auto-match
// Body: { month: 'YYYY-MM' }
export async function POST(request: Request) {
  let body: { month?: unknown }
  try {
    body = (await request.json()) as { month?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { month } = body
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 })
  }

  const [year, mo] = month.split('-').map(Number)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  const fromBuffer = new Date(year, mo - 1, 1)
  fromBuffer.setDate(fromBuffer.getDate() - 15)
  const toBuffer = new Date(year, mo - 1, lastDay)
  toBuffer.setDate(toBuffer.getDate() + 15)
  const expFrom = fromBuffer.toISOString().slice(0, 10)
  const expTo = toBuffer.toISOString().slice(0, 10)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: receiptRows, error: rErr }, { data: expenseRows, error: eErr }] =
    await Promise.all([
      supabase
        .from('receipts')
        .select('*')
        .gte('upload_date', from)
        .lte('upload_date', to)
        .neq('match_status', 'matched')
        .order('upload_date', { ascending: false }),
      supabase
        .from('business_expenses')
        .select('*')
        .gte('date', expFrom)
        .lte('date', expTo)
        .eq('hubdoc', false)
        .order('date', { ascending: false }),
    ])

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  const receipts = (receiptRows ?? []) as Receipt[]
  const expenses = (expenseRows ?? []) as BusinessExpense[]

  // Build scored pairs, then greedily pair
  const rawPairs = []
  for (const receipt of receipts) {
    const dateStr = receipt.receipt_date ?? receipt.upload_date
    const total = receipt.total ?? receipt.tax_amount + (receipt.pretax ?? 0)
    if (!total || total <= 0) continue

    for (const expense of expenses) {
      const expTotal = expense.pretax + expense.tax_amount
      const score = scoreMatch(
        total,
        dateStr,
        receipt.vendor,
        expTotal,
        expense.date,
        expense.vendor
      )
      if (score < 999) rawPairs.push({ score, receiptId: receipt.id, expenseId: expense.id })
    }
  }

  const { autoMatches, needsReview } = greedyPair(rawPairs)
  const noMatch = receipts.length - autoMatches.length - needsReview

  // Apply auto-matches in parallel (receipt update + expense update per pair)
  if (autoMatches.length > 0) {
    await Promise.all(
      autoMatches.flatMap(({ receiptId, expenseId }) => [
        supabase
          .from('receipts')
          .update({ match_status: 'matched', matched_expense_id: expenseId })
          .eq('id', receiptId),
        supabase.from('business_expenses').update({ hubdoc: true }).eq('id', expenseId),
      ])
    )
  }

  return NextResponse.json({
    autoMatched: autoMatches.length,
    needsReview,
    noMatch: Math.max(0, noMatch),
    total: receipts.length,
  })
}
