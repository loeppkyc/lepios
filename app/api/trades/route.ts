/**
 * GET  /api/trades  — list trades (authenticated)
 * POST /api/trades  — log a new trade (authenticated)
 *
 * Auth: session (Supabase auth cookie)
 * person_handle is always set server-side to 'colin' // SPRINT5-GATE
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const TradeInsertSchema = z.object({
  trade_date: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  mode: z.enum(['paper', 'live']).default('paper'),
  horizon: z.enum(['day', 'swing']),
  direction: z.enum(['long', 'short']),
  ticker: z.string().min(1),
  instrument_type: z.enum(['future', 'stock', 'commodity', 'index']).default('stock'),
  price_in: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive(),
  position_size: z.number().positive().default(1),
  mood: z.string().optional(),
  comments: z.string().optional(),
  prediction_id: z.string().uuid().optional(),
})

const TradeQuerySchema = z.object({
  from: z.string().regex(DATE_RE).optional(),
  to: z.string().regex(DATE_RE).optional(),
  mode: z.enum(['paper', 'live']).optional(),
  direction: z.enum(['long', 'short']).optional(),
  ticker: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(50)
    .transform((n) => Math.min(n, 200)),
})

// ── GET /api/trades ───────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const parsed = TradeQuerySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    mode: searchParams.get('mode') ?? undefined,
    direction: searchParams.get('direction') ?? undefined,
    ticker: searchParams.get('ticker') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const q = parsed.data

  let query = supabase
    .from('trades')
    .select('*')
    .order('trade_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(q.limit)

  if (q.from) query = query.gte('trade_date', q.from)
  if (q.to) query = query.lte('trade_date', q.to)
  if (q.mode) query = query.eq('mode', q.mode)
  if (q.direction) query = query.eq('direction', q.direction)
  if (q.ticker) query = query.eq('ticker', q.ticker)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/trades]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ trades: data ?? [] })
}

// ── POST /api/trades ──────────────────────────────────────────────────────────

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

  const parsed = TradeInsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const d = parsed.data

  const { data, error } = await supabase
    .from('trades')
    .insert({
      trade_date: d.trade_date,
      mode: d.mode,
      horizon: d.horizon,
      direction: d.direction,
      ticker: d.ticker,
      instrument_type: d.instrument_type,
      price_in: d.price_in,
      stop_loss: d.stop_loss,
      take_profit: d.take_profit,
      position_size: d.position_size,
      mood: d.mood ?? null,
      comments: d.comments ?? null,
      prediction_id: d.prediction_id ?? null,
      person_handle: 'colin', // SPRINT5-GATE
      _source: 'lepios',
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/trades]', error)
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ trade: data }, { status: 201 })
}
