import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDebrief } from '@/lib/sports/debrief'
import type { SportsPick } from '@/lib/sports/picks'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { pick_id: string }
  if (!body.pick_id) {
    return NextResponse.json({ error: 'pick_id required' }, { status: 400 })
  }

  // Load the pick
  const { data: pick, error: fetchErr } = await supabase
    .from('sports_picks')
    .select('*')
    .eq('id', body.pick_id)
    .single()

  if (fetchErr || !pick) {
    return NextResponse.json({ error: 'Pick not found' }, { status: 404 })
  }

  // Only debrief settled picks
  if (pick.fav_won === null) {
    return NextResponse.json({ error: 'Pick is not yet settled' }, { status: 400 })
  }

  const result = await generateDebrief(pick as SportsPick)

  // Store debrief in sports_picks.ai_debrief
  const { error: updateErr } = await supabase
    .from('sports_picks')
    .update({ ai_debrief: result, updated_at: new Date().toISOString() })
    .eq('id', body.pick_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ debrief: result, pick_id: body.pick_id })
}
