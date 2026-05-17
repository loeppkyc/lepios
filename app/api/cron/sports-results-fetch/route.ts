/**
 * POST /api/cron/sports-results-fetch
 *
 * Daily cron at 11pm MT (0 5 * * * UTC next day).
 * Resolves unresolved predictions (domain='sports') from prior days
 * by fetching scores from The Odds API.
 * Generates AI debrief per settled pick.
 * Triggers trust_state recompute after settling.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk B
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { oddsToPayout } from '@/lib/sports/odds'
import { generateDebrief } from '@/lib/sports/coach'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

interface OddsApiScore {
  id: string
  sport_key: string
  completed: boolean
  scores: { name: string; score: string }[] | null
}

async function fetchScores(sportKey: string, apiKey: string): Promise<OddsApiScore[]> {
  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/scores/`)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('daysFrom', '2')
  try {
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
    if (resp.status === 200) return (await resp.json()) as OddsApiScore[]
    return []
  } catch {
    return []
  }
}

function getWinner(game: OddsApiScore): string | null {
  if (!game.completed || !game.scores || game.scores.length < 2) return null
  const [a, b] = game.scores
  const scoreA = parseInt(a.score, 10)
  const scoreB = parseInt(b.score, 10)
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA === scoreB) return null
  return scoreA > scoreB ? a.name : b.name
}

interface PredictionRow {
  id: string
  game_id: string | null
  sport: string | null
  league: string | null
  home_team: string | null
  away_team: string | null
  bet_on: string | null
  odds: number | null
  implied_prob: number | null
  ai_rating: number | null
}

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()
  const apiKey = process.env.ODDS_API_KEY ?? ''

  // 1. Find unresolved sports predictions from yesterday and earlier
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const cutoff = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  const { data: unsettled, error: fetchErr } = await supabase
    .from('predictions')
    .select(
      'id, game_id, sport, league, home_team, away_team, bet_on, odds, implied_prob, ai_rating'
    )
    .eq('domain', 'sports')
    .is('resolved_at', null)
    .lte('pick_date', cutoff)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const predictions = (unsettled ?? []) as PredictionRow[]

  if (!predictions.length) {
    await supabase.from('agent_events').insert({
      domain: 'sports',
      action: 'sports_results_fetch',
      meta: { settled_count: 0, skipped_count: 0, errors: 0 },
      created_at: new Date().toISOString(),
    })
    return NextResponse.json({ settled: 0, skipped: 0 })
  }

  // 2. Group by sport key and fetch scores
  // Map sport display name back to API key for fetching
  const SPORT_TO_KEY: Record<string, string> = {
    NHL: 'icehockey_nhl',
    CFL: 'americanfootball_cfl',
    NBA: 'basketball_nba',
    NFL: 'americanfootball_nfl',
    MLB: 'baseball_mlb',
    MLS: 'soccer_usa_mls',
    EPL: 'soccer_epl',
    UCL: 'soccer_uefa_champs_league',
    'UEFA CL': 'soccer_uefa_champs_league',
    MMA: 'mma_mixed_martial_arts',
    'UFC/MMA': 'mma_mixed_martial_arts',
    ATP: 'tennis_atp_singles',
    'ATP Tennis': 'tennis_atp_singles',
    WTA: 'tennis_wta_singles',
    'WTA Tennis': 'tennis_wta_singles',
    PGA: 'golf_pga_championship_winner',
    'PGA Golf': 'golf_pga_championship_winner',
  }

  const leagues = [...new Set(predictions.map((p) => p.league ?? p.sport ?? ''))]
  const scoresByGameId = new Map<string, string>()

  await Promise.all(
    leagues.map(async (league) => {
      if (!apiKey) return
      const sportKey = SPORT_TO_KEY[league] ?? league.toLowerCase().replace(/ /g, '_')
      const scores = await fetchScores(sportKey, apiKey)
      for (const game of scores) {
        const winner = getWinner(game)
        if (winner) scoresByGameId.set(game.id, winner)
      }
    })
  )

  // 3. Settle each matched prediction
  let settledCount = 0
  let skippedCount = 0
  let errorCount = 0
  const FLAT_STAKE = 100 // $100 flat paper stake

  await Promise.all(
    predictions.map(async (pred) => {
      if (!pred.game_id) {
        skippedCount++
        return
      }
      const winner = scoresByGameId.get(pred.game_id)
      if (!winner) {
        skippedCount++
        return
      }

      const won = winner === pred.bet_on
      const actualPnl = won ? oddsToPayout(pred.odds ?? -150, FLAT_STAKE) : -FLAT_STAKE

      // Generate AI debrief
      let aiNotes: Record<string, unknown> | null = null
      try {
        const debrief = await generateDebrief(
          {
            league: pred.league ?? pred.sport ?? 'Unknown',
            home: pred.home_team ?? '',
            away: pred.away_team ?? '',
            bet_on: pred.bet_on ?? undefined,
            odds: pred.odds ?? undefined,
            implied_prob: pred.implied_prob ?? undefined,
            stake: FLAT_STAKE,
            pnl: actualPnl,
          },
          won ? 'Win' : 'Loss'
        )
        aiNotes = debrief as unknown as Record<string, unknown>
      } catch {
        // debrief failure is non-blocking
      }

      const { error: updateErr } = await supabase
        .from('predictions')
        .update({
          won,
          actual_pnl: actualPnl,
          actual_result: won ? 'win' : 'loss',
          resolved_at: new Date().toISOString(),
          ...(aiNotes ? { ai_notes: aiNotes } : {}),
        })
        .eq('id', pred.id)

      if (updateErr) {
        errorCount++
      } else {
        settledCount++
      }
    })
  )

  // 4. Log to agent_events
  await supabase.from('agent_events').insert({
    domain: 'sports',
    action: 'sports_results_fetch',
    meta: { settled_count: settledCount, skipped_count: skippedCount, errors: errorCount },
    created_at: new Date().toISOString(),
  })

  // 5. If we settled any, trigger trust_state recompute via trust-state route
  if (settledCount > 0) {
    const secret = getCronSecret()
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
    try {
      await fetch(`${base}/api/harness/notifications-drain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      })
    } catch {
      // non-blocking
    }
  }

  return NextResponse.json({ settled: settledCount, skipped: skippedCount, errors: errorCount })
}
