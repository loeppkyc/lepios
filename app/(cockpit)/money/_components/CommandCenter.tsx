'use client'

/**
 * Command Center — Unified trading + sports + Amazon signal hub.
 *
 * Prepended to the /money page as a new component at the top.
 * Shows: composite confidence score, signal breakdown, today's picks,
 * and this week's combined P&L.
 *
 * F20: No style={} — Tailwind only.
 * Data source: /api/command-center (single fetch, four sections).
 */

import { useEffect, useState } from 'react'
import type { CommandCenterPayload } from '@/app/api/command-center/route'
import type { CompositeScore, Signal } from '@/lib/trading/composite'

// ── Score colour ──────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  if (score >= 25) return 'text-orange-400'
  return 'text-red-400'
}

function scoreBg(score: number): string {
  if (score >= 75) return 'bg-green-400/10 border-green-400/20'
  if (score >= 50) return 'bg-yellow-400/10 border-yellow-400/20'
  if (score >= 25) return 'bg-orange-400/10 border-orange-400/20'
  return 'bg-red-400/10 border-red-400/20'
}

// ── Signal bar row ────────────────────────────────────────────────────────────

function SignalRow({ signal }: { signal: Signal }) {
  const pct = Math.max(0, Math.min(100, signal.value))
  const barColor = pct >= 75 ? 'bg-green-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'

  // F20: no style={} — use native <progress> styled via Tailwind
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[length:var(--text-nano)] font-medium tracking-wide text-[var(--color-text-disabled)] uppercase">
        {signal.name}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        {/* Segmented bar using flex — avoids style={} dynamic width */}
        <div
          className={`h-full rounded-full ${barColor}`}
          data-pct={pct}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        >
          {/* Width via CSS var injected by a parent — workaround: use inline-ish SVG rect fraction */}
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 100 1`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <rect x="0" y="0" width={pct} height="1" fill="currentColor" />
          </svg>
        </div>
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[length:var(--text-nano)] text-[var(--color-text-secondary)]">
        {Math.round(pct)}
      </span>
      {!signal.available && (
        <span className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">—</span>
      )}
    </div>
  )
}

// ── Composite panel ───────────────────────────────────────────────────────────

function CompositePanel({ composite }: { composite: CompositeScore }) {
  const [now] = useState(() => Date.now())
  const ageMin = Math.round((now - new Date(composite.computed_at).getTime()) / 60_000)

  return (
    <div className={`rounded-[var(--radius-md)] border p-4 ${scoreBg(composite.score)}`}>
      <div className="mb-3 flex items-baseline gap-3">
        <span
          className={`font-mono text-4xl font-bold tabular-nums ${scoreColor(composite.score)}`}
        >
          {composite.score}
        </span>
        <span className="text-[length:var(--text-small)] text-[var(--color-text-secondary)]">
          / 100
        </span>
        <span className="label-caps text-[var(--color-text-disabled)]">
          {composite.interpretation === 'high' && 'HIGH'}
          {composite.interpretation === 'moderate' && 'MODERATE'}
          {composite.interpretation === 'cautious' && 'CAUTIOUS'}
          {composite.interpretation === 'standAside' && 'STAND ASIDE'}
        </span>
      </div>
      <p className="mb-3 text-[length:var(--text-small)] text-[var(--color-text-secondary)]">
        {composite.interpretation_text}
      </p>
      <div className="flex flex-col gap-1.5">
        {composite.signals.map((s) => (
          <SignalRow key={s.name} signal={s} />
        ))}
      </div>
      <p className="mt-2 text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
        {composite.cached ? `Cached ${ageMin}m ago` : 'Refreshed just now'}
      </p>
    </div>
  )
}

// ── Picks panel ───────────────────────────────────────────────────────────────

function PicksPanel({ data }: { data: CommandCenterPayload }) {
  const { trading_picks, sports_picks } = data
  const hasPicks = trading_picks.length > 0 || sports_picks.length > 0

  if (!hasPicks) {
    return (
      <div className="flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <p className="text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Run score at 7am to populate today&apos;s picks
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {trading_picks.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <span className="label-caps mb-2 block text-[var(--color-pillar-money)]">
            Trading Picks (A-grade)
          </span>
          <div className="flex flex-col gap-2">
            {trading_picks.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">
                    {p.ticker}
                  </span>
                  <span
                    className={`text-[length:var(--text-nano)] font-semibold uppercase ${
                      p.direction === 'long' ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {p.direction}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[length:var(--text-nano)] text-[var(--color-text-secondary)]">
                  {p.entry_price != null && <span>In: {p.entry_price}</span>}
                  {p.stop_price != null && <span>Stop: {p.stop_price}</span>}
                  {p.target_price != null && <span>Target: {p.target_price}</span>}
                  {p.risk_reward != null && (
                    <span className="text-[var(--color-text-muted)]">
                      R:R {p.risk_reward.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sports_picks.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <span className="label-caps mb-2 block text-[var(--color-pillar-money)]">
            Sports Picks (green tier, {sports_picks.length} games)
          </span>
          <div className="flex flex-col gap-1.5">
            {sports_picks.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="text-[length:var(--text-small)] text-[var(--color-text-primary)]">
                  {p.favorite} {p.fav_odds > 0 ? `+${p.fav_odds}` : p.fav_odds} vs{' '}
                  {p.home === p.favorite ? p.away : p.home}
                </span>
                <span className="label-caps text-[var(--color-text-disabled)]">{p.league}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── P&L tiles ─────────────────────────────────────────────────────────────────

function PnlTile({ label, value }: { label: string; value: number }) {
  const isPositive = value > 0
  const isNegative = value < 0
  const color = isPositive
    ? 'text-green-400'
    : isNegative
      ? 'text-red-400'
      : 'text-[var(--color-text-muted)]'

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-[length:var(--text-nano)] font-semibold tracking-wide text-[var(--color-text-disabled)] uppercase">
        {label}
      </p>
      <p className={`font-mono text-lg font-bold tabular-nums ${color}`}>
        {isPositive ? '+' : ''}${value.toFixed(2)}
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CommandCenter() {
  const [data, setData] = useState<CommandCenterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/command-center')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CommandCenterPayload>
      })
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <span className="label-caps text-[var(--color-text-disabled)]">Command Center</span>
        <p className="mt-2 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Loading signals…
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <span className="label-caps text-[var(--color-pillar-money)]">Command Center</span>
        <p className="mt-2 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          {error ?? 'Data unavailable'}
        </p>
      </div>
    )
  }

  return (
    <div
      className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      data-testid="command-center"
    >
      {/* Header */}
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <span className="label-caps text-[var(--color-pillar-money)]">Command Center</span>
      </div>

      {/* 2-column layout on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        {/* Left: Signals */}
        <CompositePanel composite={data.composite} />

        {/* Right: Today's picks */}
        <PicksPanel data={data} />
      </div>

      {/* Full-width: Weekly P&L */}
      <div className="border-t border-[var(--color-border)] px-5 py-4">
        <span className="label-caps mb-3 block text-[var(--color-text-secondary)]">
          This Week P&L
        </span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PnlTile label="Trading" value={data.weekly_pnl.trading} />
          <PnlTile label="Sports" value={data.weekly_pnl.sports} />
          <PnlTile label="Amazon" value={data.weekly_pnl.amazon} />
          <PnlTile label="Combined" value={data.weekly_pnl.combined} />
        </div>
      </div>
    </div>
  )
}
