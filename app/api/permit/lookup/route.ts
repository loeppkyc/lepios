import { NextRequest, NextResponse } from 'next/server'

const SODA_BASE = 'https://data.edmonton.ca/resource/q7d6-ambg.json'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const house = searchParams.get('house')?.trim()
  const street = searchParams.get('street')?.trim()

  if (!house || !street) {
    return NextResponse.json({ error: 'house and street are required' }, { status: 400 })
  }

  const where = `house_number='${house.replace(/'/g, "''")}' AND upper(street_name) LIKE '%${street.toUpperCase().replace(/'/g, "''").replace(/%/g, '\\%')}%'`
  const url = `${SODA_BASE}?$where=${encodeURIComponent(where)}&$limit=5`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Edmonton Open Data unavailable' }, { status: 502 })
  }

  const rows = await res.json()
  if (!rows.length) {
    return NextResponse.json({ error: 'Address not found' }, { status: 404 })
  }

  const row = rows[0]
  return NextResponse.json({
    house_number: row.house_number ?? null,
    street_name: row.street_name ?? null,
    neighbourhood: row.neighbourhood ?? null,
    tax_class: row.tax_class ?? null,
    assessed_value: row.assessed_value ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
  })
}
