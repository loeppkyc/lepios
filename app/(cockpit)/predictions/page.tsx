/**
 * /cockpit/predictions — Sports Prediction Calibration Widget
 *
 * A7 — Predictive Behavioral Engine.
 * Calibration dataset builder: log predictions, settle with actuals,
 * track calibration gap (confidence vs accuracy) over time.
 * NOT a betting tool. Feeds the behavioral ingestion spec.
 *
 * F17: Foundation of behavioral ingestion spec.
 * F18: Metrics in predictions table + agent_events (domain=behavioral).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { PredictionsShell } from './_components/PredictionsShell'

export const dynamic = 'force-dynamic'

export default async function PredictionsPage() {
  const supabase = createServiceClient()

  // SPRINT5-GATE: person_handle filter is hardcoded; see ARCHITECTURE.md §7.3
  const { data, error } = await supabase
    .from('predictions')
    .select(
      'id, sport, event_desc, prediction, confidence, game_date, notes, actual_result, outcome, settled_at, created_at'
    )
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = data ?? []
  const settled = rows.filter((r) => r.outcome !== null && r.outcome !== undefined)
  const settledCount = settled.length
  const correctCount = settled.filter((r) => r.outcome === 'correct').length
  const wrongCount = settled.filter((r) => r.outcome === 'wrong').length
  const partialCount = settled.filter((r) => r.outcome === 'partial').length

  const pctCorrect =
    settledCount > 0 ? Math.round((correctCount / settledCount) * 1000) / 10 : null
  const pctWrong = settledCount > 0 ? Math.round((wrongCount / settledCount) * 1000) / 10 : null
  const pctPartial =
    settledCount > 0 ? Math.round((partialCount / settledCount) * 1000) / 10 : null
  const avgConfidence =
    settledCount > 0
      ? Math.round((settled.reduce((s, r) => s + r.confidence, 0) / settledCount) * 10) / 10
      : null
  const calibrationGap =
    avgConfidence !== null && pctCorrect !== null
      ? Math.round((avgConfidence * 10 - pctCorrect) * 10) / 10
      : null

  const initialStats = {
    total: rows.length,
    settled: settledCount,
    pct_correct: pctCorrect,
    pct_wrong: pctWrong,
    pct_partial: pctPartial,
    avg_confidence: avgConfidence,
    calibration_gap: calibrationGap,
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-base)',
        padding: '24px',
      }}
    >
      {/* ── Cockpit top rail ──────────────────────────────────────── */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      {/* ── Page header ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Predictions
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          Sports prediction calibration — track confidence vs accuracy to measure your intuition
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-critical-dim)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
            marginBottom: 16,
          }}
        >
          Database error: {error.message}
        </div>
      )}

      <PredictionsShell initialPredictions={rows} initialStats={initialStats} />
    </div>
  )
}
