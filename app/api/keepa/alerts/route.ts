import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

// GET — list all price alerts
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('keepa_price_alerts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST — add a new alert
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { asin, title, alertType, threshold, notes } = body as Record<string, unknown>

  if (!asin || typeof asin !== 'string' || !asin.trim()) {
    return NextResponse.json({ error: 'asin is required' }, { status: 400 })
  }
  if (
    !alertType ||
    !['price_below', 'price_above', 'rank_below', 'rank_above'].includes(alertType as string)
  ) {
    return NextResponse.json({ error: 'Invalid alertType' }, { status: 400 })
  }
  if (!threshold || Number(threshold) <= 0) {
    return NextResponse.json({ error: 'threshold must be > 0' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('keepa_price_alerts')
    .insert({
      asin: asin.trim().toUpperCase(),
      title: typeof title === 'string' ? title : null,
      alert_type: alertType,
      threshold: Number(threshold),
      notes: typeof notes === 'string' ? notes : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 })

  void logEvent('keepa', 'alert.create', {
    actor: 'user',
    status: 'success',
    entity: data.id,
    outputSummary: `Alert: ${asin} ${alertType} ${threshold}`,
  })

  return NextResponse.json(data, { status: 201 })
}

// DELETE — remove an alert by id (?id=uuid)
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('keepa_price_alerts').delete().eq('id', id)

  if (error) return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
