/**
 * GET /api/trading/composite
 *
 * Computes (or returns 30-min cached) composite confidence score.
 * Logs result to agent_events on fresh computation.
 *
 * Auth: requires active session.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { computeCompositeConfidence } from '@/lib/trading/composite'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  try {
    const result = await computeCompositeConfidence()
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
