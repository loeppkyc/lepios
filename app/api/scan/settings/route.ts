import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const SettingsSchema = z.object({
  min_profit_cad: z.number().min(0).max(999),
  min_roi_pct: z.number().min(0).max(999),
  max_bsr: z.number().int().min(0),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('scanner_settings')
    .select('min_profit_cad, min_roi_pct, max_bsr, updated_at')
    .eq('person_handle', 'colin') // SPRINT5-GATE: replace with user profile lookup
    .single()

  if (error || !data) {
    // Return defaults if row missing
    return NextResponse.json({ min_profit_cad: 3.0, min_roi_pct: 50.0, max_bsr: 0 })
  }
  return NextResponse.json(data)
}

export async function PUT(request: Request) {
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

  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )

  const { error } = await supabase
    .from('scanner_settings')
    .upsert({ person_handle: 'colin', ...parsed.data, updated_at: new Date().toISOString() }) // SPRINT5-GATE

  if (error) return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
