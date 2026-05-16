'use client'

import { useState } from 'react'

interface Prediction {
  id: string
  sport: string
  event_desc: string
  prediction: string
  confidence: number
  game_date: string
  notes: string | null
  actual_result: string | null
  outcome: 'correct' | 'wrong' | 'partial' | null
  settled_at: string | null
  created_at: string
}

interface Stats {
  total: number
  settled: number
  pct_correct: number | null
  pct_wrong: number | null
  pct_partial: number | null
  avg_confidence: number | null
  calibration_gap: number | null
}

interface PredictionTableProps {
  predictions: Prediction[]
  stats: Stats
  onRefresh: () => void
}

const OUTCOME_COLORS = {
  correct: 'var(--color-positive)',
  wrong: 'var(--color-critical)',
  partial: 'var(--color-warning)',
}

const OUTCOME_LABELS = {
  correct: 'Correct',
  wrong: 'Wrong',
  partial: 'Partial',
}

const OUTCOME_OPTIONS = [
  { value: 'correct', label: 'Correct' },
  { value: 'wrong', label: 'Wrong' },
  { value: 'partial', label: 'Partial' },
]

function SettleInlineForm({
  predictionId,
  onSuccess,
  onCancel,
}: {
  predictionId: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [actualResult, setActualResult] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!outcome || !actualResult.trim()) {
      setError('Both fields are required.')
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/predictions/${predictionId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_result: actualResult.trim(), outcome }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Unknown error')
        return
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      data-testid="settle-prediction-form"
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        backgroundColor: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        marginTop: 4,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 2,
        }}
      >
        Settle this prediction
      </div>

      {/* Actual result input */}
      <input
        type="text"
        placeholder='e.g. "Chiefs won 27-20"'
        value={actualResult}
        onChange={(e) => setActualResult(e.target.value)}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-body)',
          color: 'var(--color-text-primary)',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border-accent)',
          borderRadius: 'var(--radius-md)',
          padding: '5px 8px',
          outline: 'none',
          width: '100%',
        }}
      />

      {/* Outcome radio buttons */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          Outcome:
        </span>
        {OUTCOME_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color:
                outcome === opt.value
                  ? OUTCOME_COLORS[opt.value as keyof typeof OUTCOME_COLORS]
                  : 'var(--color-text-secondary)',
              fontWeight: outcome === opt.value ? 700 : 400,
            }}
          >
            <input
              type="radio"
              name="outcome"
              value={opt.value}
              checked={outcome === opt.value}
              onChange={(e) => setOutcome(e.target.value)}
              style={{ accentColor: 'var(--color-accent-gold)', cursor: 'pointer' }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {error && (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-critical)',
          }}
        >
          {error}
        </span>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border-accent)',
            borderRadius: 'var(--radius-md)',
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-base)',
            backgroundColor: submitting ? 'var(--color-text-disabled)' : 'var(--color-positive)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '4px 12px',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </form>
  )
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string
  value: string | null
  color?: string
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-body)',
          fontWeight: 700,
          color: color ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value ?? '—'}
      </div>
    </div>
  )
}

export function PredictionTable({ predictions, stats, onRefresh }: PredictionTableProps) {
  const [settlingId, setSettlingId] = useState<string | null>(null)

  function handleSettleSuccess() {
    setSettlingId(null)
    onRefresh()
  }

  const calibrationColor =
    stats.calibration_gap === null
      ? 'var(--color-text-muted)'
      : Math.abs(stats.calibration_gap) < 5
        ? 'var(--color-positive)'
        : Math.abs(stats.calibration_gap) < 15
          ? 'var(--color-warning)'
          : 'var(--color-critical)'

  return (
    <div>
      {/* ── Summary stats bar ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 28,
          flexWrap: 'wrap',
          padding: '14px 0 16px',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 4,
        }}
      >
        <StatChip label="Total logged" value={String(stats.total)} />
        <StatChip
          label="Correct"
          value={
            stats.pct_correct !== null ? `${stats.pct_correct.toFixed(1)}%` : null
          }
          color={
            stats.pct_correct !== null
              ? stats.pct_correct >= 60
                ? 'var(--color-positive)'
                : stats.pct_correct >= 40
                  ? 'var(--color-warning)'
                  : 'var(--color-critical)'
              : undefined
          }
        />
        <StatChip
          label="Wrong"
          value={stats.pct_wrong !== null ? `${stats.pct_wrong.toFixed(1)}%` : null}
          color={stats.pct_wrong !== null ? 'var(--color-critical)' : undefined}
        />
        <StatChip
          label="Partial"
          value={
            stats.pct_partial !== null ? `${stats.pct_partial.toFixed(1)}%` : null
          }
          color={stats.pct_partial !== null ? 'var(--color-warning)' : undefined}
        />
        <StatChip
          label="Avg confidence"
          value={
            stats.avg_confidence !== null ? `${stats.avg_confidence.toFixed(1)} / 10` : null
          }
        />
        <StatChip
          label="Calibration gap"
          value={
            stats.calibration_gap !== null
              ? `${stats.calibration_gap > 0 ? '+' : ''}${stats.calibration_gap.toFixed(1)}%`
              : null
          }
          color={calibrationColor}
        />
      </div>

      {/* ── Table header ──────────────────────────────────────────── */}
      {predictions.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 60px 1fr 1fr 80px 120px 80px',
            gap: 8,
            padding: '6px 0',
            borderBottom: '1px solid var(--color-border-pillar)',
          }}
        >
          {['Date', 'Sport', 'Event', 'Prediction', 'Confidence', 'Result', 'Delta'].map(
            (h) => (
              <span
                key={h}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                }}
              >
                {h}
              </span>
            )
          )}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {predictions.length === 0 && (
        <div
          style={{
            padding: '32px 0',
            textAlign: 'center',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-muted)',
          }}
        >
          No predictions yet — log your first one above.
        </div>
      )}

      {/* ── Prediction rows ───────────────────────────────────────── */}
      {predictions.map((p, i) => {
        const delta =
          p.outcome !== null
            ? (() => {
                const accuracyPct =
                  p.outcome === 'correct' ? 100 : p.outcome === 'wrong' ? 0 : 50
                return Math.round((p.confidence * 10 - accuracyPct) * 10) / 10
              })()
            : null

        return (
          <div key={p.id}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 60px 1fr 1fr 80px 120px 80px',
                gap: 8,
                padding: '9px 0',
                borderBottom:
                  i < predictions.length - 1
                    ? '1px solid var(--color-border-pillar)'
                    : undefined,
                alignItems: 'start',
              }}
            >
              {/* Date */}
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {p.game_date}
              </span>

              {/* Sport */}
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent-gold)',
                }}
              >
                {p.sport}
              </span>

              {/* Event */}
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={p.event_desc}
              >
                {p.event_desc}
              </span>

              {/* Prediction */}
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={p.prediction}
              >
                {p.prediction}
              </span>

              {/* Confidence */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 600,
                  color:
                    p.confidence >= 8
                      ? 'var(--color-positive)'
                      : p.confidence >= 5
                        ? 'var(--color-warning)'
                        : 'var(--color-critical)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {p.confidence} / 10
              </span>

              {/* Result / Settle button */}
              <div>
                {p.outcome !== null ? (
                  <div>
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: OUTCOME_COLORS[p.outcome],
                      }}
                    >
                      {OUTCOME_LABELS[p.outcome]}
                    </span>
                    {p.actual_result && (
                      <div
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-muted)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={p.actual_result}
                      >
                        {p.actual_result}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    data-testid={`settle-btn-${p.id}`}
                    onClick={() => setSettlingId(settlingId === p.id ? null : p.id)}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                      backgroundColor: 'transparent',
                      border: '1px solid var(--color-border-accent)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '3px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {settlingId === p.id ? 'Cancel' : 'Settle'}
                  </button>
                )}
              </div>

              {/* Delta (confidence% - accuracy%) */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    delta === null
                      ? 'var(--color-text-disabled)'
                      : Math.abs(delta) < 10
                        ? 'var(--color-positive)'
                        : 'var(--color-warning)',
                }}
              >
                {delta === null
                  ? '—'
                  : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
              </span>
            </div>

            {/* Inline settle form */}
            {settlingId === p.id && (
              <div style={{ paddingBottom: 12 }}>
                <SettleInlineForm
                  predictionId={p.id}
                  onSuccess={handleSettleSuccess}
                  onCancel={() => setSettlingId(null)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
