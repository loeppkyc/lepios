/**
 * POST /api/cron/sports-picks-scan
 *
 * Daily cron at 8am MT (0 14 * * * UTC).
 * Scans today's odds, filters Green-tier favorites (<= -150),
 * runs Claude analysis on each candidate, writes picks to predictions table.
 * Dispatches Telegram summary.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk B
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getTodaysGames,
  filterFavorites,
  americanToImpliedProb,
  oddsToPayout,
} from '@/lib/sports/odds'
import type { Game } from '@/lib/sports/odds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Green tier: odds <= -150
const GREEN_TIER_MAX_ODDS = -150

// AI rating minimum for a pick to be written
const AI_RATING_MIN = 7.0 // TODO: tune with real data — from seed weights

type GradeResult = 'A' | 'B+' | 'B' | 'C'

function gradeFromRating(rating: number): GradeResult {
  if (rating >= 9) return 'A'
  if (rating >= 8) return 'B+'
  if (rating >= 7) return 'B'
  return 'C'
}

interface PickAnalysis {
  rating: number
  key_factors: string[]
  trap_flag: string | null
  confidence_review: string
}

async function analyzePickWithClaude(game: Game): Promise<PickAnalysis> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const impliedPct = (americanToImpliedProb(game.fav_odds) * 100).toFixed(1)

  const prompt = `Game: ${game.home} @ ${game.away} (${game.league}). Odds: ${game.favorite} at ${game.fav_odds}. Implied prob: ${impliedPct}%. Rate this bet 1-10 PURELY ON VALUE — not on whether it will win. Identify 2-3 key factors. State one trap signal if any. Return JSON only: { "rating": number, "key_factors": ["..."], "trap_flag": "..." or null, "confidence_review": "..." }`

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = (resp.content[0] as { type: string; text: string }).text
      .trim()
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')

    return JSON.parse(text) as PickAnalysis
  } catch {
    // Fail safe: return neutral analysis
    return {
      rating: 6.0,
      key_factors: ['Unable to analyze — using default rating'],
      trap_flag: null,
      confidence_review: 'Analysis unavailable',
    }
  }
}

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()
  const apiKey = process.env.ODDS_API_KEY ?? ''
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  // ── Load active sports weights ──────────────────────────────────────────────
  const { data: weightsRow } = await supabase
    .from('prediction_weights')
    .select('weights')
    .eq('domain', 'sports')
    .eq('is_active', true)
    .single()

  const weights = weightsRow?.weights as {
    max_odds?: number
    min_implied_prob?: number
    ai_rating_min?: number
  } | null

  const maxOdds = weights?.max_odds ?? GREEN_TIER_MAX_ODDS
  const aiRatingMin = weights?.ai_rating_min ?? AI_RATING_MIN

  // ── Fetch today's games ─────────────────────────────────────────────────────
  let games: Game[] = []
  try {
    games = await getTodaysGames(apiKey)
  } catch (err) {
    console.error('[sports-picks-scan] getTodaysGames failed:', err)
    await supabase.from('agent_events').insert({
      domain: 'sports',
      action: 'sports_picks_scan_error',
      meta: { error: String(err), date: today },
      created_at: new Date().toISOString(),
    })
    return NextResponse.json(
      { error: 'Failed to fetch odds', detail: String(err) },
      { status: 500 }
    )
  }

  // Log API usage
  await supabase.from('agent_events').insert({
    domain: 'sports',
    action: 'odds_api_call',
    meta: { games_fetched: games.length, date: today },
    created_at: new Date().toISOString(),
  })

  // ── Filter Green tier ───────────────────────────────────────────────────────
  const greenGames = filterFavorites(games, maxOdds)

  if (!greenGames.length) {
    await supabase.from('agent_events').insert({
      domain: 'sports',
      action: 'sports_picks_scan',
      meta: { date: today, picks_written: 0, green_candidates: 0, games_fetched: games.length },
      created_at: new Date().toISOString(),
    })
    return NextResponse.json({ ok: true, date: today, picks: 0, green_candidates: 0 })
  }

  // ── Analyze each green candidate with Claude ────────────────────────────────
  const analyses = await Promise.all(
    greenGames.map(async (game) => ({
      game,
      analysis: await analyzePickWithClaude(game),
    }))
  )

  // ── Filter by AI rating threshold ───────────────────────────────────────────
  const qualifiedPicks = analyses.filter((a) => a.analysis.rating >= aiRatingMin)

  // ── Write to predictions table ─────────────────────────────────────────────
  let writtenCount = 0
  const writtenPicks: {
    ticker?: string
    league: string
    grade: GradeResult
    confidence: number
  }[] = []

  for (const { game, analysis } of qualifiedPicks) {
    const grade = gradeFromRating(analysis.rating)
    const impliedProb = americanToImpliedProb(game.fav_odds)

    const { error: insertErr } = await supabase.from('predictions').insert({
      domain: 'sports',
      pick_date: today,
      grade,
      confidence: analysis.rating,
      reason: analysis.confidence_review,
      tier: 'green',
      sport: game.league,
      league: game.league,
      game_id: game.game_id,
      home_team: game.home,
      away_team: game.away,
      bet_on: game.favorite,
      odds: game.fav_odds,
      implied_prob: Math.round(impliedProb * 100 * 100) / 100,
      ai_rating: analysis.rating,
      mode: 'paper',
      person_handle: 'colin', // SPRINT5-GATE
    })

    if (!insertErr) {
      writtenCount++
      writtenPicks.push({ league: game.league, grade, confidence: analysis.rating })
    } else {
      console.error('[sports-picks-scan] insert failed:', insertErr.message)
    }
  }

  // ── Dispatch Telegram ───────────────────────────────────────────────────────
  if (writtenCount > 0) {
    const { data: cfg } = await supabase
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .single()

    const chatId = cfg?.value ? Number(cfg.value) : undefined

    const pickLines = qualifiedPicks.slice(0, writtenCount).map(({ game, analysis }) => {
      const impliedPct = (americanToImpliedProb(game.fav_odds) * 100).toFixed(0)
      const payout = oddsToPayout(game.fav_odds, 100).toFixed(0)
      return `${gradeFromRating(analysis.rating)} ${game.favorite} (${game.league}) ${game.fav_odds} | ${impliedPct}% | +$${payout} on $100`
    })

    const trapLines = qualifiedPicks
      .filter((a) => a.analysis.trap_flag)
      .map((a) => `TRAP: ${a.analysis.trap_flag}`)

    const lines = [
      `Sports Picks — ${today}`,
      `${writtenCount} pick${writtenCount === 1 ? '' : 's'} (${greenGames.length} Green-tier candidates)`,
      '',
      ...pickLines,
      ...(trapLines.length ? ['', ...trapLines] : []),
    ]

    await supabase.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text: lines.join('\n') },
      correlation_id: `sports-picks-${today}`,
      requires_response: false,
      ...(chatId ? { chat_id: chatId } : {}),
    })
  }

  // ── Log to agent_events ─────────────────────────────────────────────────────
  await supabase.from('agent_events').insert({
    domain: 'sports',
    action: 'sports_picks_scan',
    meta: {
      date: today,
      games_fetched: games.length,
      green_candidates: greenGames.length,
      analyzed: analyses.length,
      picks_written: writtenCount,
    },
    created_at: new Date().toISOString(),
  })

  // ── Drain notifications ─────────────────────────────────────────────────────
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

  return NextResponse.json({
    ok: true,
    date: today,
    games_fetched: games.length,
    green_candidates: greenGames.length,
    analyzed: analyses.length,
    picks: writtenCount,
  })
}
