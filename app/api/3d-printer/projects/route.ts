import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('printer_projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projects: data ?? [] })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('printer_projects').insert({ user_id: user.id, name: (body.name as string).trim(), status: body.status ?? 'queued', material: body.material ?? null, filament_used_g: body.filament_used_g ?? null, print_time_min: body.print_time_min ?? null, notes: body.notes ?? null, started_at: body.started_at ?? null, finished_at: body.finished_at ?? null }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}