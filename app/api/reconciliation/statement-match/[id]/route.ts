import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/reconciliation/statement-match/[id]
// Actions:
//   confirm   — mark match_status='manual', set confirmed_at (used for review-level matches)
//   dismiss   — mark match_status='dismissed', clear receipt_id (no receipt for this txn)
//   assign    — set receipt_id + match_status='manual', set confirmed_at
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: { action?: unknown; receipt_id?: unknown }
  try {
    body = (await request.json()) as { action?: unknown; receipt_id?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { action, receipt_id } = body
  if (!['confirm', 'dismiss', 'assign'].includes(action as string)) {
    return NextResponse.json(
      { error: 'action must be confirm | dismiss | assign' },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  type UpdatePayload = {
    match_status: string
    confirmed_at: string
    receipt_id?: string | null
  }

  let update: UpdatePayload
  if (action === 'confirm') {
    update = { match_status: 'manual', confirmed_at: new Date().toISOString() }
  } else if (action === 'dismiss') {
    update = { match_status: 'dismissed', receipt_id: null, confirmed_at: new Date().toISOString() }
  } else {
    // assign
    if (typeof receipt_id !== 'string' || !receipt_id) {
      return NextResponse.json({ error: 'receipt_id required for assign' }, { status: 400 })
    }
    update = { match_status: 'manual', receipt_id, confirmed_at: new Date().toISOString() }
  }

  const { data, error } = await supabase
    .from('statement_receipt_matches')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/reconciliation/statement-match/[id] — create a new match for a transaction
// transaction_id is the [id] param; body: { receipt_id?, action: 'dismiss' | 'assign' }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: transaction_id } = await params
  if (!transaction_id)
    return NextResponse.json({ error: 'transaction_id required' }, { status: 400 })

  let body: { action?: unknown; receipt_id?: unknown }
  try {
    body = (await request.json()) as { action?: unknown; receipt_id?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { action, receipt_id } = body
  if (!['dismiss', 'assign'].includes(action as string)) {
    return NextResponse.json({ error: 'action must be dismiss | assign' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row =
    action === 'dismiss'
      ? {
          transaction_id,
          receipt_id: null,
          match_status: 'dismissed',
          confirmed_at: new Date().toISOString(),
        }
      : {
          transaction_id,
          receipt_id: receipt_id as string,
          match_status: 'manual',
          match_score: 0,
          confirmed_at: new Date().toISOString(),
        }

  const { data, error } = await supabase
    .from('statement_receipt_matches')
    .upsert(row, { onConflict: 'transaction_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
