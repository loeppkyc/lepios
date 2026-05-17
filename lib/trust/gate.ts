/**
 * Trust Gate state machine.
 *
 * evaluateGate: compute GateEvaluation from trust_state row + live prediction data.
 * recomputeTrustState: run rolling stats SQL and write updated fields to trust_state.
 * flipToLive: flip current_mode='live' (requires gate_status='open').
 * flipToPaper: flip current_mode='paper' (always allowed).
 *
 * Recompute is called from /api/predictions/[id]/settle (Next.js-side, not DB trigger).
 * Sprint 10 Chunk C
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { Domain, GateEvaluation, TrustStateRow, MetricEval } from './state'

// ── Gate evaluation ───────────────────────────────────────────────────────────

/**
 * Compute GateEvaluation from the trust_state row.
 * Does NOT re-run SQL — caller must call recomputeTrustState first if needed.
 */
export async function evaluateGate(domain: Domain): Promise<GateEvaluation> {
  const supabase = createServiceClient()

  const { data: row, error } = await supabase
    .from('trust_state')
    .select('*')
    .eq('domain', domain)
    .single()

  if (error || !row) {
    throw new Error(`trust_state row not found for domain=${domain}: ${error?.message}`)
  }

  const ts = row as TrustStateRow

  // ── Evaluate each metric ──────────────────────────────────────────────────

  const sampleEval: MetricEval = {
    current: ts.current_sample_size,
    threshold: ts.min_sample_size,
    pass: ts.current_sample_size >= ts.min_sample_size,
  }

  const winRateEval: MetricEval = {
    current: ts.current_win_rate,
    threshold: ts.win_rate_threshold,
    pass: ts.current_win_rate != null && ts.current_win_rate >= ts.win_rate_threshold,
  }

  const secondaryEval: MetricEval & { key: string } = {
    key: ts.secondary_metric_key,
    current: ts.current_secondary_metric,
    threshold: ts.secondary_metric_threshold,
    pass:
      ts.current_secondary_metric != null &&
      ts.current_secondary_metric >= ts.secondary_metric_threshold,
  }

  const calibrationEval: MetricEval = {
    current: ts.current_calibration_rate,
    threshold: ts.calibration_threshold,
    pass:
      ts.current_calibration_rate != null &&
      ts.current_calibration_rate >= ts.calibration_threshold,
  }

  // Drawdown: lower is better (must be BELOW threshold)
  const drawdownEval: MetricEval = {
    current: ts.current_drawdown,
    threshold: ts.max_drawdown_threshold,
    pass: ts.current_drawdown != null && ts.current_drawdown <= ts.max_drawdown_threshold,
  }

  // ── Compute failures list ─────────────────────────────────────────────────

  const failures: string[] = []

  if (!sampleEval.pass) {
    const needed = ts.min_sample_size - ts.current_sample_size
    failures.push(
      `Sample size: ${ts.current_sample_size}/${ts.min_sample_size} — need ${needed} more resolved predictions`
    )
  }
  if (!winRateEval.pass) {
    const curr = ts.current_win_rate != null ? (ts.current_win_rate * 100).toFixed(1) + '%' : 'N/A'
    failures.push(`Win rate: ${curr} < ${(ts.win_rate_threshold * 100).toFixed(1)}% threshold`)
  }
  if (!secondaryEval.pass) {
    const curr =
      ts.current_secondary_metric != null ? ts.current_secondary_metric.toFixed(3) : 'N/A'
    failures.push(
      `${ts.secondary_metric_key}: ${curr} < ${ts.secondary_metric_threshold} threshold`
    )
  }
  if (!calibrationEval.pass) {
    const curr =
      ts.current_calibration_rate != null
        ? (ts.current_calibration_rate * 100).toFixed(1) + '%'
        : 'N/A'
    failures.push(
      `${ts.calibration_grade}-grade calibration: ${curr} < ${(ts.calibration_threshold * 100).toFixed(1)}%`
    )
  }
  if (!drawdownEval.pass) {
    const curr = ts.current_drawdown != null ? (ts.current_drawdown * 100).toFixed(1) + '%' : 'N/A'
    failures.push(
      `Max drawdown: ${curr} exceeds ${(ts.max_drawdown_threshold * 100).toFixed(1)}% threshold`
    )
  }

  const gate_status = failures.length === 0 ? 'open' : 'closed'

  return {
    domain,
    current_mode: ts.current_mode,
    gate_status,
    metrics: {
      sample_size: sampleEval,
      win_rate: winRateEval,
      secondary: secondaryEval,
      calibration: calibrationEval,
      drawdown: drawdownEval,
    },
    failures,
    can_go_live: gate_status === 'open' && ts.current_mode === 'paper',
  }
}

// ── Rolling stats recompute ───────────────────────────────────────────────────

/**
 * Recompute rolling stats from prediction data and write to trust_state.
 * Called after every prediction resolution.
 */
export async function recomputeTrustState(domain: Domain): Promise<void> {
  const supabase = createServiceClient()

  const sampleLimit = domain === 'trading' ? 30 : 50

  // Load settled predictions
  const { data: settled } = await supabase
    .from('predictions')
    .select('won, actual_pnl, confidence, grade, ai_rating')
    .eq('domain', domain)
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(sampleLimit)

  if (!settled || settled.length === 0) {
    await supabase
      .from('trust_state')
      .update({
        current_sample_size: 0,
        current_win_rate: null,
        current_secondary_metric: null,
        current_calibration_rate: null,
        current_drawdown: null,
        last_recomputed_at: new Date().toISOString(),
        gate_status: 'closed',
        gate_failures: ['Sample size: 0 resolved predictions'],
      })
      .eq('domain', domain)
    return
  }

  const sampleSize = settled.length
  const wins = settled.filter((p) => p.won === true).length
  const winRate = sampleSize > 0 ? wins / sampleSize : null

  // Secondary metric
  let secondaryMetric: number | null = null
  if (domain === 'trading') {
    // avg_r_multiple: sum(actual_pnl / planned_risk) — approximate as avg pnl / 100
    const pnls = settled.filter((p) => p.actual_pnl != null).map((p) => p.actual_pnl as number)
    if (pnls.length > 0) {
      // Approximate R-multiple as pnl / 100 (assuming $100 risk per trade for paper)
      secondaryMetric = pnls.reduce((s, v) => s + v / 100, 0) / pnls.length
    }
  } else {
    // roi_pct: sum(actual_pnl) / (count * 100)
    const pnls = settled.filter((p) => p.actual_pnl != null).map((p) => p.actual_pnl as number)
    if (pnls.length > 0) {
      secondaryMetric = pnls.reduce((s, v) => s + v, 0) / (pnls.length * 100)
    }
  }

  // Calibration rate (grade-A win rate for trading, ai_rating>=7 for sports)
  let calibrationRate: number | null = null
  if (domain === 'trading') {
    const gradeA = settled.filter((p) => p.grade === 'A')
    if (gradeA.length >= 3) {
      calibrationRate = gradeA.filter((p) => p.won === true).length / gradeA.length
    }
  } else {
    const highRated = settled.filter((p) => p.ai_rating != null && (p.ai_rating as number) >= 7)
    if (highRated.length >= 3) {
      calibrationRate = highRated.filter((p) => p.won === true).length / highRated.length
    }
  }

  // Max drawdown from cumulative PnL
  let maxDrawdown: number | null = null
  const pnlsChronological = [...settled]
    .reverse()
    .filter((p) => p.actual_pnl != null)
    .map((p) => p.actual_pnl as number)

  if (pnlsChronological.length > 0) {
    let cumPnl = 0
    let runningMax = 0
    let worstDrawdown = 0
    for (const pnl of pnlsChronological) {
      cumPnl += pnl
      if (cumPnl > runningMax) runningMax = cumPnl
      const drawdown = runningMax > 0 ? (runningMax - cumPnl) / runningMax : 0
      if (drawdown > worstDrawdown) worstDrawdown = drawdown
    }
    maxDrawdown = worstDrawdown
  }

  // Determine gate status
  const { data: tsRow } = await supabase
    .from('trust_state')
    .select('*')
    .eq('domain', domain)
    .single()

  const ts = tsRow as TrustStateRow | null
  const failures: string[] = []

  if (!ts) return

  if (sampleSize < ts.min_sample_size) {
    failures.push(`Sample: ${sampleSize}/${ts.min_sample_size}`)
  }
  if (winRate == null || winRate < ts.win_rate_threshold) {
    failures.push(
      `Win rate: ${winRate != null ? (winRate * 100).toFixed(1) + '%' : 'N/A'} < ${(ts.win_rate_threshold * 100).toFixed(1)}%`
    )
  }
  if (secondaryMetric == null || secondaryMetric < ts.secondary_metric_threshold) {
    failures.push(
      `${ts.secondary_metric_key}: ${secondaryMetric != null ? secondaryMetric.toFixed(3) : 'N/A'}`
    )
  }
  if (calibrationRate == null || calibrationRate < ts.calibration_threshold) {
    failures.push(
      `${ts.calibration_grade} calibration: ${calibrationRate != null ? (calibrationRate * 100).toFixed(1) + '%' : 'N/A'}`
    )
  }
  if (maxDrawdown == null || maxDrawdown > ts.max_drawdown_threshold) {
    failures.push(`Drawdown: ${maxDrawdown != null ? (maxDrawdown * 100).toFixed(1) + '%' : 'N/A'}`)
  }

  const gateStatus = failures.length === 0 ? 'open' : 'closed'

  await supabase
    .from('trust_state')
    .update({
      current_sample_size: sampleSize,
      current_win_rate: winRate,
      current_secondary_metric: secondaryMetric,
      current_calibration_rate: calibrationRate,
      current_drawdown: maxDrawdown,
      last_recomputed_at: new Date().toISOString(),
      gate_status: gateStatus,
      gate_failures: failures.length > 0 ? failures : null,
    })
    .eq('domain', domain)
}

// ── Mode flips ────────────────────────────────────────────────────────────────

/**
 * Flip to live mode. Requires gate_status='open'.
 * Throws if gate is closed.
 */
export async function flipToLive(domain: Domain, by: string): Promise<void> {
  const evaluation = await evaluateGate(domain)
  if (evaluation.gate_status !== 'open') {
    throw new Error(
      `Gate is closed for domain=${domain}. Failures: ${evaluation.failures.join('; ')}`
    )
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  await supabase
    .from('trust_state')
    .update({
      current_mode: 'live',
      flipped_to_live_at: now,
      flipped_to_live_by: by,
    })
    .eq('domain', domain)

  await supabase.from('agent_events').insert({
    domain,
    action: 'trust_state_flipped',
    meta: { from: 'paper', to: 'live', by, gate_status: 'open' },
    created_at: now,
  })
}

/**
 * Flip back to paper mode. Always allowed.
 */
export async function flipToPaper(domain: Domain, by: string, reason: string): Promise<void> {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  await supabase
    .from('trust_state')
    .update({
      current_mode: 'paper',
    })
    .eq('domain', domain)

  await supabase.from('agent_events').insert({
    domain,
    action: 'trust_state_flipped',
    meta: { from: 'live', to: 'paper', by, reason },
    created_at: now,
  })
}
