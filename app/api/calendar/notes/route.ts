import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const month = searchParams.get('month')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let query = supabase.from('calendar_notes').select('*').eq('user_id', user.id).order('note_date', { ascending: true })
  if (year && month) {
    const y = parseInt(year, 10); const m = parseInt(month, 10)
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`
    const endDate = new Date(y, m, 0).toISOString().slice(0, 10)
    query = query.gte('note_date', startDate).lte('note_date', endDate)
  }
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (typeof body.note_date !== 'string') return NextResponse.json({ error: 'note_date required' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('calendar_notes').insert({ user_id: user.id, note_date: body.note_date as string, title: (body.title as string).trim(), body: body.body ?? null, category: body.category ?? 'general', all_day: body.all_day ?? true }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}