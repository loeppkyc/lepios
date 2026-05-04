/**
 * POST /api/harness/push-bash
 *
 * Classifies a shell/git command and executes according to policy tier:
 *   - auto   → runs via sandbox, returns result
 *   - confirm → writes pending audit row, sends Telegram alert, returns immediately
 *   - block  → writes blocked audit row, returns immediately (never executes)
 *
 * F22: auth via requireCronSecret (fail-closed — 500 when CRON_SECRET unset).
 * Returns HTTP 200 for all three tiers; caller checks `tier` field.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { z } from 'zod'
import { decideAction } from '@/lib/harness/push-bash/policy'
import { executeDecision } from '@/lib/harness/push-bash/executor'

// ── Request schema ─────────────────────────────────────────────────────────────

const PushBashRequestSchema = z.object({
  cmd: z.string().min(1).max(2000),
  agentId: z.string().optional(),
  branch: z.string().optional(),
  reason: z.string().optional(),
})

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // F22 — requireCronSecret returns null on success, NextResponse on failure
  const authError = requireCronSecret(request)
  if (authError) return authError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = PushBashRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { cmd, agentId, branch, reason } = parsed.data

  try {
    const decision = decideAction(cmd, { agentId, branch, reason })
    const result = await executeDecision(cmd, decision, { agentId, branch, reason })

    // Omit stdout/stderr/exitCode for non-auto tiers
    const response: Record<string, unknown> = {
      decisionId: result.decisionId,
      tier: result.tier,
      status: result.status,
      reason: result.reason,
    }
    if (result.tier === 'auto') {
      response.exitCode = result.exitCode
      response.stdout = result.stdout ?? ''
      response.stderr = result.stderr ?? ''
    }

    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'internal', message }, { status: 500 })
  }
}
