/**
 * GET  /api/focus/time-blocks
 * POST /api/focus/time-blocks
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PostSchema = z.object({
  block_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(1).max(24),
  label: z.string().min(1).max(100).trim(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .default('#4a9eff'),
  pomodoros_planned: z.number().int().min(0).max(16).default(0),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('user_id', user.id)
    .eq('block_date', date)
    .order('start_hour', { ascending: true })
  if (error) {
    console.error('[GET /api/focus/time-blocks]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ blocks: data ?? [] })
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
  if (d.end_hour <= d.start_hour)
    return NextResponse.json({ error: 'end_hour must be greater than start_hour' }, { status: 400 })

  const { data, error } = await supabase
    .from('time_blocks')
    .insert({
      user_id: user.id,
      block_date: d.block_date ?? new Date().toISOString().slice(0, 10),
      start_hour: d.start_hour,
      end_hour: d.end_hour,
      label: d.label,
      color: d.color,
      pomodoros_planned: d.pomodoros_planned,
    })
    .select()
    .single()
  if (error) {
    console.error('[POST /api/focus/time-blocks]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ block: data }, { status: 201 })
}
