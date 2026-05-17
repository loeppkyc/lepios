'use client'

import { useEffect, useState, useCallback } from 'react'
import type { GateEvaluation, MetricEval } from '@/lib/trust/state'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaguePerf {
  league: string
  bets: number
  wins: number
  win_rate: number
  roi: number
}

// ── Helper components ─────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: 'paper' | 'live' }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold tracking-wide ${
        mode === 'live' ? 'bg-green-900/40 text-green-400' : 'bg-orange-900/40 text-orange-400'
      }`}
    >
      {mode.toUpperCase()}
    </span>
  )
}

function MetricRow({ label, eval: ev }: { label: string; eval: MetricEval & { key?: string } }) {
  const pass = ev.pass
  const currentStr = ev.current != null ? ev.current.toFixed(3) : 'N/A'
  const thresholdStr = ev.threshold.toFixed(3)

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`text-sm ${pass ? 'text-green-400' : 'text-red-400'}`}>
          {pass ? 'PASS' : 'FAIL'}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-xs text-[var(--color-text-primary)]">{currentStr}</span>
        <span className="mx-1 text-[10px] text-[var(--color-text-disabled)]">vs</span>
        <span className="text-xs text-[var(--color-text-disabled)]">{thresholdStr}</span>
      </div>
    </div>
  )
}

function ThresholdEditor({
  domain,
  evaluation,
  onUpdated,
}: {
  domain: 'trading' | 'sports'
  evaluation: GateEvaluation | null
  onUpdated: () => void
}) {
  const [minSample, setMinSample] = useState('')
  const [winRate, setWinRate] = useState('')
  const [secondary, setSecondary] = useState('')
  const [calibration, setCalibration] = useState('')
  const [drawdown, setDrawdown] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr('')

    const updates: Record<string, number> = {}
    if (minSample) updates.min_sample_size = parseInt(minSample, 10)
    if (winRate) updates.win_rate_threshold = parseFloat(winRate)
    if (secondary) updates.secondary_metric_threshold = parseFloat(secondary)
    if (calibration) updates.calibration_threshold = parseFloat(calibration)
    if (drawdown) updates.max_drawdown_threshold = parseFloat(drawdown)

    if (Object.keys(updates).length === 0) {
      setErr('No values entered')
      setSaving(false)
      return
    }

    try {
      const res = await fetch(`/api/trust-state/${domain}/thresholds`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = (await res.json()) as { error?: string; loosened_while_live?: boolean }
      if (!res.ok) {
        setErr(data.error ?? 'Failed to update')
        return
      }
      if (data.loosened_while_live) {
        setErr('Warning: thresholds loosened while LIVE — flagged in agent_events')
      }
      onUpdated()
      setMinSample('')
      setWinRate('')
      setSecondary('')
      setCalibration('')
      setDrawdown('')
    } catch {
      setErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  const m = evaluation?.metrics

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        Edit Thresholds
      </summary>
      <form onSubmit={handleSave} className="mt-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[var(--color-text-disabled)]">
              Min Sample ({m?.sample_size.threshold})
            </label>
            <input
              type="number"
              placeholder={String(m?.sample_size.threshold ?? '')}
              value={minSample}
              onChange={(e) => setMinSample(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[var(--color-text-disabled)]">
              Win Rate ({m?.win_rate.threshold.toFixed(2)})
            </label>
            <input
              type="number"
              step="0.01"
              placeholder={String(m?.win_rate.threshold ?? '')}
              value={winRate}
              onChange={(e) => setWinRate(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[var(--color-text-disabled)]">
              {m?.secondary.key ?? 'Secondary'} ({m?.secondary.threshold.toFixed(3)})
            </label>
            <input
              type="number"
              step="0.01"
              placeholder={String(m?.secondary.threshold ?? '')}
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[var(--color-text-disabled)]">
              Calibration ({m?.calibration.threshold.toFixed(2)})
            </label>
            <input
              type="number"
              step="0.01"
              placeholder={String(m?.calibration.threshold ?? '')}
              value={calibration}
              onChange={(e) => setCalibration(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-[var(--color-text-disabled)]">
              Max Drawdown ({m?.drawdown.threshold.toFixed(2)})
            </label>
            <input
              type="number"
              step="0.01"
              placeholder={String(m?.drawdown.threshold ?? '')}
              value={drawdown}
              onChange={(e) => setDrawdown(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            />
          </div>
        </div>
        {err && <p className="text-[10px] text-yellow-400">{err}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-fit rounded bg-[var(--color-surface-2)] px-4 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Thresholds'}
        </button>
      </form>
    </details>
  )
}

function DomainPanel({
  domain,
  evaluation,
  leaguePerf,
  onFlipMode,
  onThresholdsUpdated,
}: {
  domain: 'trading' | 'sports'
  evaluation: GateEvaluation | null
  leaguePerf: LeaguePerf[]
  onFlipMode: (domain: 'trading' | 'sports', to: 'live' | 'paper') => void
  onThresholdsUpdated: () => void
}) {
  const [flipping, setFlipping] = useState(false)
  const [flipErr, setFlipErr] = useState('')

  async function handleFlip(toMode: 'live' | 'paper') {
    setFlipping(true)
    setFlipErr('')
    try {
      const res = await fetch(`/api/trust-state/${domain}/flip-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_mode: toMode,
          confirmation: `Flip ${domain} to ${toMode}`,
          reason: toMode === 'paper' ? 'Manual flip to paper' : undefined,
        }),
      })
      const data = (await res.json()) as { error?: string; failures?: string[] }
      if (!res.ok) {
        setFlipErr(data.error ?? 'Failed to flip')
        return
      }
      onFlipMode(domain, toMode)
    } catch {
      setFlipErr('Network error')
    } finally {
      setFlipping(false)
    }
  }

  const isLoading = evaluation === null
  const mode = evaluation?.current_mode ?? 'paper'
  const gateOpen = evaluation?.gate_status === 'open'
  const passCount = evaluation
    ? Object.values(evaluation.metrics).filter((m) => (m as MetricEval).pass).length
    : 0

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
      {/* Status banner */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] capitalize">
              {domain}
            </h2>
            {!isLoading && <ModeBadge mode={mode} />}
          </div>
          {!isLoading && (
            <p className="mt-0.5 text-xs text-[var(--color-text-disabled)]">
              {gateOpen ? 'Gate: OPEN — ready to go live' : `Gate: ${passCount}/5 thresholds met`}
            </p>
          )}
        </div>
        {!isLoading && (
          <div className="flex flex-col items-end gap-1">
            {mode === 'paper' && (
              <button
                type="button"
                onClick={() => void handleFlip('live')}
                disabled={!gateOpen || flipping}
                className="rounded bg-green-900/40 px-3 py-1 text-xs font-medium text-green-400 hover:bg-green-900/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {flipping ? 'Flipping...' : 'Go Live'}
              </button>
            )}
            {mode === 'live' && (
              <button
                type="button"
                onClick={() => void handleFlip('paper')}
                disabled={flipping}
                className="rounded bg-[var(--color-surface-2)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
              >
                {flipping ? '...' : 'Back to Paper'}
              </button>
            )}
            {flipErr && (
              <p className="max-w-[200px] text-right text-[10px] text-red-400">{flipErr}</p>
            )}
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && <p className="text-xs text-[var(--color-text-disabled)]">Loading...</p>}

      {/* Threshold table */}
      {evaluation && (
        <div className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1">
          <p className="label-caps mb-1 text-[var(--color-text-disabled)]">Thresholds</p>
          <MetricRow label="Sample size" eval={evaluation.metrics.sample_size} />
          <MetricRow label="Win rate" eval={evaluation.metrics.win_rate} />
          <MetricRow label={evaluation.metrics.secondary.key} eval={evaluation.metrics.secondary} />
          <MetricRow label="Calibration" eval={evaluation.metrics.calibration} />
          <MetricRow label="Max drawdown" eval={evaluation.metrics.drawdown} />
        </div>
      )}

      {/* League performance (sports only) */}
      {domain === 'sports' && leaguePerf.length > 0 && (
        <div className="mb-4">
          <p className="label-caps mb-2 text-[var(--color-text-disabled)]">League Performance</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-text-disabled)]">
                  <th className="pb-1 text-left font-normal">League</th>
                  <th className="pb-1 text-right font-normal">Bets</th>
                  <th className="pb-1 text-right font-normal">Win%</th>
                  <th className="pb-1 text-right font-normal">ROI%</th>
                </tr>
              </thead>
              <tbody>
                {leaguePerf.map((l) => (
                  <tr
                    key={l.league}
                    className={`border-b border-[var(--color-border)] last:border-0 ${
                      l.roi < 0 ? 'text-red-400' : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    <td className="py-1">{l.league}</td>
                    <td className="py-1 text-right">{l.bets}</td>
                    <td className="py-1 text-right">{l.win_rate.toFixed(1)}%</td>
                    <td className="py-1 text-right">{l.roi.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Failures */}
      {evaluation && evaluation.failures.length > 0 && (
        <div className="mb-4 rounded border border-red-900/30 bg-red-900/10 px-3 py-2">
          <p className="label-caps mb-1 text-red-400">Unmet Thresholds</p>
          {evaluation.failures.map((f, i) => (
            <p key={i} className="text-xs text-red-300">
              {f}
            </p>
          ))}
        </div>
      )}

      {/* Threshold editor */}
      {evaluation && (
        <ThresholdEditor domain={domain} evaluation={evaluation} onUpdated={onThresholdsUpdated} />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CalibrationPage() {
  const [tradingEval, setTradingEval] = useState<GateEvaluation | null>(null)
  const [sportsEval, setSportsEval] = useState<GateEvaluation | null>(null)
  const [leaguePerf, setLeaguePerf] = useState<LeaguePerf[]>([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [tradingRes, sportsRes, leagueRes] = await Promise.all([
          fetch('/api/trust-state/trading'),
          fetch('/api/trust-state/sports'),
          fetch('/api/calibration/league-perf'),
        ])

        if (!cancelled) {
          if (tradingRes.ok) {
            setTradingEval((await tradingRes.json()) as GateEvaluation)
          }
          if (sportsRes.ok) {
            setSportsEval((await sportsRes.json()) as GateEvaluation)
          }
          if (leagueRes.ok) {
            const data = (await leagueRes.json()) as { leagues: LeaguePerf[] }
            setLeaguePerf(data.leagues ?? [])
          }
        }
      } catch {
        // silent
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tick])

  function handleFlipMode(domain: 'trading' | 'sports', _to: 'live' | 'paper') {
    // Refetch after flip
    if (domain === 'trading') setTradingEval(null)
    else setSportsEval(null)
    refresh()
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
          AI Pick Engine — Calibration
        </h1>
        <p className="mt-0.5 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Paper-to-live gate — all 5 thresholds must pass per domain
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DomainPanel
          domain="trading"
          evaluation={tradingEval}
          leaguePerf={[]}
          onFlipMode={handleFlipMode}
          onThresholdsUpdated={refresh}
        />
        <DomainPanel
          domain="sports"
          evaluation={sportsEval}
          leaguePerf={leaguePerf}
          onFlipMode={handleFlipMode}
          onThresholdsUpdated={refresh}
        />
      </div>

      <p className="mt-8 text-center text-xs text-[var(--color-text-disabled)]">
        The purpose of this module is that pressing &quot;Go Live&quot; is earned, not aspirational.
      </p>
    </div>
  )
}
