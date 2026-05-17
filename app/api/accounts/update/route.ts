import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, balance, as_of_date } = await req.json()
  if (!id || balance === undefined) return NextResponse.json({ error: 'Missing id or balance' }, { status: 400 })

  const { error } = await supabase
    .from('balance_sheet_entries')
    .update({ balance, as_of_date: as_of_date ?? new Date().toISOString().slice(0, 10) })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
