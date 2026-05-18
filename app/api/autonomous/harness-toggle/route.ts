import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const revalidate = 0

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { halted?: boolean }
  if (typeof body.halted !== 'boolean') {
    return NextResponse.json({ error: 'halted (boolean) is required' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error } = await service
    .from('harness_config')
    .update({ value: body.halted ? 'true' : 'false' })
    .eq('key', 'HARNESS_HALTED')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, halted: body.halted })
}
