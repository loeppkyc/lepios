// F17: gmail.scan events feed behavioral ingestion; statement_arrivals feed financial state
// F18: surfacing query: SELECT * FROM gmail_daily_scan_runs ORDER BY started_at DESC LIMIT 30
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { createGmailService, GmailNotConfiguredError } from '@/lib/gmail/client'
import { scanMessages, filterNewMessages, insertMessages } from '@/lib/gmail/scan'
import {
  classifyStatementArrival,
  insertStatementArrivals,
  type StatementArrivalResult,
} from '@/lib/gmail/classifiers/statement-arrivals'
import { recordAttribution } from '@/lib/attribution/writer'

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const startTime = Date.now()
  const runId = crypto.randomUUID()
  const db = createServiceClient()

  // Open audit row — optimistic status='ok', downgraded to 'partial'/'error' on failure.
  // invoices_classified / receipts_classified stay 0; deferred until PR #40 merges.
  // intentionally passing id explicitly — same uuid is used in agent_events.meta.run_id
  // for direct cross-table correlation; bypasses migration's DEFAULT gen_random_uuid()
  await db.from('gmail_daily_scan_runs').insert({
    id: runId,
    started_at: new Date().toISOString(),
    status: 'ok',
  })

  // Step 1: Authenticate Gmail — if not configured, close row and return 200
  // (never crash the cron — Vercel retries on 5xx)
  let service: Awaited<ReturnType<typeof createGmailService>>
  try {
    service = await createGmailService()
  } catch (err) {
    const isConfigError = err instanceof GmailNotConfiguredError
    const errMsg = err instanceof Error ? err.message : String(err)

    await db
      .from('gmail_daily_scan_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: isConfigError ? 'skipped_unconfigured' : 'error',
        errors_count: isConfigError ? 0 : 1,
        error_summary: isConfigError ? null : errMsg.slice(0, 500),
      })
      .eq('id', runId)

    await db.from('agent_events').insert({
      domain: 'gmail',
      action: 'gmail.scan',
      actor: 'cron',
      status: isConfigError ? 'warning' : 'failure',
      task_type: 'gmail_scan',
      output_summary: isConfigError
        ? 'Gmail not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
        : `Gmail auth error: ${errMsg}`,
      meta: {
        run_id: runId,
        error: errMsg,
        error_type: isConfigError ? 'not_configured' : 'auth_error',
      },
      tags: ['gmail', 'cron'],
    })
    return NextResponse.json({ ok: true, reason: 'gmail_not_configured', run_id: runId })
  }

  // Step 2: Determine scan window from last successful run watermark.
  // Falls back to 25h if no prior successful run (first deploy behavior unchanged).
  // Current run has finished_at=null so .not('finished_at','is',null) excludes it safely.
  const { data: wmRow } = await db
    .from('gmail_daily_scan_runs')
    .select('finished_at')
    .eq('status', 'ok')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const afterDate = wmRow?.finished_at
    ? new Date(wmRow.finished_at as string)
    : new Date(Date.now() - 25 * 60 * 60 * 1000)

  // Load known senders for confidence scoring (all non-ignored senders)
  const { data: knownSenderRows } = await db
    .from('gmail_known_senders')
    .select('email_address')
    .neq('trust_level', 'ignore')

  const knownSendersSet = new Set<string>(
    (knownSenderRows ?? []).map((r: { email_address: string }) => r.email_address)
  )

  let rawMessages: Awaited<ReturnType<typeof scanMessages>> = []
  let newMessages: typeof rawMessages = []
  let statementResults: StatementArrivalResult[] = []
  let errorsCount = 0
  let errorSummary: string | null = null

  // Steps 3–5: Scan, dedup, persist — hard failure closes row as 'error', returns 200
  try {
    rawMessages = await scanMessages(service, afterDate)
    newMessages = await filterNewMessages(rawMessages, db)
    await insertMessages(newMessages, db)
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errMsg = err instanceof Error ? err.message : String(err)

    await db
      .from('gmail_daily_scan_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'error',
        messages_fetched: rawMessages.length,
        messages_new: newMessages.length,
        errors_count: 1,
        error_summary: errMsg.slice(0, 500),
      })
      .eq('id', runId)

    await db.from('agent_events').insert({
      domain: 'gmail',
      action: 'gmail.scan',
      actor: 'cron',
      status: 'failure',
      task_type: 'gmail_scan',
      output_summary: `gmail.scan failed: ${errMsg}`,
      meta: {
        run_id: runId,
        scanned: rawMessages.length,
        new_messages: newMessages.length,
        dedup_hits: rawMessages.length - newMessages.length,
        statement_arrivals_classified: 0,
        duration_ms: durationMs,
        error: errMsg,
      },
      tags: ['gmail', 'cron', 'error'],
    })
    return NextResponse.json({ ok: true, run_id: runId, error: 'scan_failed', reason: errMsg })
  }

  // Steps 6–7: Classify — isolated try/catch so failure downgrades to 'partial', not 'error'.
  // TODO(post-#40): add classifyInvoice + classifyReceipt here via Promise.allSettled
  try {
    statementResults = newMessages
      .map((msg) => classifyStatementArrival(msg, knownSendersSet))
      .filter((r): r is StatementArrivalResult => r !== null)

    await insertStatementArrivals(statementResults, db)
  } catch (err) {
    errorsCount += 1
    errorSummary = (err instanceof Error ? err.message : String(err)).slice(0, 500)
  }

  const durationMs = Date.now() - startTime
  const scanned = rawMessages.length
  const newMessageCount = newMessages.length
  const dedupHits = scanned - newMessageCount
  const classified = statementResults.length
  const finalStatus = errorsCount > 0 ? 'partial' : 'ok'

  // Step 8: Close the audit row with final counts
  await db
    .from('gmail_daily_scan_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: finalStatus,
      messages_fetched: scanned,
      messages_new: newMessageCount,
      statements_classified: classified,
      invoices_classified: 0, // deferred: blocked on PR #40
      receipts_classified: 0, // deferred: blocked on PR #40
      errors_count: errorsCount,
      error_summary: errorSummary,
    })
    .eq('id', runId)

  // Step 9: Log agent_events — F18 measurement
  await db.from('agent_events').insert({
    domain: 'gmail',
    action: 'gmail.scan',
    actor: 'cron',
    status: finalStatus === 'ok' ? 'success' : 'warning',
    task_type: 'gmail_scan',
    output_summary: `gmail.scan: scanned=${scanned} new=${newMessageCount} dedup=${dedupHits} classified=${classified}`,
    meta: {
      run_id: runId,
      scanned,
      new_messages: newMessageCount,
      dedup_hits: dedupHits,
      statement_arrivals_classified: classified,
      duration_ms: durationMs,
    },
    tags: ['gmail', 'cron'],
  })

  // Step 10: Attribution — fire-and-forget, never await result for correctness
  void recordAttribution(
    { actor_type: 'cron', actor_id: 'gmail-scan-cron' },
    { type: 'gmail_scan', id: runId },
    'scan_completed',
    { scanned, classified }
  )

  void recordAttribution(
    { actor_type: 'cron', actor_id: 'gmail-scan-cron' },
    { type: 'gmail_statement_arrival', id: 'batch' },
    'classified',
    { count: classified }
  )

  return NextResponse.json({
    ok: true,
    run_id: runId,
    scanned,
    new_messages: newMessageCount,
    classified,
    duration_ms: durationMs,
    status: finalStatus,
  })
}

export async function POST(request: Request) {
  return GET(request)
}
