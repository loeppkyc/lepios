import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    name?: string
    type?: string
    asin?: string | null
    url?: string | null
    alert_on?: string
    threshold_price?: number | null
    check_interval_min?: number
    notes?: string | null
  }

  const { name, type, asin, url, alert_on, threshold_price, check_interval_min, notes } = body

  if (!name || !type) {
    return NextResponse.json({ error: 'name and type required' }, { status: 400 })
  }

  const validTypes = ['amazon-asin', 'lego-ca', 'generic-url']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  if (type === 'amazon-asin' && !asin) {
    return NextResponse.json({ error: 'asin required for amazon-asin type' }, { status: 400 })
  }

  if ((type === 'lego-ca' || type === 'generic-url') && !url) {
    return NextResponse.json(
      { error: 'url required for lego-ca and generic-url types' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('watch_targets')
    .insert({
      name,
      type,
      asin: asin ?? null,
      url: url ?? null,
      alert_on: alert_on ?? 'in_stock',
      threshold_price: threshold_price ?? null,
      check_interval_min: check_interval_min ?? 10,
      notes: notes ?? null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ target: data })
}
