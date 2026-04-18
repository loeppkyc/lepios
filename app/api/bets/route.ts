import { createClient } from '@/lib/supabase/server'
import { americanToImpliedProb, kellyPct } from '@/lib/kelly'
import { BetInsertSchema, BetQuerySchema } from '@/lib/schemas/bet'
import { NextResponse } from 'next/server'

const BET_SELECT_COLS = [
  'id',
  'bet_date',
  'sport',
  'league',
  'home_team',
  'away_team',
  'bet_on',
  'bet_type',
  'odds',
  'closing_odds',
  'implied_prob',
  'kelly_pct',
  'bankroll_before',
  'stake',
  'result',
  'pnl',
  'bankroll_after',
  'book',
  'ai_notes',
  'created_at',
  'updated_at',
].join(', ')

// ── GET /api/bets ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const parsed = BetQuerySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    result: searchParams.get('result') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters', issues: parsed.error.issues }, { status: 400 })
  }

  const { from, to, result, limit } = parsed.data

  // Build filter chain first — order/limit must come last (PostgREST requirement)
  // TODO Sprint 5: derive person_handle from user session mapping
  let query = supabase
    .from('bets')
    .select(BET_SELECT_COLS)
    .eq('person_handle', 'colin')

  if (from) query = query.gte('bet_date', from)
  if (to) query = query.lte('bet_date', to)
  if (result) query = query.eq('result', result)

  const { data, error } = await query.order('bet_date', { ascending: false }).limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bets: data ?? [], count: data?.length ?? 0 })
}

// ── POST /api/bets ────────────────────────────────────────────────────────────

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

  const parsed = BetInsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const betData = parsed.data

  // Compute server-side fields — never trust client for these
  const impliedProb = americanToImpliedProb(betData.odds)
  const kellyPctValue = kellyPct(impliedProb, betData.odds)

  const { data, error } = await supabase
    .from('bets')
    .insert({
      ...betData,
      implied_prob: impliedProb,
      kelly_pct: kellyPctValue,
      person_handle: 'colin', // TODO Sprint 5: derive from session user mapping
      _source: 'lepios',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bet: data }, { status: 201 })
}
