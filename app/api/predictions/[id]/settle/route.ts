/**
 * POST /api/predictions/[id]/settle — settle a prediction with the actual result.
 *
 * Updates the row: actual_result, outcome, settled_at.
 * Logs to agent_events: domain=behavioral, action=prediction_settled.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logEvent } from '@/lib/knowledge/client'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  const issues: Array<{ path: string[]; message: string }> = []
  if (!b.actual_result || typeof b.actual_result !== 'string' || b.actual_result.trim() === '')
    issues.push({ path: ['actual_result'], message: 'Actual result is required' })
  if (!b.outcome || !['correct', 'wrong', 'partial'].includes(b.outcome as string))
    issues.push({ path: ['outcome'], message: 'Outcome must be correct, wrong, or partial' })

  if (issues.length > 0)
    return NextResponse.json({ error: 'Validation failed', issues }, { status: 400 })

  // Fetch the original prediction so we can log calibration gap
  const { data: existing, error: fetchError } = await supabase
    .from('predictions')
    .select('id, sport, confidence, outcome')
    .eq('id', id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (fetchError || !existing)
    return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })

  if (existing.outcome !== null)
    return NextResponse.json({ error: 'Prediction already settled' }, { status: 409 })

  const { data, error } = await supabase
    .from('predictions')
    .update({
      actual_result: (b.actual_result as string).trim(),
      outcome: b.outcome as string,
      settled_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Calibration gap for this single prediction:
  // confidence (1-10 mapped to %) - accuracy% (correct=100, wrong=0, partial=50)
  const accuracyPct =
    b.outcome === 'correct' ? 100 : b.outcome === 'wrong' ? 0 : 50
  const calibrationGapPoint =
    Math.round((existing.confidence * 10 - accuracyPct) * 10) / 10

  void logEvent('behavioral', 'prediction_settled', {
    actor: 'user',
    status: 'success',
    entity: id,
    meta: {
      sport: existing.sport,
      outcome: b.outcome,
      confidence: existing.confidence,
      calibration_gap_point: calibrationGapPoint,
    },
  })

  return NextResponse.json({ prediction: data })
}
