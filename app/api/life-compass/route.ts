import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

const AREAS = ['Health & Fitness','Career & Business','Finances & Wealth','Relationships & Family','Personal Growth','Fun & Recreation','Physical Environment','Spirituality & Purpose']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('life_compass').select('*').eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const byArea = Object.fromEntries((data ?? []).map((r) => [r.area, r]))
  const rows = AREAS.map((area) => byArea[area] ?? { id: null, user_id: user.id, area, current_score: 5.0, target_score: 8.0, vision: null, actions: null, updated_at: null })
  return NextResponse.json({ compass: rows })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (typeof body.area !== 'string' || !AREAS.includes(body.area)) return NextResponse.json({ error: 'valid area required' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('life_compass').upsert({ user_id: user.id, area: body.area as string, current_score: body.current_score ?? 5.0, target_score: body.target_score ?? 8.0, vision: body.vision ?? null, actions: body.actions ?? null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,area' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row: data })
}