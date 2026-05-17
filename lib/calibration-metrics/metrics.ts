/**
 * Calibration metrics computation for the AIPE trust gate dashboard.
 *
 * Provides rolling stats and chart data for the /calibration page.
 * Pure computation — no DB writes, all reads via Supabase service client.
 *
 * Sprint 10 Chunk C
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { Domain } from '@/lib/trust/state'

// ── Hit rate by grade ─────────────────────────────────────────────────────────

export interface GradeHitRate {
  grade: string
  win_rate: number
  count: number
}

export async function getHitRateByGrade(domain: Domain, limit = 100): Promise<GradeHitRate[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('predictions')
    .select('grade, won')
    .eq('domain', domain)
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) return []

  const byGrade: Record<string, { wins: number; total: number }> = {}
  const GRADES = ['A', 'B+', 'B', 'C']

  for (const p of data) {
    const g = p.grade as string
    if (!byGrade[g]) byGrade[g] = { wins: 0, total: 0 }
    byGrade[g].total++
    if (p.won === true) byGrade[g].wins++
  }

  return GRADES.filter((g) => byGrade[g]?.total > 0).map((g) => ({
    grade: g,
    win_rate: parseFloat(((byGrade[g].wins / byGrade[g].total) * 100).toFixed(1)),
    count: byGrade[g].total,
  }))
}

// ── Calibration buckets (confidence vs actual win rate) ───────────────────────

export interface CalibrationPoint {
  /** Confidence bucket label */
  label: string
  /** Midpoint of the confidence bucket */
  confidence_mid: number
  /** Actual win rate for picks in this bucket */
  actual_win_rate: number
  /** Number of picks in bucket */
  count: number
}

const CONFIDENCE_BUCKETS = [
  { label: '1-3', min: 0, max: 3.5 },
  { label: '4-6', min: 3.5, max: 6.5 },
  { label: '7-8', min: 6.5, max: 8.5 },
  { label: '9-10', min: 8.5, max: 10.1 },
]

export async function getCalibrationData(domain: Domain, limit = 100): Promise<CalibrationPoint[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('predictions')
    .select('confidence, won')
    .eq('domain', domain)
    .not('resolved_at', 'is', null)
    .not('confidence', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) return []

  const result: CalibrationPoint[] = []

  for (const bucket of CONFIDENCE_BUCKETS) {
    const inBucket = data.filter((p) => {
      const c = p.confidence as number
      return c >= bucket.min && c < bucket.max
    })
    if (inBucket.length < 3) continue // insufficient data

    const wins = inBucket.filter((p) => p.won === true).length
    const midpoint = (bucket.min + Math.min(bucket.max, 10)) / 2

    result.push({
      label: bucket.label,
      confidence_mid: parseFloat(midpoint.toFixed(1)),
      actual_win_rate: parseFloat(((wins / inBucket.length) * 100).toFixed(1)),
      count: inBucket.length,
    })
  }

  return result
}

// ── Equity curve ─────────────────────────────────────────────────────────────

export interface EquityPoint {
  date: string
  cumulative_pnl: number
  drawdown: number
}

export async function getEquityCurve(domain: Domain, limit = 100): Promise<EquityPoint[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('predictions')
    .select('pick_date, actual_pnl, resolved_at')
    .eq('domain', domain)
    .not('resolved_at', 'is', null)
    .not('actual_pnl', 'is', null)
    .order('resolved_at', { ascending: true })
    .limit(limit)

  if (!data || data.length === 0) return []

  let cumPnl = 0
  let runningMax = 0
  const curve: EquityPoint[] = []

  for (const p of data) {
    cumPnl += p.actual_pnl as number
    if (cumPnl > runningMax) runningMax = cumPnl
    const drawdown = runningMax > 0 ? Math.max(0, runningMax - cumPnl) : 0

    curve.push({
      date: p.pick_date as string,
      cumulative_pnl: parseFloat(cumPnl.toFixed(2)),
      drawdown: parseFloat(drawdown.toFixed(2)),
    })
  }

  return curve
}

// ── League performance table (sports-specific) ────────────────────────────────

export interface LeaguePerf {
  league: string
  bets: number
  wins: number
  win_rate: number
  roi: number
}

export async function getLeaguePerformance(limit = 200): Promise<LeaguePerf[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('predictions')
    .select('league, won, actual_pnl')
    .eq('domain', 'sports')
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) return []

  const byLeague: Record<string, { wins: number; total: number; pnl: number }> = {}
  for (const p of data) {
    const l = (p.league as string) ?? 'Unknown'
    if (!byLeague[l]) byLeague[l] = { wins: 0, total: 0, pnl: 0 }
    byLeague[l].total++
    if (p.won === true) byLeague[l].wins++
    byLeague[l].pnl += (p.actual_pnl as number) ?? 0
  }

  return Object.entries(byLeague)
    .filter(([, s]) => s.total >= 5)
    .map(([league, s]) => ({
      league,
      bets: s.total,
      wins: s.wins,
      win_rate: parseFloat(((s.wins / s.total) * 100).toFixed(1)),
      roi: parseFloat(((s.pnl / (s.total * 100)) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.bets - a.bets)
}

// ── Recent predictions (compact table) ───────────────────────────────────────

export interface RecentPrediction {
  id: string
  pick_date: string
  ticker: string | null
  league: string | null
  grade: string
  direction: string | null
  bet_on: string | null
  odds: number | null
  entry_price: number | null
  won: boolean | null
  actual_pnl: number | null
}

export async function getRecentPredictions(
  domain: Domain,
  limit = 10
): Promise<RecentPrediction[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('predictions')
    .select(
      'id, pick_date, ticker, league, grade, direction, bet_on, odds, entry_price, won, actual_pnl'
    )
    .eq('domain', domain)
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as RecentPrediction[]
}
