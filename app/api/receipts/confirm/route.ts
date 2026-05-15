import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'

// ── POST /api/receipts/confirm ────────────────────────────────────────────────
// Body: { receipt_id: string, transaction_id: string, match_confidence: number }
// Upserts a receipt_matches row with confirmed_by='user'.
// Sets receipt_lines.reconciled = true.

interface ConfirmBody {
  receipt_id?: unknown
  transaction_id?: unknown
  match_confidence?: unknown
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  let body: ConfirmBody
  try {
    body = (await request.json()) as ConfirmBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { receipt_id, transaction_id, match_confidence } = body

  if (typeof receipt_id !== 'string' || !receipt_id.trim()) {
    return NextResponse.json({ error: 'receipt_id required' }, { status: 400 })
  }
  if (typeof transaction_id !== 'string' || !transaction_id.trim()) {
    return NextResponse.json({ error: 'transaction_id required' }, { status: 400 })
  }
  const confidence = typeof match_confidence === 'number' ? match_confidence : 0

  const supabase = createServiceClient()

  // Verify receipt exists
  const { data: receipt, error: fetchErr } = await supabase
    .from('receipt_lines')
    .select('id')
    .eq('id', receipt_id)
    .single()

  if (fetchErr || !receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  // Upsert the match record (unique index on receipt_id ensures one match per receipt)
  const { error: matchErr } = await supabase.from('receipt_matches').upsert(
    {
      receipt_id,
      transaction_id,
      match_confidence: parseFloat(confidence.toFixed(4)),
      auto_confirmed: false,
      confirmed_at: now,
      confirmed_by: 'user',
    },
    { onConflict: 'receipt_id' },
  )

  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 })
  }

  // Mark receipt as reconciled
  const { error: updateErr } = await supabase
    .from('receipt_lines')
    .update({ reconciled: true })
    .eq('id', receipt_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ confirmed: true, receipt_id, transaction_id })
}
