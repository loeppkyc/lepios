'use client'

import type { PredictionRow } from '@/lib/trading/types'

interface AIEngineTabProps {
  todayPredictions: PredictionRow[]
  loading: boolean
  onUsePick: (p: PredictionRow) => void
  onSettle: (id: string, won: boolean, pnl?: number) => void
  pendingPredictions: PredictionRow[]
}

/** Confidence bar — uses discrete width classes to avoid inline style (F20) */
function ConfBar({ value }: { value: number }) {
  // Map 0–10 to one of 11 discrete widths
  const pct = Math.round(Math.min(10, Math.max(0, value)) * 10)
  // Map percentage to a Tailwind w-* class (0, 10, 20 ... 100)
  const widthClass =
    pct === 0
      ? 'w-0'
      : pct <= 10
        ? 'w-[10%]'
        : pct <= 20
          ? 'w-[20%]'
          : pct <= 30
            ? 'w-[30%]'
            : pct <= 40
              ? 'w-[40%]'
              : pct <= 50
                ? 'w-1/2'
                : pct <= 60
                  ? 'w-[60%]'
                  : pct <= 70
                    ? 'w-[70%]'
                    : pct <= 80
                      ? 'w-4/5'
                      : pct <= 90
                        ? 'w-[90%]'
                        : 'w-full'
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div className={`h-full rounded-full bg-[var(--color-pillar-money)] ${widthClass}`} />
    </div>
  )
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/50',
  'B+': 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/50',
  B: 'bg-gray-700/50 text-gray-300',
  C: 'bg-gray-800/50 text-gray-500',
}

const GRADE_CARD_STYLES: Record<string, string> = {
  A: 'border-yellow-500/40 bg-yellow-500/5',
  'B+': 'border-blue-500/30 bg-blue-500/5',
  B: 'border-[var(--color-border)] bg-[var(--color-surface)]',
  C: 'border-[var(--color-border)]/50 bg-[var(--color-surface)]/50 opacity-70',
}

export function AIEngineTab({
  todayPredictions,
  loading,
  onUsePick,
  onSettle,
  pendingPredictions,
}: AIEngineTabProps) {
  // Sort: A first, then B+, B, C
  const GRADE_ORDER: Record<string, number> = { A: 0, 'B+': 1, B: 2, C: 3 }
  const sorted = [...todayPredictions].sort(
    (a, b) => (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3)
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Loading scores...
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Today's scores */}
      <div>
        <h3 className="label-caps mb-3 text-[var(--color-pillar-money)]">Today&apos;s Scores</h3>
        {sorted.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 text-center">
            <p className="text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
              No scores for today. The cron runs at 7:00 AM MDT.
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
              Or trigger manually: POST /api/trading/score
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((p) => (
              <PredictionCard key={p.id} prediction={p} onUsePick={onUsePick} />
            ))}
          </div>
        )}
      </div>

      {/* Pending predictions from prior days */}
      {pendingPredictions.length > 0 && (
        <div>
          <h3 className="label-caps mb-3 text-[var(--color-text-secondary)]">Pending Settlement</h3>
          <div className="flex flex-col gap-2">
            {pendingPredictions.map((p) => (
              <PendingRow key={p.id} prediction={p} onSettle={onSettle} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PredictionCard({
  prediction: p,
  onUsePick,
}: {
  prediction: PredictionRow
  onUsePick: (p: PredictionRow) => void
}) {
  const reasons = p.reason?.split(' | ') ?? []

  return (
    <div
      className={`flex flex-col gap-3 rounded-[var(--radius-md)] border px-4 py-4 ${GRADE_CARD_STYLES[p.grade] ?? GRADE_CARD_STYLES.C}`}
    >
      {/* Header: ticker + grade badge + direction */}
      <div className="flex items-start justify-between">
        <div>
          <span className="text-base font-semibold text-[var(--color-text-primary)]">
            {p.ticker}
          </span>
          <span
            className={`ml-2 rounded px-1.5 py-0.5 text-xs font-bold ${
              p.direction === 'long' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {p.direction?.toUpperCase()}
          </span>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${GRADE_STYLES[p.grade] ?? GRADE_STYLES.C}`}
        >
          {p.grade}
        </span>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-[var(--color-text-disabled)]">Entry</p>
          <p className="font-medium text-[var(--color-text-primary)]">
            {p.entry_price?.toFixed(2) ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-[var(--color-text-disabled)]">Stop</p>
          <p className="font-medium text-red-400">{p.stop_price?.toFixed(2) ?? '—'}</p>
        </div>
        <div>
          <p className="text-[var(--color-text-disabled)]">Target</p>
          <p className="font-medium text-green-400">{p.target_price?.toFixed(2) ?? '—'}</p>
        </div>
      </div>

      {/* R:R + confidence */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-[var(--color-text-disabled)]">
          R:R{' '}
          <span className="text-[var(--color-text-primary)]">
            1 : {p.risk_reward?.toFixed(1) ?? '—'}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--color-text-disabled)]">Conf</span>
          <ConfBar value={p.confidence ?? 0} />
          <span className="text-[var(--color-text-secondary)]">
            {(p.confidence ?? 0).toFixed(1)}/10
          </span>
        </div>
      </div>

      {/* Reasons */}
      <div className="flex flex-wrap gap-1">
        {reasons.slice(0, 3).map((r, i) => (
          <span
            key={i}
            className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
          >
            {r}
          </span>
        ))}
      </div>

      {/* Use this pick */}
      <button
        type="button"
        onClick={() => onUsePick(p)}
        className="mt-auto rounded bg-[var(--color-pillar-money)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-pillar-money)] transition-colors hover:bg-[var(--color-pillar-money)]/20"
      >
        Use This Pick
      </button>
    </div>
  )
}

function PendingRow({
  prediction: p,
  onSettle,
}: {
  prediction: PredictionRow
  onSettle: (id: string, won: boolean, pnl?: number) => void
}) {
  return (
    <div className="flex items-center gap-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <span className="text-sm font-medium text-[var(--color-text-primary)]">{p.ticker}</span>
      <span
        className={`text-xs font-semibold ${p.direction === 'long' ? 'text-green-400' : 'text-red-400'}`}
      >
        {p.direction?.toUpperCase()}
      </span>
      <span className={`rounded px-1.5 py-0.5 text-xs ${GRADE_STYLES[p.grade] ?? GRADE_STYLES.C}`}>
        {p.grade}
      </span>
      <span className="text-xs text-[var(--color-text-disabled)]">{p.pick_date}</span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={() => onSettle(p.id, true)}
          className="rounded bg-green-900/50 px-2.5 py-1 text-xs font-medium text-green-300 hover:bg-green-900/70"
        >
          Won
        </button>
        <button
          type="button"
          onClick={() => onSettle(p.id, false)}
          className="rounded bg-red-900/50 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-900/70"
        >
          Lost
        </button>
      </div>
    </div>
  )
}
