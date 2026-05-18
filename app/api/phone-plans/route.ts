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
    .from('phone_plans')
    .select('*')
    .eq('user_id', user.id)
    .order('carrier', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.carrier !== 'string' || body.carrier.trim().length === 0) {
    return NextResponse.json({ error: 'carrier required' }, { status: 400 })
  }
  if (typeof body.plan_name !== 'string' || body.plan_name.trim().length === 0) {
    return NextResponse.json({ error: 'plan_name required' }, { status: 400 })
  }
  const cost = Number(body.monthly_cost)
  if (!Number.isFinite(cost) || cost < 0) {
    return NextResponse.json(
      { error: 'monthly_cost must be a non-negative number' },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('phone_plans')
    .insert({
      user_id: user.id,
      carrier: (body.carrier as string).trim(),
      plan_name: (body.plan_name as string).trim(),
      monthly_cost: cost,
      data_gb: body.data_gb ?? null,
      renewal_date: body.renewal_date ?? null,
      phone_model: body.phone_model ?? null,
      phone_owner: body.phone_owner ?? null,
      notes: body.notes ?? null,
      is_active: body.is_active !== false,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plan: data })
}
