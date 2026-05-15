/**
 * GET /api/command-center
 *
 * Aggregates the four Command Center panels into one response:
 *   - composite: CompositeScore
 *   - trading_picks: top 3 A-grade predictions today
 *   - sports_picks: today's green-tier sports picks
 *   - weekly_pnl: { trading, sports, amazon, combined } for current week
 *
 * Auth: requires active session.
 *
 * This is the single endpoint for CommandCenter.tsx — one fetch, four sections.
 */

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { computeCompositeConfidence } from '@/lib/trading/composite'
import type { CompositeScore } from '@/lib/trading/composite'

export const dynamic = 'force-dynamic'

interface TradingPick {
  id: string
  ticker: string
  direction: 'long' | 'short' | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  risk_reward: number | null
  grade: string
  confidence: number
  reason: string
}

interface SportsPick {
  id: string
  home: string
  away: string
  favorite: string
  fav_odds: number
  tier: string
  league: string
  picked_on: string
}

interface WeeklyPnl {
  trading: number
  sports: number
  amazon: number
  combined: number
}

export interface CommandCenterPayload {
  composite: CompositeScore
  trading_picks: TradingPick[]
  sports_picks: SportsPick[]
  weekly_pnl: WeeklyPnl
}

function weekStart(): string {
  const now = new Date()
  const day = now.getDay() // 0 = Sunday
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const mon = new Date(now.setDate(diff))
  return mon.toISOString().slice(0, 10)
}

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const weekStartDate = weekStart()

  // All four sections fetched in parallel
  const [compositeResult, tradingPicksResult, sportsPicksResult, weeklyPnlResult] =
    await Promise.allSettled([
      computeCompositeConfidence(),

      // Trading picks: top 3 A-grade predictions today
      db
        .from('predictions')
        .select(
          'id, ticker, direction, entry_price, stop_price, target_price, risk_reward, grade, confidence, reason'
        )
        .eq('domain', 'trading')
        .eq('pick_date', today)
        .eq('grade', 'A')
        .eq('person_handle', 'colin') // SPRINT5-GATE
        .order('confidence', { ascending: false })
        .limit(3),

      // Sports picks: today's green-tier
      db
        .from('sports_picks')
        .select('id, home, away, favorite, fav_odds, tier, league, picked_on')
        .eq('picked_on', today)
        .eq('tier', 'green'),

      // Weekly P&L: trading + sports this week
      Promise.all([
        // Trading P&L (from predictions resolved this week)
        db
          .from('predictions')
          .select('actual_pnl')
          .eq('domain', 'trading')
          .eq('person_handle', 'colin') // SPRINT5-GATE
          .gte('pick_date', weekStartDate)
          .not('actual_pnl', 'is', null),

        // Sports P&L (from bets settled this week)
        db
          .from('bets')
          .select('pnl')
          .eq('person_handle', 'colin') // SPRINT5-GATE
          .gte('bet_date', weekStartDate)
          .in('result', ['win', 'loss', 'push']),

        // Amazon revenue (this week from amazon_order_items.item_price_amount)
        db.from('amazon_order_items').select('item_price_amount').gte('fetched_at', weekStartDate),
      ]),
    ])

  // ── Composite ──────────────────────────────────────────────────────────────
  const composite: CompositeScore =
    compositeResult.status === 'fulfilled'
      ? compositeResult.value
      : {
          score: 50,
          interpretation: 'moderate',
          interpretation_text: 'Score unavailable — check back later.',
          signals: [],
          computed_at: new Date().toISOString(),
          cached: false,
        }

  // ── Trading picks ──────────────────────────────────────────────────────────
  const tradingPicksData =
    tradingPicksResult.status === 'fulfilled' ? (tradingPicksResult.value.data ?? []) : []
  const tradingPicks: TradingPick[] = tradingPicksData.map((p) => ({
    id: p.id,
    ticker: p.ticker ?? '',
    direction: p.direction as 'long' | 'short' | null,
    entry_price: p.entry_price ? Number(p.entry_price) : null,
    stop_price: p.stop_price ? Number(p.stop_price) : null,
    target_price: p.target_price ? Number(p.target_price) : null,
    risk_reward: p.risk_reward ? Number(p.risk_reward) : null,
    grade: p.grade,
    confidence: Number(p.confidence),
    reason: p.reason,
  }))

  // ── Sports picks ──────────────────────────────────────────────────────────
  const sportsPicksData =
    sportsPicksResult.status === 'fulfilled' ? (sportsPicksResult.value.data ?? []) : []
  const sportsPicks: SportsPick[] = sportsPicksData.map((p) => ({
    id: p.id,
    home: p.home,
    away: p.away,
    favorite: p.favorite,
    fav_odds: p.fav_odds,
    tier: p.tier,
    league: p.league,
    picked_on: p.picked_on,
  }))

  // ── Weekly P&L ─────────────────────────────────────────────────────────────
  let weeklyPnl: WeeklyPnl = { trading: 0, sports: 0, amazon: 0, combined: 0 }
  if (weeklyPnlResult.status === 'fulfilled') {
    const [tradingPnlRes, sportsPnlRes, amazonRes] = weeklyPnlResult.value
    const tradingPnl = (tradingPnlRes.data ?? []).reduce(
      (s, r) => s + (r.actual_pnl ? Number(r.actual_pnl) : 0),
      0
    )
    const sportsPnl = (sportsPnlRes.data ?? []).reduce((s, r) => s + (r.pnl ? Number(r.pnl) : 0), 0)
    const amazonRev = (amazonRes.data ?? []).reduce(
      (s, r) => s + (r.item_price_amount ? Number(r.item_price_amount) : 0),
      0
    )
    weeklyPnl = {
      trading: parseFloat(tradingPnl.toFixed(2)),
      sports: parseFloat(sportsPnl.toFixed(2)),
      amazon: parseFloat(amazonRev.toFixed(2)),
      combined: parseFloat((tradingPnl + sportsPnl + amazonRev).toFixed(2)),
    }
  }

  const payload: CommandCenterPayload = {
    composite,
    trading_picks: tradingPicks,
    sports_picks: sportsPicks,
    weekly_pnl: weeklyPnl,
  }

  return NextResponse.json(payload)
}
