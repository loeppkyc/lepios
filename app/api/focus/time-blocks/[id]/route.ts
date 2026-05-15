/**
 * DELETE /api/focus/time-blocks/[id]
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from('time_blocks').delete().eq('id', id).eq('user_id', user.id)
  if (error) {
    console.error('[DELETE /api/focus/time-blocks/:id]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }
  return new NextResponse(null, { status: 204 })
}
