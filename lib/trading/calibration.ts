/**
 * Calibration bucketing — do Colin's estimated win probabilities match reality?
 *
 * Takes settled bets (result = win | loss) with win_prob_pct set, groups them
 * into probability buckets, and computes actual win rate vs. predicted.
 *
 * Points above the y=x diagonal = underconfident (estimates too low).
 * Points below = overconfident (estimates too high).
 *
 * Domain rule: buckets with < 3 bets are excluded (insufficient sample).
 */

export interface BetForCalibration {
  win_prob_pct: number | null
  result: 'win' | 'loss' | 'push' | 'void' | 'pending' | string
}

export interface CalibrationBucket {
  /** Human-readable range label, e.g. "50–55%" */
  label: string
  /** Midpoint of the bucket, used as x-axis value */
  predicted: number
  /** Actual win rate for bets in this bucket (0–100) */
  actual: number
  /** Number of bets in this bucket */
  count: number
  /**
   * actual - predicted (positive = underconfident, negative = overconfident)
   * TODO: tune interpretation thresholds with real data
   */
  edge: number
}

interface BucketDef {
  label: string
  midpoint: number
  min: number
  max: number // exclusive upper bound, except last bucket
}

const BUCKET_DEFS: BucketDef[] = [
  { label: '40–50%', midpoint: 45, min: 40, max: 50 },
  { label: '50–55%', midpoint: 52.5, min: 50, max: 55 },
  { label: '55–60%', midpoint: 57.5, min: 55, max: 60 },
  { label: '60–65%', midpoint: 62.5, min: 60, max: 65 },
  { label: '65–70%', midpoint: 67.5, min: 65, max: 70 },
  { label: '70–80%', midpoint: 75, min: 70, max: 80 },
  { label: '80+%', midpoint: 85, min: 80, max: Infinity },
]

/** Minimum bets in a bucket before it appears in calibration output */
export const CALIBRATION_MIN_BUCKET_SIZE = 3 // TODO: tune with real data

/** Minimum total settled bets with win_prob_pct before chart unlocks */
export const CALIBRATION_MIN_TOTAL_BETS = 10 // TODO: tune with real data

/**
 * Compute calibration buckets from a list of bets.
 *
 * @param bets  All settled bets (caller may pass all bets; this function
 *              filters internally for result in ('win','loss') AND win_prob_pct NOT NULL)
 * @returns     Sorted array of CalibrationBucket, ascending by predicted
 */
export function computeCalibration(bets: BetForCalibration[]): CalibrationBucket[] {
  // Only settled bets with a probability estimate
  const eligible = bets.filter(
    (b): b is BetForCalibration & { win_prob_pct: number } =>
      b.win_prob_pct != null && (b.result === 'win' || b.result === 'loss')
  )

  // Accumulate wins + total per bucket
  const counts: Record<string, { wins: number; total: number; def: BucketDef }> = {}
  for (const def of BUCKET_DEFS) {
    counts[def.label] = { wins: 0, total: 0, def }
  }

  for (const bet of eligible) {
    const bucket = BUCKET_DEFS.find((d) => bet.win_prob_pct >= d.min && bet.win_prob_pct < d.max)
    if (!bucket) continue
    counts[bucket.label].total++
    if (bet.result === 'win') counts[bucket.label].wins++
  }

  const result: CalibrationBucket[] = []
  for (const def of BUCKET_DEFS) {
    const { wins, total } = counts[def.label]
    if (total < CALIBRATION_MIN_BUCKET_SIZE) continue

    const actual = parseFloat(((wins / total) * 100).toFixed(1))
    const edge = parseFloat((actual - def.midpoint).toFixed(1))

    result.push({
      label: def.label,
      predicted: def.midpoint,
      actual,
      count: total,
      edge,
    })
  }

  return result.sort((a, b) => a.predicted - b.predicted)
}
