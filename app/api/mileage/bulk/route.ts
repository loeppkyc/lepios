import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ParsedTrip } from '@/app/api/mileage/import/route'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let trips: ParsedTrip[]
  try {
    trips = (await request.json()) as ParsedTrip[]
    if (!Array.isArray(trips) || trips.length === 0) throw new Error('empty')
  } catch {
    return NextResponse.json({ error: 'Expected non-empty JSON array' }, { status: 400 })
  }

  if (trips.length > 2000) {
    return NextResponse.json({ error: 'Max 2000 trips per import' }, { status: 400 })
  }

  const rows = trips.map((t) => ({
    date: t.date,
    from_location: String(t.from_location).trim(),
    to_location: String(t.to_location).trim(),
    km: Math.round(Number(t.km) * 10) / 10,
    purpose: String(t.purpose || 'Business drive').trim(),
    round_trip: t.round_trip === true,
    notes: String(t.notes || '').trim(),
  }))

  const { error, count } = await supabase.from('mileage_log').insert(rows, { count: 'exact' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ inserted: count ?? rows.length }, { status: 201 })
}
