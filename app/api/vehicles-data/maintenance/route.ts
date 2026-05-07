import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.vehicle_id !== 'string' || !body.vehicle_id) {
    return NextResponse.json({ error: 'vehicle_id required' }, { status: 400 })
  }
  if (!isYmd(body.service_date)) {
    return NextResponse.json({ error: 'service_date required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (typeof body.service !== 'string' || body.service.trim().length === 0) {
    return NextResponse.json({ error: 'service required' }, { status: 400 })
  }

  const km = body.km != null && body.km !== '' ? Number(body.km) : null
  if (km != null && (!Number.isInteger(km) || km < 0)) {
    return NextResponse.json({ error: 'km must be a non-negative integer' }, { status: 400 })
  }
  const cost = body.cost != null && body.cost !== '' ? Number(body.cost) : null
  if (cost != null && !Number.isFinite(cost)) {
    return NextResponse.json({ error: 'cost must be a finite number' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .insert({
      vehicle_id: body.vehicle_id,
      service_date: body.service_date as string,
      km,
      service: body.service.trim(),
      cost,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ maintenance: data })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('vehicle_maintenance').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
