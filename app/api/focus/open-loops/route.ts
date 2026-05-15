/**
 * GET  /api/focus/open-loops
 * POST /api/focus/open-loops
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PostSchema = z.object({ text: z.string().min(1).max(500).trim() })

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'open'

  const { data, error } = await supabase
    .from('open_loops')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[GET /api/focus/open-loops]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ loops: data ?? [] })
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

  const { data, error } = await supabase
    .from('open_loops')
    .insert({ user_id: user.id, text: parsed.data.text })
    .select()
    .single()
  if (error) {
    console.error('[POST /api/focus/open-loops]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ loop: data }, { status: 201 })
}
