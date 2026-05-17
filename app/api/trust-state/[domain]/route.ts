/**
 * GET /api/trust-state/[domain]
 *
 * Returns full GateEvaluation for a specific domain.
 * Auth: Supabase session (F-N5)
 *
 * Sprint 10 Chunk C
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { evaluateGate } from '@/lib/trust/gate'
import type { Domain } from '@/lib/trust/state'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ domain: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain } = await context.params

  if (domain !== 'trading' && domain !== 'sports') {
    return NextResponse.json(
      { error: 'Invalid domain — must be trading or sports' },
      { status: 400 }
    )
  }

  try {
    const evaluation = await evaluateGate(domain as Domain)
    return NextResponse.json(evaluation)
  } catch (err) {
    console.error('[trust-state/[domain]] evaluateGate failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
