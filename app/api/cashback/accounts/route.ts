import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('cashback_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('card_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.card_name !== 'string' || body.card_name.trim().length === 0) {
    return NextResponse.json({ error: 'card_name required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('cashback_accounts')
    .insert({
      user_id: user.id,
      card_name: (body.card_name as string).trim(),
      portal: body.portal ?? null,
      cashback_rate_pct: body.cashback_rate_pct ?? 0,
      pending_balance: body.pending_balance ?? 0,
      total_earned_ytd: body.total_earned_ytd ?? 0,
      notes: body.notes ?? null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}
