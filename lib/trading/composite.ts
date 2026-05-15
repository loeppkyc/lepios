/**
 * Composite Confidence Score — 8-signal weighted average (0–100).
 *
 * Aggregates market, sports, trading, and system signals into a single
 * number that answers: "Are conditions right to trade/bet today?"
 *
 * Each signal is 0–100. The weighted sum uses the weights below.
 * Any unavailable signal falls back to 50 (neutral).
 *
 * Result is logged to agent_events for history tracking and cached for
 * 30 minutes (check agent_events before recomputing).
 *
 * Signal weights: Market Trend 0.20, Sports Edge 0.15, Trading Grade 0.15,
 * Volume/Momentum/Volatility/Deal Flow/System Health 0.10 each.
 *
 * Model for debrief calls: claude-haiku-4-5-20251001
 * TODO: tune signal computation coefficients with real data
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Signal definitions ────────────────────────────────────────────────────────

export interface Signal {
  name: string
  value: number // 0–100
  weight: number
  available: boolean // false = fell back to neutral 50
}

export interface CompositeScore {
  score: number // 0–100 rounded to 1 decimal
  interpretation: 'high' | 'moderate' | 'cautious' | 'standAside'
  interpretation_text: string
  signals: Signal[]
  computed_at: string
  cached: boolean
}

// ── Cache window ──────────────────────────────────────────────────────────────

const CACHE_WINDOW_MS = 30 * 60 * 1_000 // 30 minutes

// ── Interpretation thresholds ─────────────────────────────────────────────────

function interpretScore(score: number): {
  key: CompositeScore['interpretation']
  text: string
} {
  if (score >= 75)
    return {
      key: 'high',
      text: 'Conditions are strong across all signals — trade with full confidence.',
    }
  if (score >= 50)
    return {
      key: 'moderate',
      text: 'Moderate conditions — trade selectively, favour A-grade setups.',
    }
  if (score >= 25)
    return { key: 'cautious', text: 'Cautious — reduce size and wait for clearer signals.' }
  return { key: 'standAside', text: 'Stand aside — multiple signals are misaligned.' }
}

// ── Individual signal fetchers ────────────────────────────────────────────────

/** Market Trend (0.20): best trading score / 13 * 100 */
async function fetchMarketTrendSignal(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await db
      .from('predictions')
      .select('raw_score')
      .eq('domain', 'trading')
      .eq('pick_date', today)
      .not('raw_score', 'is', null)
      .order('raw_score', { ascending: false })
      .limit(1)
      .single()
    if (!data?.raw_score) return null
    return Math.min(100, Math.round((Number(data.raw_score) / 13) * 100))
  } catch {
    return null
  }
}

/** Sports Edge (0.15): green-tier picks / total today * 100 */
async function fetchSportsEdgeSignal(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await db.from('sports_picks').select('tier').eq('picked_on', today)
    if (!data || data.length === 0) return null
    const greenCount = data.filter((p) => p.tier === 'green').length
    return Math.round((greenCount / data.length) * 100)
  } catch {
    return null
  }
}

/** Trading Grade (0.15): A-grade predictions today / 14 * 100 */
async function fetchTradingGradeSignal(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await db
      .from('predictions')
      .select('grade')
      .eq('domain', 'trading')
      .eq('pick_date', today)
    if (!data || data.length === 0) return null
    const aCount = data.filter((p) => p.grade === 'A').length
    // 14 = approximate number of instruments scored per run
    return Math.min(100, Math.round((aCount / 14) * 100))
  } catch {
    return null
  }
}

/** Volume (0.10): ES=F current vol / 20d avg * 70 (capped at 100) */
async function fetchVolumeSignal(): Promise<number | null> {
  try {
    // yahoo-finance2 would be ideal here — for now use a neutral fallback
    // TODO: wire yahoo-finance2 ES=F volume data when available
    return null
  } catch {
    return null
  }
}

/** Momentum (0.10): ES=F 5-day return → 50 + (return / 5 * 50), clamped 5–95 */
async function fetchMomentumSignal(): Promise<number | null> {
  try {
    // TODO: wire yahoo-finance2 ES=F 5-day return
    return null
  } catch {
    return null
  }
}

/** Volatility (0.10): VIX → 110 - (vix * 3), clamped 5–90 (inverse relationship) */
async function fetchVolatilitySignal(): Promise<number | null> {
  try {
    // TODO: wire yahoo-finance2 ^VIX quote
    return null
  } catch {
    return null
  }
}

/** Deal Flow (0.10): stocktrack hot deals today → min(count * 4 + 20, 100) */
async function fetchDealFlowSignal(): Promise<number | null> {
  try {
    const db = createServiceClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data } = await db
      .from('stocktrack_results')
      .select('id')
      .gte('scanned_at', todayStart.toISOString())
      .not('discount_pct', 'is', null)
    if (!data) return null
    const hotDeals = data.length
    return Math.min(100, hotDeals * 4 + 20)
  } catch {
    return null
  }
}

/** System Health (0.10): /api/health 200 = 85, error = 20 */
async function fetchSystemHealthSignal(): Promise<number | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lepios-one.vercel.app'
    const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' })
    return res.ok ? 85 : 20
  } catch {
    return 20
  }
}

// ── Signal specs ──────────────────────────────────────────────────────────────

interface SignalSpec {
  name: string
  weight: number
  fetch: () => Promise<number | null>
}

const SIGNAL_SPECS: SignalSpec[] = [
  { name: 'Market Trend', weight: 0.2, fetch: fetchMarketTrendSignal },
  { name: 'Sports Edge', weight: 0.15, fetch: fetchSportsEdgeSignal },
  { name: 'Trading Grade', weight: 0.15, fetch: fetchTradingGradeSignal },
  { name: 'Volume', weight: 0.1, fetch: fetchVolumeSignal },
  { name: 'Momentum', weight: 0.1, fetch: fetchMomentumSignal },
  { name: 'Volatility', weight: 0.1, fetch: fetchVolatilitySignal },
  { name: 'Deal Flow', weight: 0.1, fetch: fetchDealFlowSignal },
  { name: 'System Health', weight: 0.1, fetch: fetchSystemHealthSignal },
]

// ── Cache check ───────────────────────────────────────────────────────────────

async function getCachedScore(): Promise<CompositeScore | null> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - CACHE_WINDOW_MS).toISOString()
    const { data } = await db
      .from('agent_events')
      .select('meta, occurred_at')
      .eq('domain', 'trading')
      .eq('action', 'composite_score')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.meta) return null
    const meta = data.meta as Record<string, unknown>
    if (typeof meta.score !== 'number') return null

    // Reconstruct from cached meta
    const cached: CompositeScore = {
      score: meta.score as number,
      interpretation: meta.interpretation as CompositeScore['interpretation'],
      interpretation_text: meta.interpretation_text as string,
      signals: meta.signals as Signal[],
      computed_at: data.occurred_at as string,
      cached: true,
    }
    return cached
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute (or return cached) composite confidence score.
 *
 * Logs to agent_events on fresh computation.
 * Graceful fallback: any unavailable signal → 50 (neutral).
 */
export async function computeCompositeConfidence(): Promise<CompositeScore> {
  // Check cache first
  const cached = await getCachedScore()
  if (cached) return cached

  // Fetch all signals in parallel
  const rawValues = await Promise.all(SIGNAL_SPECS.map((s) => s.fetch()))

  const signals: Signal[] = SIGNAL_SPECS.map((spec, i) => ({
    name: spec.name,
    value: rawValues[i] ?? 50, // fallback to neutral
    weight: spec.weight,
    available: rawValues[i] !== null,
  }))

  const score = parseFloat(signals.reduce((sum, s) => sum + s.value * s.weight, 0).toFixed(1))

  const { key, text } = interpretScore(score)
  const computed_at = new Date().toISOString()

  const result: CompositeScore = {
    score,
    interpretation: key,
    interpretation_text: text,
    signals,
    computed_at,
    cached: false,
  }

  // Log to agent_events (non-blocking)
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'trading',
      action: 'composite_score',
      actor: 'composite',
      status: 'success',
      output_summary: `Composite confidence: ${score}/100 (${key})`,
      tags: ['composite_score', 'trading'],
      meta: {
        score,
        interpretation: key,
        interpretation_text: text,
        signals,
      },
    })
  } catch {
    // Non-critical — score still returned to caller
  }

  return result
}
