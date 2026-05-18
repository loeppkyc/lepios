import { SnapshotStats } from './snapshots'

export interface DealScore {
  score: number           // 0–10, higher = better deal
  discountPct: number | null
  vsAvg90: string | null  // e.g. "-23% vs 90d avg"
  confidence: 'high' | 'medium' | 'low'
  fromOwnData: boolean
}

/**
 * Score a current price against stored snapshot stats.
 * Falls back gracefully when stats are sparse.
 *
 * Scoring: 50% off avg90 → score 10. Linear. 0% off → score 0.
 * TODO: tune thresholds with real data (min 90 days accumulation)
 */
export function computeDealScore(
  currentPrice: number,
  stats: SnapshotStats,
  keepaAvg90?: number | null
): DealScore {
  const avg90 = stats.avg90 ?? keepaAvg90 ?? null
  const fromOwnData = stats.avg90 != null

  if (!avg90 || avg90 <= 0) {
    return { score: 0, discountPct: null, vsAvg90: null, confidence: 'low', fromOwnData }
  }

  const discountPct = ((avg90 - currentPrice) / avg90) * 100
  // 50% off = score 10; linear mapping, clamped 0–10
  const score = Math.min(10, Math.max(0, discountPct / 5))

  const confidence: DealScore['confidence'] =
    stats.count >= 60 ? 'high' : stats.count >= 14 ? 'medium' : 'low'

  return {
    score: Math.round(score * 10) / 10,
    discountPct: Math.round(discountPct * 10) / 10,
    vsAvg90: `${discountPct > 0 ? '-' : '+'}${Math.abs(Math.round(discountPct))}% vs 90d avg`,
    confidence,
    fromOwnData,
  }
}
