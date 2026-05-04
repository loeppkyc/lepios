/**
 * POST /api/webhooks/github-actions
 *
 * Receives GitHub workflow_run webhook events and writes agent_events rows
 * so the self_repair detector can pick them up automatically.
 *
 * Auth: HMAC-SHA256 via X-Hub-Signature-256 header + GITHUB_WEBHOOK_SECRET env var.
 * This is a public webhook — does NOT use requireCronSecret (F22 applies to
 * internal harness cron routes only, not public webhooks).
 *
 * Only processes: workflow_run events with action=completed and conclusion=failure.
 * All other events return HTTP 200 with skipped:true immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const signatureBuf = Buffer.from(signature, 'utf8')
  if (expectedBuf.length !== signatureBuf.length) return false
  return timingSafeEqual(expectedBuf, signatureBuf)
}

// ── Type guard for workflow_run payload ───────────────────────────────────────

interface WorkflowRunPayload {
  action: string
  workflow_run: {
    id: number
    name: string
    head_branch: string
    head_sha: string
    html_url: string
    conclusion: string | null
    updated_at: string
  }
}

function isWorkflowRunPayload(payload: unknown): payload is WorkflowRunPayload {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  if (typeof p['action'] !== 'string') return false
  const wr = p['workflow_run']
  if (typeof wr !== 'object' || wr === null) return false
  const w = wr as Record<string, unknown>
  return (
    typeof w['id'] === 'number' &&
    typeof w['name'] === 'string' &&
    typeof w['head_branch'] === 'string' &&
    typeof w['head_sha'] === 'string' &&
    typeof w['html_url'] === 'string' &&
    typeof w['updated_at'] === 'string'
  )
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim()

  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 })
  }

  // Read raw body text before JSON parsing — required for HMAC verification
  const body = await request.text()

  if (!signature || !verifyGitHubSignature(body, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Only care about workflow_run events that completed with failure
  if (
    !isWorkflowRunPayload(payload) ||
    payload.action !== 'completed' ||
    payload.workflow_run.conclusion !== 'failure'
  ) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const workflowName = payload.workflow_run.name.toLowerCase()
  const actionType =
    workflowName.includes('lint') || workflowName.includes('format')
      ? 'lint_failed'
      : 'deploy_failed'

  const db = createServiceClient()
  await db.from('agent_events').insert({
    domain: 'github_actions',
    action: actionType,
    actor: 'github/actions',
    status: 'error',
    meta: {
      workflow_name: payload.workflow_run.name,
      workflow_run_id: payload.workflow_run.id,
      head_branch: payload.workflow_run.head_branch,
      head_sha: payload.workflow_run.head_sha,
      html_url: payload.workflow_run.html_url,
      conclusion: payload.workflow_run.conclusion,
    },
    occurred_at: payload.workflow_run.updated_at,
  })

  return NextResponse.json({ ok: true })
}
