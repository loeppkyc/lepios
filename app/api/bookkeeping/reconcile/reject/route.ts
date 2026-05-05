import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

interface RejectBody {
  id: string
  reason: string
}

export async function POST(request: Request) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: RejectBody
  try {
    body = (await request.json()) as RejectBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!body.id || !body.reason || body.reason.trim().length === 0) {
    return NextResponse.json({ error: 'id and reason required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: txn, error: tErr } = await supabase
    .from('pending_transactions')
    .select('id, status')
    .eq('id', body.id)
    .single()
  if (tErr || !txn)
    return NextResponse.json({ error: tErr?.message ?? 'not found' }, { status: 404 })
  if (txn.status !== 'needs_review' && txn.status !== 'pending') {
    return NextResponse.json(
      { error: `cannot reject txn with status=${txn.status as string}` },
      { status: 409 }
    )
  }

  const { error: uErr } = await supabase
    .from('pending_transactions')
    .update({
      status: 'rejected',
      review_notes: body.reason.trim(),
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', body.id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
