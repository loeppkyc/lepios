// Manual Oura sync — user-facing endpoint behind Supabase auth.
// Cron route (/api/cron/oura-sync) handles the nightly sync via CRON_SECRET.
// This route is what the page's "Sync from Oura" button hits.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncOura } from '@/lib/oura/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ALLOWED_DAYS = new Set([7, 14, 30])

export async function POST(request: Request) {
  // Auth: must be a signed-in user.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const daysParam = Number(url.searchParams.get('days') ?? '7')
  const days = ALLOWED_DAYS.has(daysParam) ? daysParam : 7

  // Service-role client for the upsert (bypasses RLS write guard; user is
  // already authenticated above, this is the same trust boundary as the cron).
  const db = createServiceClient()
  const started = Date.now()

  // Read token from harness_config (S-L1 — runtime config in DB, not env).
  const { data: cfg } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'OURA_TOKEN')
    .single()

  if (!cfg?.value) {
    return NextResponse.json(
      { ok: false, error: 'OURA_TOKEN not set in harness_config' },
      { status: 503 }
    )
  }

  try {
    const result = await syncOura(db, cfg.value as string, days)

    await db.from('agent_events').insert({
      domain: 'health',
      action: 'oura.sync.manual',
      actor: user.email ?? user.id,
      status: 'success',
      duration_ms: Date.now() - started,
      output_summary: `upserted ${result.rowsUpserted} days (${result.startDate} to ${result.endDate})`,
      meta: { days: result.rowsUpserted, days_requested: days },
    })

    return NextResponse.json({
      ok: true,
      days: result.rowsUpserted,
      start_date: result.startDate,
      end_date: result.endDate,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      await db.from('agent_events').insert({
        domain: 'health',
        action: 'oura.sync.manual',
        actor: user.email ?? user.id,
        status: 'error',
        duration_ms: Date.now() - started,
        error_message: msg,
      })
    } catch {
      // best-effort log
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
