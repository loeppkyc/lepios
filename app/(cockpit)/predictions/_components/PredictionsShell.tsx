'use client'

import { useState, useCallback } from 'react'
import { LogPredictionForm } from './LogPredictionForm'
import { PredictionTable } from './PredictionTable'

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

interface PredictionsShellProps {
  initialPredictions: Prediction[]
  initialStats: Stats
}

export function PredictionsShell({ initialPredictions, initialStats }: PredictionsShellProps) {
  const [showLogForm, setShowLogForm] = useState(false)
  const [predictions, setPredictions] = useState<Prediction[]>(initialPredictions)
  const [stats, setStats] = useState<Stats>(initialStats)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/predictions')
      if (res.ok) {
        const json = await res.json()
        setPredictions(json.predictions ?? [])
        setStats(json.stats ?? initialStats)
      }
    } catch {
      // Non-critical — stale data shown
    } finally {
      setRefreshing(false)
    }
  }, [initialStats])

  function handleLogSuccess() {
    setShowLogForm(false)
    void refresh()
  }

  return (
    <div>
      {/* ── Log Prediction section ──────────────────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {/* Section header */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: showLogForm ? '1px solid var(--color-border)' : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            Log Prediction
          </span>
          <button
            data-testid="log-prediction-toggle"
            onClick={() => setShowLogForm((v) => !v)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: showLogForm ? 'var(--color-base)' : 'var(--color-accent-gold)',
              backgroundColor: showLogForm ? 'var(--color-accent-gold)' : 'transparent',
              border: '1px solid var(--color-accent-gold)',
              borderRadius: 'var(--radius-md)',
              padding: '4px 12px',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            {showLogForm ? 'Cancel' : '+ New Prediction'}
          </button>
        </div>

        {/* Log form */}
        {showLogForm && (
          <div style={{ padding: '0 20px 16px' }}>
            <LogPredictionForm onSuccess={handleLogSuccess} />
          </div>
        )}
      </div>

      {/* ── My Record section ───────────────────────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {/* Section header */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            My Record
            {predictions.length > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--color-text-disabled)',
                  fontWeight: 400,
                }}
              >
                (last {predictions.length})
              </span>
            )}
          </span>
          {refreshing && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              Refreshing...
            </span>
          )}
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <PredictionTable
            predictions={predictions}
            stats={stats}
            onRefresh={refresh}
          />
        </div>
      </div>
    </div>
  )
}
