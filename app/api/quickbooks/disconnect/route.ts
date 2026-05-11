import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnect } from '@/lib/quickbooks/client'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await disconnect()
  return NextResponse.json({ ok: true })
}
