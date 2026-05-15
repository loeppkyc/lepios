/**
 * PATCH /api/focus/open-loops/[id]
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const PatchSchema = z.object({ status: z.enum(['resolved', 'dismissed']) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { data, error } = await supabase
    .from('open_loops')
    .update({ status: parsed.data.status, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()
  if (error) {
    console.error('[PATCH /api/focus/open-loops/:id]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ loop: data })
}
