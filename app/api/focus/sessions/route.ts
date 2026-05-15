/**
 * GET  /api/focus/sessions  — list today's focus sessions
 * POST /api/focus/sessions  — create a new focus session
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PostSchema = z.object({
  label: z.string().min(1).max(200).trim().default('Focus Session'),
  duration_minutes: z.number().int().min(1).max(120).default(25),
  pomodoro_type: z.enum(['work', 'short_break', 'long_break']).default('work'),
  time_block_id: z.string().uuid().optional(),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('focus_sessions')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', todayStart.toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/focus/sessions]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ sessions: data ?? [] })
}

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

  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  const { data, error } = await supabase
    .from('focus_sessions')
    .insert({
      user_id: user.id,
      label: d.label,
      duration_minutes: d.duration_minutes,
      pomodoro_type: d.pomodoro_type,
      time_block_id: d.time_block_id ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/focus/sessions]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ session: data }, { status: 201 })
}
