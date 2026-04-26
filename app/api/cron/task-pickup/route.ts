import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { runPickup } from '@/lib/harness/pickup-runner'
import { runStallCheck } from '@/lib/harness/stall-check'
import { checkPurposeReviewTimeouts } from '@/lib/purpose-review/timeout'

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

  if (!process.env.TASK_PICKUP_ENABLED) {
    return NextResponse.json({ ok: false, reason: 'task-pickup-disabled', duration_ms: 0 })
  }

  try {
    const runId = crypto.randomUUID()

    // Stall check runs BEFORE task-claim logic — always, even if no task is claimable.
    // Non-fatal: stall check errors are captured in the result and do not block pickup.
    const stallCheckResult = await runStallCheck().catch((err: unknown) => ({
      alerts_fired: 0,
      alerts_deduped: 0,
      triggers_checked: [] as ('T1' | 'T2' | 'T3' | 'T5')[],
      errors: [String(err)],
    }))

    // P1 — G2: wire purpose review timeout sweep (was dead code before this commit)
    // Non-fatal: a timeout-check failure must not block task pickup.
    const purposeReviewTimeouts = await checkPurposeReviewTimeouts().catch(() => 0)

    const result = await Promise.race([
      runPickup(runId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('task pickup exceeded 60s timeout')), 60_000)
      ),
    ])
    return NextResponse.json({
      ...result,
      stall_check: stallCheckResult,
      purpose_review_timeouts: purposeReviewTimeouts,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
