/**
 * GET  /api/predictions  — list predictions + stats (authenticated)
 * POST /api/predictions  — log a new prediction (authenticated)
 *
 * Table: predictions (migration 0223)
 * F17: This is the foundation of the behavioral ingestion spec.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logEvent } from '@/lib/knowledge/client'

// ── GET /api/predictions ──────────────────────────────────────────────────────
// Returns last 50 predictions + computed summary stats.

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // SPRINT5-GATE: replace with profiles table lookup before adding any second auth user
  const { data, error } = await supabase
    .from('predictions')
    .select(
      'id, sport, event_desc, prediction, confidence, game_date, notes, actual_result, outcome, settled_at, created_at'
    )
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const settled = rows.filter((r) => r.outcome !== null && r.outcome !== undefined)
  const total = rows.length
  const settledCount = settled.length
  const correctCount = settled.filter((r) => r.outcome === 'correct').length
  const wrongCount = settled.filter((r) => r.outcome === 'wrong').length
  const partialCount = settled.filter((r) => r.outcome === 'partial').length

  const pctCorrect =
    settledCount > 0 ? Math.round((correctCount / settledCount) * 1000) / 10 : null
  const pctWrong = settledCount > 0 ? Math.round((wrongCount / settledCount) * 1000) / 10 : null
  const pctPartial =
    settledCount > 0 ? Math.round((partialCount / settledCount) * 1000) / 10 : null

  // Avg confidence across settled predictions (1–10 scale)
  const avgConfidence =
    settledCount > 0
      ? Math.round((settled.reduce((s, r) => s + r.confidence, 0) / settledCount) * 10) / 10
      : null

  // Calibration gap: (avg confidence as %) minus (% correct)
  // e.g. avg confidence 7/10 = 70%, % correct = 60% → gap = +10 (overconfident)
  // Positive = overconfident, negative = underconfident
  const calibrationGap =
    avgConfidence !== null && pctCorrect !== null
      ? Math.round((avgConfidence * 10 - pctCorrect) * 10) / 10
      : null

  return NextResponse.json({
    predictions: rows,
    stats: {
      total,
      settled: settledCount,
      pct_correct: pctCorrect,
      pct_wrong: pctWrong,
      pct_partial: pctPartial,
      avg_confidence: avgConfidence,
      calibration_gap: calibrationGap,
    },
  })
}

// ── POST /api/predictions ─────────────────────────────────────────────────────
// Log a new prediction.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  const issues: Array<{ path: string[]; message: string }> = []
  if (!b.sport || typeof b.sport !== 'string' || b.sport.trim() === '')
    issues.push({ path: ['sport'], message: 'Sport is required' })
  if (!b.event_desc || typeof b.event_desc !== 'string' || b.event_desc.trim() === '')
    issues.push({ path: ['event_desc'], message: 'Event description is required' })
  if (!b.prediction || typeof b.prediction !== 'string' || b.prediction.trim() === '')
    issues.push({ path: ['prediction'], message: 'Prediction is required' })
  if (
    b.confidence === undefined ||
    typeof b.confidence !== 'number' ||
    !Number.isInteger(b.confidence) ||
    b.confidence < 1 ||
    b.confidence > 10
  )
    issues.push({ path: ['confidence'], message: 'Confidence must be an integer between 1 and 10' })
  if (!b.game_date || typeof b.game_date !== 'string' || b.game_date.trim() === '')
    issues.push({ path: ['game_date'], message: 'Game date is required' })
  if (typeof b.notes === 'string' && b.notes.length > 500)
    issues.push({ path: ['notes'], message: 'Notes must be 500 characters or fewer' })

  if (issues.length > 0)
    return NextResponse.json({ error: 'Validation failed', issues }, { status: 400 })

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      person_handle: 'colin', // SPRINT5-GATE
      sport: (b.sport as string).trim(),
      event_desc: (b.event_desc as string).trim(),
      prediction: (b.prediction as string).trim(),
      confidence: b.confidence as number,
      game_date: (b.game_date as string).trim(),
      notes: typeof b.notes === 'string' && b.notes.trim() !== '' ? b.notes.trim() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void logEvent('behavioral', 'prediction_logged', {
    actor: 'user',
    status: 'success',
    entity: data.id,
    meta: {
      sport: data.sport,
      confidence: data.confidence,
      has_notes: data.notes !== null,
    },
  })

  return NextResponse.json({ prediction: data }, { status: 201 })
}
