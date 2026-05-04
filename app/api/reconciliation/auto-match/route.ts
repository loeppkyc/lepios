import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

function scoreMatch(
  receiptTotal: number,
  receiptDateStr: string,
  receiptVendor: string,
  expenseTotal: number,
  expenseDateStr: string,
  expenseVendor: string
): number {
  const tolerance = Math.max(Math.min(receiptTotal * 0.15, 20.0), 2.0)
  const amountDiff = Math.abs(expenseTotal - receiptTotal)
  if (amountDiff > tolerance) return 999

  const rMs = new Date(receiptDateStr + 'T12:00:00').getTime()
  const eMs = new Date(expenseDateStr + 'T12:00:00').getTime()
  if (isNaN(rMs) || isNaN(eMs)) return 999
  const dayDiff = Math.abs((eMs - rMs) / 86400000)
  if (dayDiff > 10) return 999

  let score = amountDiff * 10 + dayDiff * 0.5
  if (dayDiff <= 3) score -= 2

  if (receiptVendor) {
    const v1 = receiptVendor.toLowerCase()
    const v2 = expenseVendor.toLowerCase()
    const words = v1.split(/\s+/).filter((w) => w.length > 3)
    const matchCount = words.filter((w) => v2.includes(w)).length
    if (matchCount >= 2) score -= 8
    else if (matchCount === 1 || v2.includes(v1.slice(0, 6))) score -= 5
    else if (v2.includes(v1.slice(0, 4)) || v1.includes(v2.slice(0, 4))) score -= 2
  }

  if (amountDiff < 0.01) score -= 3
  return Math.max(0, score)
}

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

  // Score all receipt+expense pairs, collect (score, receiptId, expenseId)
  interface ScoredPair {
    score: number
    receipt: Receipt
    expense: BusinessExpense
  }

  const pairs: ScoredPair[] = []
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
      if (score < 999) {
        pairs.push({ score, receipt, expense })
      }
    }
  }

  // Sort by score ascending (best first), greedily claim pairs with score ≤ 1.0
  pairs.sort((a, b) => a.score - b.score)

  const claimedReceiptIds = new Set<string>()
  const claimedExpenseIds = new Set<string>()
  const autoMatches: { receiptId: string; expenseId: string }[] = []
  let needsReview = 0

  for (const pair of pairs) {
    if (claimedReceiptIds.has(pair.receipt.id)) continue
    if (claimedExpenseIds.has(pair.expense.id)) continue

    if (pair.score <= 1.0) {
      autoMatches.push({ receiptId: pair.receipt.id, expenseId: pair.expense.id })
      claimedReceiptIds.add(pair.receipt.id)
      claimedExpenseIds.add(pair.expense.id)
    } else if (pair.score <= 3.0) {
      // Only count the best unclaimed candidate per receipt for review
      if (!claimedReceiptIds.has(pair.receipt.id)) {
        needsReview++
        claimedReceiptIds.add(pair.receipt.id) // don't double-count
      }
    }
  }

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
