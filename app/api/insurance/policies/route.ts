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
    .from('insurance_policies')
    .select('*')
    .eq('user_id', user.id)
    .order('policy_type', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ policies: data ?? [] })
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
  if (typeof body.policy_type !== 'string') {
    return NextResponse.json({ error: 'policy_type required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('insurance_policies')
    .insert({
      user_id: user.id,
      provider: (body.provider as string).trim(),
      policy_type: body.policy_type,
      policy_number: body.policy_number ?? null,
      premium_monthly: body.premium_monthly ?? null,
      premium_annual: body.premium_annual ?? null,
      renewal_date: body.renewal_date ?? null,
      coverage_amount: body.coverage_amount ?? null,
      notes: body.notes ?? null,
      is_active: body.is_active !== false,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ policy: data })
}
