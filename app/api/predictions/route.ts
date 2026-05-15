/**
 * GET  /api/predictions  — list predictions (authenticated)
 * POST /api/predictions  — create a prediction (authenticated)
 *
 * Default filter: domain='trading' unless specified.
 * Auth: session (Supabase auth cookie)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const PredictionQuerySchema = z.object({
  domain: z.enum(['trading', 'sports']).default('trading'),
  mode: z.enum(['paper', 'live']).optional(),
  grade: z.enum(['A', 'B+', 'B', 'C']).optional(),
  resolved: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(50)
    .transform((n) => Math.min(n, 200)),
})

const PredictionInsertSchema = z.object({
  domain: z.enum(['trading', 'sports']).default('trading'),
  pick_date: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  grade: z.enum(['A', 'B+', 'B', 'C']),
  confidence: z.number().min(0).max(10),
  reason: z.string().min(1),
  mode: z.enum(['paper', 'live']).default('paper'),
  // trading fields
  ticker: z.string().optional(),
  direction: z.enum(['long', 'short']).optional(),
  entry_price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
  target_price: z.number().positive().optional(),
  atr: z.number().positive().optional(),
  risk_reward: z.number().positive().optional(),
  raw_score: z.number().optional(),
  weighted_score: z.number().optional(),
  weights_snapshot: z.record(z.string(), z.number()).optional(),
  // sports fields
  sport: z.string().optional(),
  league: z.string().optional(),
  game_id: z.string().optional(),
  home_team: z.string().optional(),
  away_team: z.string().optional(),
  bet_on: z.string().optional(),
  odds: z.number().int().optional(),
  implied_prob: z.number().optional(),
  ai_rating: z.number().optional(),
})

// ── GET /api/predictions ──────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const parsed = PredictionQuerySchema.safeParse({
    domain: searchParams.get('domain') ?? undefined,
    mode: searchParams.get('mode') ?? undefined,
    grade: searchParams.get('grade') ?? undefined,
    resolved: searchParams.get('resolved') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const q = parsed.data

  let query = supabase
    .from('predictions')
    .select('*')
    .eq('domain', q.domain)
    .order('generated_at', { ascending: false })
    .limit(q.limit)

  if (q.mode) query = query.eq('mode', q.mode)
  if (q.grade) query = query.eq('grade', q.grade)
  if (q.resolved === true) query = query.not('resolved_at', 'is', null)
  if (q.resolved === false) query = query.is('resolved_at', null)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/predictions]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ predictions: data ?? [] })
}

// ── POST /api/predictions ─────────────────────────────────────────────────────

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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PredictionInsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      domain: d.domain,
      pick_date: d.pick_date,
      grade: d.grade,
      confidence: d.confidence,
      reason: d.reason,
      mode: d.mode,
      ticker: d.ticker ?? null,
      direction: d.direction ?? null,
      entry_price: d.entry_price ?? null,
      stop_price: d.stop_price ?? null,
      target_price: d.target_price ?? null,
      atr: d.atr ?? null,
      risk_reward: d.risk_reward ?? null,
      raw_score: d.raw_score ?? null,
      weighted_score: d.weighted_score ?? null,
      weights_snapshot: d.weights_snapshot ?? null,
      sport: d.sport ?? null,
      league: d.league ?? null,
      game_id: d.game_id ?? null,
      home_team: d.home_team ?? null,
      away_team: d.away_team ?? null,
      bet_on: d.bet_on ?? null,
      odds: d.odds ?? null,
      implied_prob: d.implied_prob ?? null,
      ai_rating: d.ai_rating ?? null,
      person_handle: 'colin', // SPRINT5-GATE
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/predictions]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ prediction: data }, { status: 201 })
}
