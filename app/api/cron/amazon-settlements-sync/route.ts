// F17: amazon.settlements_sync feeds behavioral ingestion (payout timing, net revenue signals)
// F18: metrics → fetched/inserted/skipped/errors/net_total per run; benchmark = ~2 groups/month (biweekly payout)
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { syncSettlementsForRange } from '@/lib/amazon/settlements-sync'
import { spApiConfigured } from '@/lib/amazon/client'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const startTime = Date.now()
  const runId = crypto.randomUUID()
  const db = createServiceClient()

  if (!spApiConfigured()) {
    await db.from('agent_events').insert({
      domain: 'amazon',
      action: 'amazon_settlements_sync',
      actor: 'cron',
      status: 'warning',
      task_type: 'amazon_settlements_sync',
      output_summary:
        'SP-API not configured — set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY',
      meta: { run_id: runId, error_type: 'not_configured' },
      tags: ['amazon', 'cron'],
    })
    return NextResponse.json({ ok: true, reason: 'sp_api_not_configured', run_id: runId })
  }

  const url = new URL(request.url)
  const backfillParam = url.searchParams.get('backfill')
  const backfillDays = backfillParam ? Math.min(parseInt(backfillParam, 10) || 0, 365) : 0
  const daysBack = backfillDays > 0 ? backfillDays : 35
  const dryRun = url.searchParams.get('dry_run') === 'true'
  const isBackfill = backfillDays > 0

  await db.from('agent_events').insert({
    domain: 'amazon',
    action: 'amazon_settlements_sync_started',
    actor: 'cron',
    status: 'success',
    task_type: 'amazon_settlements_sync',
    output_summary: `amazon_settlements_sync starting: window=${daysBack}d, backfill=${isBackfill}`,
    meta: { run_id: runId, days_back: daysBack, is_backfill: isBackfill, dry_run: dryRun },
    tags: ['amazon', 'cron'],
  })

  let result: Awaited<ReturnType<typeof syncSettlementsForRange>>

  try {
    result = await syncSettlementsForRange({ daysBack, supabase: db, dryRun })
  } catch (err) {
    const durationMs = Date.now() - startTime
    await db.from('agent_events').insert({
      domain: 'amazon',
      action: 'amazon_settlements_sync_failed',
      actor: 'cron',
      status: 'error',
      task_type: 'amazon_settlements_sync',
      output_summary: `amazon_settlements_sync failed: ${err instanceof Error ? err.message : String(err)}`,
      meta: {
        run_id: runId,
        days_back: daysBack,
        is_backfill: isBackfill,
        duration_ms: durationMs,
        error: err instanceof Error ? err.message : String(err),
      },
      tags: ['amazon', 'cron', 'error'],
    })
    return NextResponse.json({
      ok: true,
      run_id: runId,
      error: 'sync_failed',
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  const durationMs = Date.now() - startTime
  const { fetched, inserted, skipped, errors } = result

  // F18: compute net total from synced settlements for digest surfacing
  let netTotal: number | null = null
  if (!dryRun && inserted > 0) {
    try {
      const since = new Date(Date.now() - daysBack * 86_400_000).toISOString()
      const { data: rows } = await db
        .from('amazon_settlements')
        .select('net_payout')
        .gte('period_end_at', since)
        .not('net_payout', 'is', null)
      if (rows && rows.length > 0) {
        netTotal =
          Math.round(
            rows.reduce((s: number, r: { net_payout: number }) => s + (r.net_payout ?? 0), 0) * 100
          ) / 100
      }
    } catch {
      // Non-fatal — net_total will be null in the event log
    }
  }

  await db.from('agent_events').insert({
    domain: 'amazon',
    action: 'amazon_settlements_sync_completed',
    actor: 'cron',
    status: errors > 0 ? 'warning' : 'success',
    task_type: 'amazon_settlements_sync',
    output_summary: `amazon_settlements_sync: fetched=${fetched} inserted=${inserted} skipped=${skipped} errors=${errors}`,
    meta: {
      run_id: runId,
      days_back: daysBack,
      is_backfill: isBackfill,
      fetched,
      inserted,
      skipped,
      errors,
      net_total: netTotal,
      duration_ms: durationMs,
    },
    tags: ['amazon', 'cron', ...(isBackfill ? ['backfill'] : [])],
  })

  return NextResponse.json({
    ok: true,
    run_id: runId,
    fetched,
    inserted,
    skipped,
    errors,
    net_total: netTotal,
    days_back: daysBack,
    is_backfill: isBackfill,
    dry_run: dryRun,
    duration_ms: durationMs,
  })
}
