import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const habitId = searchParams.get('habit_id')
  const since = searchParams.get('since')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let query = supabase.from('habit_entries').select('*').eq('user_id', user.id).order('completed_on', { ascending: false })
  if (habitId) query = query.eq('habit_id', habitId)
  if (since) query = query.gte('completed_on', since)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (typeof body.habit_id !== 'string') return NextResponse.json({ error: 'habit_id required' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('habit_entries').upsert({ user_id: user.id, habit_id: body.habit_id as string, completed_on: body.completed_on ?? new Date().toISOString().slice(0, 10), count: body.count ?? 1, notes: body.notes ?? null }, { onConflict: 'habit_id,completed_on' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data })
}