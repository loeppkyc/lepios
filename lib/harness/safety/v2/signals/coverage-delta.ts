/**
 * lib/harness/safety/v2/signals/coverage-delta.ts
 *
 * Coverage-delta signal. Compares a PR's test coverage to the baseline
 * coverage from `main` and emits findings when coverage drops:
 *
 *   pct_drop > 5%  → SAFETY_WEIGHT_COVERAGE_DROP_5PCT  (+30 default)
 *   pct_drop > 15% → SAFETY_WEIGHT_COVERAGE_DROP_15PCT (+60 default)
 *
 * Only the worst-tier finding fires (15% drop also crosses the 5% threshold,
 * but we score it as the higher tier only — not double-counted).
 *
 * Coverage execution itself is out of scope for this module. The runner that
 * invokes vitest with `--coverage` and stores the baseline lives in
 * `app/api/cron/deploy-gate-runner/` (Sub-phase D). This module operates on
 * already-computed coverage summary objects.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #3)
 */

import type { SignalFinding } from '../types'

// F18: lib/harness/safety/v2/signals/coverage-delta

/**
 * Subset of vitest --coverage `coverage-summary.json` shape that we depend on.
 * The full file has more keys; we only need totals.lines.pct.
 */
export interface CoverageSummary {
  /**
   * Coverage as a percentage 0–100 across the four standard metrics.
   * Vitest writes this under `total` in coverage-summary.json.
   */
  total: {
    lines: { pct: number }
    statements: { pct: number }
    functions: { pct: number }
    branches: { pct: number }
  }
}

/**
 * Coverage delta input. `base` is the baseline (from main), `head` is the PR.
 * Either may be `null` — meaning coverage wasn't computed for that side. In
 * that case we emit no findings (silent on missing data, never false flag).
 */
export interface CoverageDeltaInput {
  base: CoverageSummary | null
  head: CoverageSummary | null
}

/**
 * Pure aggregator: compute weighted coverage % across the 4 metrics. Returns
 * NaN if any metric is missing — caller treats NaN as "no coverage data".
 *
 * Weights are even (0.25 each) — all four metrics matter, none more than another.
 * If we want to weight lines higher later, change the weights here only.
 */
export function aggregatedPct(s: CoverageSummary): number {
  const t = s.total
  if (!t || !t.lines || !t.statements || !t.functions || !t.branches) return NaN
  return (
    t.lines.pct * 0.25 + t.statements.pct * 0.25 + t.functions.pct * 0.25 + t.branches.pct * 0.25
  )
}

/**
 * Detect coverage drop. Output rules:
 *   - If either side missing → no findings (avoid false positives on
 *     bootstrapping / bad inputs)
 *   - If aggregated head < base by > 15%pt → COVERAGE_DROP_15PCT (only)
 *   - Else if drop > 5%pt → COVERAGE_DROP_5PCT
 *   - Else → no findings (improvements + small regressions don't flag)
 *
 * Threshold is in percentage POINTS (absolute), not percent of base. 80% → 75%
 * is a 5%pt drop (flags); 80% → 76% is a 4%pt drop (doesn't flag).
 */
export function detectCoverageDelta(input: CoverageDeltaInput): SignalFinding[] {
  if (!input.base || !input.head) return []

  const basePct = aggregatedPct(input.base)
  const headPct = aggregatedPct(input.head)
  if (Number.isNaN(basePct) || Number.isNaN(headPct)) return []

  const drop = basePct - headPct
  if (drop <= 5) return []

  const isHigh = drop > 15
  return [
    {
      id: isHigh ? 'coverage_drop_15pct' : 'coverage_drop_5pct',
      name: `coverage drop ${drop.toFixed(1)}%pt (${basePct.toFixed(1)}% → ${headPct.toFixed(1)}%)`,
      weight_key: isHigh ? 'SAFETY_WEIGHT_COVERAGE_DROP_15PCT' : 'SAFETY_WEIGHT_COVERAGE_DROP_5PCT',
      evidence: `aggregated lines/statements/functions/branches: base ${basePct.toFixed(1)}% → head ${headPct.toFixed(1)}% (Δ -${drop.toFixed(1)}%pt)`,
    },
  ]
}
