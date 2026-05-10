import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Inserts a pending_drain_triggers row so pg_cron fires the drain within 5 min.
// No auth: triggering a drain is non-destructive and the drain endpoint itself
// is CRON_SECRET-protected.
export async function POST() {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('pending_drain_triggers')
    .insert({ triggered_by: 'force_resend_banner' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
