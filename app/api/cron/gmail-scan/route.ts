// F17: gmail.scan events feed behavioral ingestion; statement_arrivals feed financial state
import crypto from 'crypto'
import { NextResponse } from 'next/server'
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

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: no secret configured
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const runId = crypto.randomUUID()
  const db = createServiceClient()

  // Step 1: Authenticate Gmail — if not configured, log warning and return 200
  // (never crash the cron — Vercel retries on 5xx)
  let service: Awaited<ReturnType<typeof createGmailService>>
  try {
    service = await createGmailService()
  } catch (err) {
    const isConfigError = err instanceof GmailNotConfiguredError
    await db.from('agent_events').insert({
      domain: 'gmail',
      action: 'gmail.scan',
      actor: 'cron',
      status: isConfigError ? 'warning' : 'failure',
      task_type: 'gmail_scan',
      output_summary: isConfigError
        ? 'Gmail not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
        : `Gmail auth error: ${err instanceof Error ? err.message : String(err)}`,
      meta: {
        run_id: runId,
        error: err instanceof Error ? err.message : String(err),
        error_type: isConfigError ? 'not_configured' : 'auth_error',
      },
      tags: ['gmail', 'cron'],
    })
    return NextResponse.json({ ok: true, reason: 'gmail_not_configured', run_id: runId })
  }

  // Step 2: Set scan window — 25h back to handle hourly cron with overlap buffer
  const afterDate = new Date(Date.now() - 25 * 60 * 60 * 1000)

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

  try {
    // Step 3: Scan Gmail for messages in the 25h window
    rawMessages = await scanMessages(service, afterDate)

    // Step 4: Filter to only new (not-yet-stored) messages
    newMessages = await filterNewMessages(rawMessages, db)

    // Step 5: Persist new messages
    await insertMessages(newMessages, db)

    // Step 6–7: Classify each new message and collect statement arrivals
    statementResults = newMessages
      .map((msg) => classifyStatementArrival(msg, knownSendersSet))
      .filter((r): r is StatementArrivalResult => r !== null)

    await insertStatementArrivals(statementResults, db)
  } catch (err) {
    const durationMs = Date.now() - startTime
    // On any Gmail API error mid-scan: log failure, return 200
    await db.from('agent_events').insert({
      domain: 'gmail',
      action: 'gmail.scan',
      actor: 'cron',
      status: 'failure',
      task_type: 'gmail_scan',
      output_summary: `gmail.scan failed: ${err instanceof Error ? err.message : String(err)}`,
      meta: {
        run_id: runId,
        scanned: rawMessages.length,
        new_messages: newMessages.length,
        dedup_hits: rawMessages.length - newMessages.length,
        statement_arrivals_classified: statementResults.length,
        duration_ms: durationMs,
        error: err instanceof Error ? err.message : String(err),
      },
      tags: ['gmail', 'cron', 'error'],
    })
    return NextResponse.json({
      ok: true,
      run_id: runId,
      error: 'scan_failed',
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  const durationMs = Date.now() - startTime
  const scanned = rawMessages.length
  const newMessageCount = newMessages.length
  const dedupHits = scanned - newMessageCount
  const classified = statementResults.length

  // Step 8: Log agent_events — F18 measurement
  await db.from('agent_events').insert({
    domain: 'gmail',
    action: 'gmail.scan',
    actor: 'cron',
    status: 'success',
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

  // Step 9: Attribution — fire-and-forget, never await result for correctness
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

  // Step 10: Return summary
  return NextResponse.json({
    ok: true,
    run_id: runId,
    scanned,
    new_messages: newMessageCount,
    classified,
    duration_ms: durationMs,
  })
}
