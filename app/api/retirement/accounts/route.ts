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
    .from('retirement_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('account_type', { ascending: true })

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

  if (typeof body.account_name !== 'string' || body.account_name.trim().length === 0) {
    return NextResponse.json({ error: 'account_name required' }, { status: 400 })
  }
  if (typeof body.provider !== 'string' || body.provider.trim().length === 0) {
    return NextResponse.json({ error: 'provider required' }, { status: 400 })
  }
  if (typeof body.account_type !== 'string') {
    return NextResponse.json({ error: 'account_type required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('retirement_accounts')
    .insert({
      user_id: user.id,
      account_name: (body.account_name as string).trim(),
      provider: (body.provider as string).trim(),
      account_type: body.account_type,
      balance: body.balance ?? 0,
      annual_contribution: body.annual_contribution ?? null,
      employer_match_pct: body.employer_match_pct ?? null,
      target_retirement_age: body.target_retirement_age ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}
