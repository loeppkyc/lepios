import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CleaningClient, CoraActivity, FamilyDate, FamilyResponse } from '@/lib/family/types'

export const revalidate = 0
export type { CleaningClient, CoraActivity, FamilyDate, FamilyResponse }

const FREQ: Record<string, number> = {
  Weekly: 4.33,
  Biweekly: 2.17,
  Monthly: 1.0,
  'One-time': 0.0,
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [clientsRes, activitiesRes, datesRes, recurringRes] = await Promise.all([
    supabase.from('cleaning_clients').select('*').order('created_at', { ascending: true }),
    supabase.from('cora_activities').select('*').order('name'),
    supabase.from('family_important_dates').select('*').order('date'),
    supabase
      .from('recurring_expense_templates')
      .select('pretax,tax_amount')
      .in('category', ['housing', 'utilities'])
      .eq('active', true),
  ])

  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 })
  if (activitiesRes.error) return NextResponse.json({ error: activitiesRes.error.message }, { status: 500 })
  if (datesRes.error) return NextResponse.json({ error: datesRes.error.message }, { status: 500 })

  let household_monthly = 5000
  let household_source: 'recurring' | 'hardcoded' = 'hardcoded'
  if (!recurringRes.error && recurringRes.data && recurringRes.data.length > 0) {
    household_monthly = recurringRes.data.reduce(
      (sum, r) => sum + (Number(r.pretax) || 0) + (Number(r.tax_amount) || 0),
      0,
    )
    household_source = 'recurring'
  }

  return NextResponse.json({
    clients: clientsRes.data ?? [],
    activities: activitiesRes.data ?? [],
    dates: datesRes.data ?? [],
    household_monthly,
    household_source,
  } satisfies FamilyResponse)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { resource: 'client' | 'activity' | 'date'; data: Record<string, unknown> }

  if (body.resource === 'client') {
    const { data, error } = await supabase.from('cleaning_clients').insert(body.data).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (body.resource === 'activity') {
    const { data, error } = await supabase.from('cora_activities').insert(body.data).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (body.resource === 'date') {
    const { data, error } = await supabase.from('family_important_dates').insert(body.data).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const resource = searchParams.get('resource')
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const tableMap: Record<string, string> = {
    client: 'cleaning_clients',
    activity: 'cora_activities',
    date: 'family_important_dates',
  }
  const table = resource ? tableMap[resource] : null
  if (!table) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })

  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export { FREQ }
