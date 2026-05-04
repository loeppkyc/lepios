import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface MileageTrip {
  id: string
  date: string
  from_location: string
  to_location: string
  km: number
  purpose: string
  round_trip: boolean
  notes: string
  created_at: string
}

// ── GET /api/mileage?year=YYYY ────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')

  if (!year || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: 'year param required (YYYY)' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('mileage_log')
    .select('*')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const trips = (data ?? []) as MileageTrip[]
  // Effective km = km * (round_trip ? 2 : 1)
  const totalKm = trips.reduce((sum, t) => sum + t.km * (t.round_trip ? 2 : 1), 0)

  return NextResponse.json({ trips, totalKm: Math.round(totalKm * 10) / 10 })
}

// ── POST /api/mileage ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { date, from_location, to_location, km, purpose, round_trip, notes } = body

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (typeof from_location !== 'string' || !from_location.trim()) {
    return NextResponse.json({ error: 'from_location required' }, { status: 400 })
  }
  if (typeof to_location !== 'string' || !to_location.trim()) {
    return NextResponse.json({ error: 'to_location required' }, { status: 400 })
  }
  if (typeof km !== 'number' || km <= 0) {
    return NextResponse.json({ error: 'km must be a positive number' }, { status: 400 })
  }
  if (typeof purpose !== 'string' || !purpose.trim()) {
    return NextResponse.json({ error: 'purpose required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('mileage_log')
    .insert({
      date,
      from_location: (from_location as string).trim(),
      to_location: (to_location as string).trim(),
      km: Math.round(Number(km) * 10) / 10,
      purpose: (purpose as string).trim(),
      round_trip: round_trip === true,
      notes: typeof notes === 'string' ? (notes as string).trim() : '',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
