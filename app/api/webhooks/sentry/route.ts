/**
 * POST /api/webhooks/sentry
 *
 * Receives Sentry issue-alert webhooks and writes agent_events rows so the
 * self_repair detector picks up production errors automatically.
 *
 * Auth: HMAC-SHA256 via sentry-hook-signature header + SENTRY_WEBHOOK_SECRET
 * env var. The signature is the raw hex digest of the request body (no prefix).
 *
 * This is a public webhook called by Sentry — does NOT use requireCronSecret.
 * F22 applies to internal harness cron routes only, not public webhooks.
 *
 * Only writes agent_events when:
 *   action === 'created'  AND  level === 'error' | 'fatal'
 * All other combinations (resolved, assigned, warning, info) → 200 no-op.
 *
 * Always returns 200 on valid auth + filter pass — Sentry retries on non-2xx,
 * which would cause duplicate agent_events rows.
 */

import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ── Sentry payload types ──────────────────────────────────────────────────────

interface SentryIssueAlert {
  action: string // 'created' | 'resolved' | 'assigned' | etc.
  data: {
    issue: {
      id: string // '1234567890'
      title: string // 'TypeError: Cannot read properties of undefined'
      culprit: string // 'lib/harness/push-bash/executor.ts in executeDecision'
      shortId: string // 'LEPIOS-42'
      level: string // 'error' | 'warning' | 'info' | 'debug' | 'fatal'
      platform: string // 'node' | 'javascript' | etc.
      permalink: string // 'https://sentry.io/organizations/.../issues/.../'
      project: {
        id: string
        name: string // 'lepios'
        slug: string // 'lepios'
      }
    }
  }
  installation?: { uuid: string }
}

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifySentrySignature(body: string, signature: string | null): boolean {
  const secret = process.env.SENTRY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  // timingSafeEqual requires equal-length buffers
  if (signature.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.SENTRY_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 })
  }

  // Read raw body text before JSON parsing — required for HMAC verification
  const body = await request.text()
  const signature = request.headers.get('sentry-hook-signature')

  if (!verifySentrySignature(body, signature)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }

  let payload: SentryIssueAlert
  try {
    payload = JSON.parse(body) as SentryIssueAlert
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const { action, data } = payload
  const issue = data?.issue

  // Filter: only process created events with error or fatal level
  if (action !== 'created' || !issue || (issue.level !== 'error' && issue.level !== 'fatal')) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Write agent_events row — non-fatal: log error but still return 200
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'self_repair',
      action: 'sentry_error',
      actor: 'sentry_webhook',
      status: 'error',
      task_type: 'sentry_error',
      output_summary: `Sentry ${issue.level}: ${issue.title.slice(0, 120)}`,
      meta: {
        sentry_issue_id: issue.id,
        sentry_short_id: issue.shortId,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        permalink: issue.permalink,
        project_slug: issue.project.slug,
      },
      tags: ['sentry', 'self_repair', 'webhook'],
    })
  } catch (err) {
    console.error('[sentry-webhook] DB write failed:', err)
  }

  return NextResponse.json({ ok: true })
}
