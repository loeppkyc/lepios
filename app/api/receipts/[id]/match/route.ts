import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── PATCH /api/receipts/[id]/match ────────────────────────────────────────────
// Body: { expenseId: string } — links receipt to an expense and marks hubdoc=true
// Body: { expenseId: null }  — unlinks (reverts to unmatched)

interface MatchBody {
  expenseId?: string | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: MatchBody
  try {
    body = (await request.json()) as MatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { expenseId } = body
  const unlinking = expenseId === null || expenseId === undefined

  if (!unlinking && typeof expenseId !== 'string') {
    return NextResponse.json({ error: 'expenseId must be a UUID string or null' }, { status: 400 })
  }

  // Fetch current receipt to know previous matched_expense_id
  const { data: receipt, error: fetchError } = await supabase
    .from('receipts')
    .select('matched_expense_id')
    .eq('id', id)
    .single()

  if (fetchError || !receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // If there was a previously matched expense, clear its hubdoc flag
  if (receipt.matched_expense_id) {
    await supabase
      .from('business_expenses')
      .update({ hubdoc: false })
      .eq('id', receipt.matched_expense_id)
  }

  if (unlinking) {
    // Unlink: revert receipt to unmatched
    const { error } = await supabase
      .from('receipts')
      .update({ match_status: 'unmatched', matched_expense_id: null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ unlinked: true })
  }

  // Link: verify expense exists, then update both records
  const { data: expense, error: expFetchError } = await supabase
    .from('business_expenses')
    .select('id')
    .eq('id', expenseId)
    .single()

  if (expFetchError || !expense) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  const { error: receiptError } = await supabase
    .from('receipts')
    .update({ match_status: 'matched', matched_expense_id: expenseId })
    .eq('id', id)

  if (receiptError) return NextResponse.json({ error: receiptError.message }, { status: 500 })

  const { error: expenseError } = await supabase
    .from('business_expenses')
    .update({ hubdoc: true })
    .eq('id', expenseId)

  if (expenseError) return NextResponse.json({ error: expenseError.message }, { status: 500 })

  return NextResponse.json({ matched: true, expenseId })
}
