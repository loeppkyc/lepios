/**
 * PATCH /api/trust-state/[domain]/thresholds
 *
 * Update trust gate thresholds. Each value must be within sane bounds.
 * If currently live and any threshold is loosened, flags loosened_while_live in agent_events.
 *
 * Auth: Supabase session (F-N5)
 * Sprint 10 Chunk C
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { TrustStateRow, Domain } from '@/lib/trust/state'
import { z } from 'zod'

// Sane bounds per the acceptance doc
const ThresholdsSchema = z.object({
  min_sample_size: z.number().int().min(10).max(500).optional(),
  win_rate_threshold: z.number().min(0.4).max(0.8).optional(),
  secondary_metric_threshold: z.number().min(-1).max(10).optional(),
  calibration_threshold: z.number().min(0.3).max(0.9).optional(),
  max_drawdown_threshold: z.number().min(0.05).max(0.5).optional(),
})

export async function PATCH(request: Request, context: { params: Promise<{ domain: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain } = await context.params

  if (domain !== 'trading' && domain !== 'sports') {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ThresholdsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Load current thresholds to detect loosening
  const svcSupabase = createServiceClient()
  const { data: current, error: fetchErr } = await svcSupabase
    .from('trust_state')
    .select('*')
    .eq('domain', domain)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'trust_state row not found' }, { status: 404 })
  }

  const ts = current as TrustStateRow

  // Detect loosening (any threshold decrease that makes it easier to pass)
  const loosened: string[] = []
  if (updates.min_sample_size != null && updates.min_sample_size < ts.min_sample_size) {
    loosened.push(`min_sample_size: ${ts.min_sample_size} → ${updates.min_sample_size}`)
  }
  if (updates.win_rate_threshold != null && updates.win_rate_threshold < ts.win_rate_threshold) {
    loosened.push(`win_rate_threshold: ${ts.win_rate_threshold} → ${updates.win_rate_threshold}`)
  }
  if (
    updates.secondary_metric_threshold != null &&
    updates.secondary_metric_threshold < ts.secondary_metric_threshold
  ) {
    loosened.push(
      `secondary_metric_threshold: ${ts.secondary_metric_threshold} → ${updates.secondary_metric_threshold}`
    )
  }
  if (
    updates.calibration_threshold != null &&
    updates.calibration_threshold < ts.calibration_threshold
  ) {
    loosened.push(
      `calibration_threshold: ${ts.calibration_threshold} → ${updates.calibration_threshold}`
    )
  }
  if (
    updates.max_drawdown_threshold != null &&
    updates.max_drawdown_threshold > ts.max_drawdown_threshold
  ) {
    loosened.push(
      `max_drawdown_threshold: ${ts.max_drawdown_threshold} → ${updates.max_drawdown_threshold}`
    )
  }

  const loosenedWhileLive = loosened.length > 0 && ts.current_mode === 'live'

  // Apply update
  const { data: updated, error: updateErr } = await svcSupabase
    .from('trust_state')
    .update(updates)
    .eq('domain', domain)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Log event
  await svcSupabase.from('agent_events').insert({
    domain,
    action: 'trust_thresholds_updated',
    meta: {
      updates,
      by: user.email ?? user.id,
      loosened: loosened.length > 0 ? loosened : undefined,
      loosened_while_live: loosenedWhileLive || undefined,
    },
    created_at: new Date().toISOString(),
  })

  return NextResponse.json({
    trust_state: updated,
    loosened_while_live: loosenedWhileLive,
    loosened: loosened.length > 0 ? loosened : undefined,
  })
}
