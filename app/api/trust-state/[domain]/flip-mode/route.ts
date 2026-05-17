/**
 * POST /api/trust-state/[domain]/flip-mode
 *
 * Flip between paper and live mode.
 * - flip to live: requires gate_status='open'; 403 if closed.
 * - flip to paper: always allowed.
 *
 * Auth: Supabase session (F-N5)
 * Sprint 10 Chunk C
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flipToLive, flipToPaper, evaluateGate } from '@/lib/trust/gate'
import type { Domain } from '@/lib/trust/state'
import { z } from 'zod'

const FlipSchema = z.object({
  to_mode: z.enum(['live', 'paper']),
  confirmation: z.string().min(1),
  reason: z.string().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ domain: string }> }) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = FlipSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { to_mode, reason } = parsed.data
  const by = user.email ?? user.id

  try {
    if (to_mode === 'live') {
      // evaluateGate first to return useful error if gate closed
      const evaluation = await evaluateGate(domain as Domain)
      if (evaluation.gate_status !== 'open') {
        return NextResponse.json(
          {
            error: 'Gate is closed',
            failures: evaluation.failures,
            evaluation,
          },
          { status: 403 }
        )
      }
      await flipToLive(domain as Domain, by)
    } else {
      await flipToPaper(domain as Domain, by, reason ?? 'Manual flip to paper')
    }

    // Return updated evaluation
    const updated = await evaluateGate(domain as Domain)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[trust-state/flip-mode] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
