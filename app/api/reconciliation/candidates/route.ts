import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scoreMatch } from '@/lib/reconciliation/scoring'
import type { Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

export const revalidate = 0

export interface ReceiptCandidate {
  receipt: Receipt
  topCandidate: {
    expense: BusinessExpense
    score: number
  } | null
}

export interface CandidatesResponse {
  receipts: ReceiptCandidate[]
  unmatchedExpenses: BusinessExpense[]
}

// GET /api/reconciliation/candidates?month=YYYY-MM
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const [year, mo] = month.split('-').map(Number)
  const lastDay = new Date(year, mo, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  // Expand by 15 days for expense window (covers ±10 day fuzzy window)
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

  // Score each receipt against all unmatched expenses, pick top candidate
  const receiptCandidates: ReceiptCandidate[] = receipts.map((receipt) => {
    const dateStr = receipt.receipt_date ?? receipt.upload_date
    const total = receipt.total ?? receipt.tax_amount + (receipt.pretax ?? 0)
    if (!total || total <= 0) return { receipt, topCandidate: null }

    let best: { expense: BusinessExpense; score: number } | null = null
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
      if (score < 999 && (!best || score < best.score)) {
        best = { expense, score }
      }
    }
    return { receipt, topCandidate: best }
  })

  // Expenses that have no receipt matched to them in this month
  const matchedExpenseIds = new Set(receipts.map((r) => r.matched_expense_id).filter(Boolean))
  const unmatchedExpenses = expenses.filter((e) => !matchedExpenseIds.has(e.id))

  return NextResponse.json({
    receipts: receiptCandidates,
    unmatchedExpenses,
  } satisfies CandidatesResponse)
}
