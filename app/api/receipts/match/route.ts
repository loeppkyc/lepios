import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { matchReceipt } from '@/lib/receipts/match'
import type { BankTransaction } from '@/lib/receipts/match'

// ── POST /api/receipts/match ──────────────────────────────────────────────────
// Body: { receipt_id: string }
// Runs the match pipeline for the given receipt and returns top 5 candidates.

interface MatchBody {
  receipt_id?: unknown
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  let body: MatchBody
  try {
    body = (await request.json()) as MatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { receipt_id } = body
  if (typeof receipt_id !== 'string' || !receipt_id.trim()) {
    return NextResponse.json({ error: 'receipt_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch the receipt
  const { data: receipt, error: fetchErr } = await supabase
    .from('receipt_lines')
    .select('id, receipt_date, vendor, total')
    .eq('id', receipt_id)
    .single()

  if (fetchErr || !receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  // Load recent transactions
  let transactions: BankTransaction[] = []
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data: txnData } = await supabase
      .from('bank_transactions')
      .select('id, date, description, amount')
      .gte('date', thirtyDaysAgo.toISOString().slice(0, 10))
      .limit(500)
    transactions = (txnData ?? []) as BankTransaction[]
  } catch {
    return NextResponse.json({ candidates: [], note: 'bank_transactions table not available' })
  }

  const candidates = matchReceipt(
    {
      id: receipt.id as string,
      receipt_date: receipt.receipt_date as string,
      vendor: receipt.vendor as string,
      total: receipt.total as number,
    },
    transactions,
  )

  return NextResponse.json({ candidates })
}
