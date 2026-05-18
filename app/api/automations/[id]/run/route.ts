import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch automation to verify ownership
  const { data: automation, error: fetchErr } = await supabase
    .from('automations')
    .select('id, run_count')
    .eq('id', id)
    .single()

  if (fetchErr || !automation) {
    return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('automations')
    .update({
      run_count: (automation.run_count ?? 0) + 1,
      last_run_at: now,
      updated_at: now,
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ran_at: now })
}
