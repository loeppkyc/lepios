/**
 * POST /api/harness/consensus
 *
 * F22-compliant: uses requireCronSecret from lib/auth/cron-secret.ts.
 *
 * Runs the 3+1 debate consensus pipeline (3x Sonnet fan-out + 1x Opus fan-in)
 * and returns the consensus result. Raw perspectives and raw consensus text are
 * written to consensus_runs but NOT returned in the HTTP response body.
 * Callers that need them should query consensus_runs by runId.
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runConsensus } from '@/lib/harness/consensus/runner'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const ConsensusRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  agentId: z.string().optional(),
  reason: z.string().optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = ConsensusRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  try {
    const result = await runConsensus(parsed.data.prompt, {
      agentId: parsed.data.agentId,
      reason: parsed.data.reason,
    })

    // Return consensus result WITHOUT rawPerspectives or rawConsensus —
    // those are stored in consensus_runs for callers that need them.
    return NextResponse.json({
      runId: result.runId,
      consensusLevel: result.consensusLevel,
      answer: result.answer,
      splits: result.splits,
      outliers: result.outliers,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
