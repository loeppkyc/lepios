// F17: amazon.orders_sync feeds behavioral ingestion (order frequency, revenue signals)
// F18: metrics captured → fetched/inserted/skipped/errors per run; benchmark = baseline orders/day
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { syncOrdersForRange } from '@/lib/amazon/orders-sync'
import { spApiConfigured } from '@/lib/amazon/client'

export const dynamic = 'force-dynamic'

// SP-API daily order baseline (updated after first week of data).
// Surfacing: morning_digest "Amazon sync (24h): N (vs baseline ~X/day)".
const BASELINE_ORDERS_PER_DAY = null as number | null // null = not yet calibrated

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const startTime = Date.now()
  const runId = crypto.randomUUID()
  const db = createServiceClient()

  // SP-API credentials check — warn and return 200 (never crash the cron)
  if (!spApiConfigured()) {
    await db.from('agent_events').insert({
      domain: 'amazon',
      action: 'amazon_orders_sync',
      actor: 'cron',
      status: 'warning',
      task_type: 'amazon_orders_sync',
      output_summary:
        'SP-API not configured — set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN, AMAZON_AWS_ACCESS_KEY, AMAZON_AWS_SECRET_KEY',
      meta: { run_id: runId, error_type: 'not_configured' },
      tags: ['amazon', 'cron'],
    })
    return NextResponse.json({ ok: true, reason: 'sp_api_not_configured', run_id: runId })
  }

  // Determine sync window.
  // Default: last 2 days (1-day overlap catches late-arriving order updates).
  // ?backfill=N: last N days (first-run or gap fill).
  const url = new URL(request.url)
  const backfillParam = url.searchParams.get('backfill')
  const backfillDays = backfillParam ? Math.min(parseInt(backfillParam, 10) || 0, 365) : 0
  const daysBack = backfillDays > 0 ? backfillDays : 2
  // ?dry_run=true → fetch + count but do not write to DB (for pre-backfill inspection)
  const dryRun = url.searchParams.get('dry_run') === 'true'

  const endDate = new Date()
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
  const isBackfill = backfillDays > 0

  // Log sync start
  await db.from('agent_events').insert({
    domain: 'amazon',
    action: 'amazon_orders_sync_started',
    actor: 'cron',
    status: 'success',
    task_type: 'amazon_orders_sync',
    output_summary: `amazon_orders_sync starting: window=${daysBack}d, backfill=${isBackfill}`,
    meta: {
      run_id: runId,
      days_back: daysBack,
      is_backfill: isBackfill,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    },
    tags: ['amazon', 'cron'],
  })

  let result: Awaited<ReturnType<typeof syncOrdersForRange>>

  try {
    result = await syncOrdersForRange({ startDate, endDate, supabase: db, dryRun })
  } catch (err) {
    const durationMs = Date.now() - startTime
    await db.from('agent_events').insert({
      domain: 'amazon',
      action: 'amazon_orders_sync_failed',
      actor: 'cron',
      status: 'failure',
      task_type: 'amazon_orders_sync',
      output_summary: `amazon_orders_sync failed: ${err instanceof Error ? err.message : String(err)}`,
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

  // F18: benchmark comparison (shown in digest via buildAmazonOrdersSyncLine)
  const vsBaseline =
    BASELINE_ORDERS_PER_DAY !== null
      ? ` (baseline ~${BASELINE_ORDERS_PER_DAY}/day)`
      : ' (baseline: not yet calibrated)'

  await db.from('agent_events').insert({
    domain: 'amazon',
    action: 'amazon_orders_sync_completed',
    actor: 'cron',
    status: errors > 0 ? 'warning' : 'success',
    task_type: 'amazon_orders_sync',
    output_summary: `amazon_orders_sync: fetched=${fetched} inserted=${inserted} skipped=${skipped} errors=${errors}${vsBaseline}`,
    meta: {
      run_id: runId,
      days_back: daysBack,
      is_backfill: isBackfill,
      fetched,
      inserted,
      skipped,
      errors,
      baseline_orders_per_day: BASELINE_ORDERS_PER_DAY,
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
    days_back: daysBack,
    is_backfill: isBackfill,
    dry_run: dryRun,
    duration_ms: durationMs,
  })
}
