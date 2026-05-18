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
    .from('utility_bills')
    .select('*')
    .eq('user_id', user.id)
    .order('utility_type', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bills: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.provider !== 'string' || body.provider.trim().length === 0) {
    return NextResponse.json({ error: 'provider required' }, { status: 400 })
  }
  if (typeof body.utility_type !== 'string') {
    return NextResponse.json({ error: 'utility_type required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('utility_bills')
    .insert({
      user_id: user.id,
      provider: (body.provider as string).trim(),
      utility_type: body.utility_type,
      monthly_avg: body.monthly_avg ?? null,
      last_bill_amount: body.last_bill_amount ?? null,
      last_bill_date: body.last_bill_date ?? null,
      auto_pay: body.auto_pay === true,
      account_number: body.account_number ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bill: data })
}
