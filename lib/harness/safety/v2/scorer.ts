/**
 * lib/harness/safety/v2/scorer.ts
 *
 * Risk scorer. Pure function: takes signal findings + a weight resolver +
 * threshold values, returns a numeric score 0–100 plus the tier classification.
 *
 * Caps + per-key collapsing rules:
 *   - SECRET_DETECTED: any single hit instantly forces high tier (score = 100)
 *     regardless of other signals. This is the auto-high case from Q-003.
 *   - All other weight keys: per-finding contributions sum, but the total
 *     PER WEIGHT KEY is capped at one weight value (so a migration with 8
 *     destructive ops still only contributes +60, not +480). Prevents runaway
 *     scores when multiple findings of the same kind fire on big PRs.
 *   - Coverage drops: 5%pt + 15%pt are mutually exclusive findings (the
 *     coverage signal module already enforces this). Scorer doesn't need
 *     special handling.
 *   - Final score is clamped to [0, 100].
 *
 * Tier classification uses thresholds from harness_config:
 *   low    when score <= SAFETY_THRESHOLD_LOW_MAX     (default 29)
 *   medium when score <= SAFETY_THRESHOLD_MEDIUM_MAX  (default 70)
 *   high   otherwise
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (Initial calibration values)
 */

import type { SignalFinding, WeightKey, RiskTier } from './types'

// F18: lib/harness/safety/v2/scorer

export interface ScoreInput {
  findings: SignalFinding[]
  /** Numeric weights keyed by WeightKey. Caller resolves from harness_config. */
  weights: Partial<Record<WeightKey, number>>
  /** Tier thresholds. Caller resolves from harness_config. */
  thresholds: {
    lowMax: number
    mediumMax: number
  }
}

export interface ScoreResult {
  score: number
  tier: RiskTier
  /** Weight keys that contributed (capped) and the value each contributed. */
  contributions: Array<{ weight_key: WeightKey; value: number; finding_count: number }>
  /** True iff any SECRET_DETECTED finding fired (auto-high path). */
  secret_auto_high: boolean
}

/**
 * Default fallback weights — used only when caller passes `weights` missing
 * a key the scorer encounters. Must match the migration-0162 defaults exactly
 * so a missing harness_config row scores the same as the seeded value.
 */
const DEFAULT_WEIGHTS: Record<WeightKey, number> = {
  SAFETY_WEIGHT_SECRET_DETECTED: 100,
  SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE: 60,
  SAFETY_WEIGHT_MIGRATION_ADDITIVE: 10,
  SAFETY_WEIGHT_COVERAGE_DROP_5PCT: 30,
  SAFETY_WEIGHT_COVERAGE_DROP_15PCT: 60,
  SAFETY_WEIGHT_LOC_DELTA_2X: 20,
  SAFETY_WEIGHT_FAILURE_PATTERN_LOW: 25,
  SAFETY_WEIGHT_FAILURE_PATTERN_HIGH: 50,
  SAFETY_WEIGHT_SHARED_SEAM_TOUCH: 40,
  SAFETY_WEIGHT_API_ROUTE_NETNEW: 15,
  SAFETY_WEIGHT_BASE: 5,
}

function resolveWeight(key: WeightKey, overrides: Partial<Record<WeightKey, number>>): number {
  const v = overrides[key]
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  return DEFAULT_WEIGHTS[key]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function classifyTier(score: number, thresholds: ScoreInput['thresholds']): RiskTier {
  if (score <= thresholds.lowMax) return 'low'
  if (score <= thresholds.mediumMax) return 'medium'
  return 'high'
}

/**
 * Score a set of signal findings into 0–100 + a risk tier.
 *
 * If any finding has weight_key SAFETY_WEIGHT_SECRET_DETECTED, return high
 * tier with score 100 immediately — secrets bypass all other math.
 *
 * Otherwise: group findings by weight_key, contribute each key's weight
 * exactly once (regardless of finding_count), sum, add base, clamp to [0, 100].
 */
export function scoreSafety(input: ScoreInput): ScoreResult {
  const { findings, weights, thresholds } = input

  // Auto-high path.
  const hasSecret = findings.some((f) => f.weight_key === 'SAFETY_WEIGHT_SECRET_DETECTED')
  if (hasSecret) {
    const w = resolveWeight('SAFETY_WEIGHT_SECRET_DETECTED', weights)
    const findingCount = findings.filter(
      (f) => f.weight_key === 'SAFETY_WEIGHT_SECRET_DETECTED'
    ).length
    return {
      score: 100,
      tier: 'high',
      contributions: [
        {
          weight_key: 'SAFETY_WEIGHT_SECRET_DETECTED',
          value: Math.min(w, 100),
          finding_count: findingCount,
        },
      ],
      secret_auto_high: true,
    }
  }

  // Group by weight_key — each key contributes once.
  const grouped = new Map<WeightKey, number>()
  for (const f of findings) {
    grouped.set(f.weight_key, (grouped.get(f.weight_key) ?? 0) + 1)
  }

  const contributions: ScoreResult['contributions'] = []
  let total = resolveWeight('SAFETY_WEIGHT_BASE', weights)

  for (const [key, count] of grouped) {
    if (key === 'SAFETY_WEIGHT_BASE') continue // base added unconditionally above
    const value = resolveWeight(key, weights)
    contributions.push({ weight_key: key, value, finding_count: count })
    total += value
  }

  const score = Math.round(clamp(total, 0, 100))
  return {
    score,
    tier: classifyTier(score, thresholds),
    contributions,
    secret_auto_high: false,
  }
}
