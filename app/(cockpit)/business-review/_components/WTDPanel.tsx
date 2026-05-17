'use client'

import { useEffect, useState } from 'react'

// Inline types — do NOT import from route files (F11 — server-only module leak via Turbopack).
interface WTDWindow {
  orders: number
  revenue: number
}

interface WTDResponse {
  thisWeek: WTDWindow
  priorWeekSamePeriod: WTDWindow
  paceProjection: number
  dayOfWeekElapsed: number
  fetchedAt: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

function pctChange(current: number, prior: number): string {
  if (prior === 0) return current > 0 ? '+∞%' : '0%'
  const pct = ((current - prior) / prior) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function pctColor(current: number, prior: number): string {
  if (prior === 0) return 'var(--color-text-muted)'
  return current >= prior ? 'var(--color-positive)' : 'var(--color-critical)'
}

const DAY_NAMES: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function WTDSkeleton() {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        This Week
      </span>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
          marginTop: 16,
        }}
      >
        Loading…
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function WTDPanel() {
  const [data, setData] = useState<WTDResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/business-review/wtd', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<WTDResponse>
      })
      .then((payload) => {
        setData(payload)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  if (loading) return <WTDSkeleton />

  if (error) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '20px 24px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
        }}
      >
        Week-to-date unavailable.
      </div>
    )
  }

  if (!data) return null

  const { thisWeek, priorWeekSamePeriod, paceProjection, dayOfWeekElapsed } = data
  const dayLabel = DAY_NAMES[dayOfWeekElapsed] ?? 'Day'
  const revChange = pctChange(thisWeek.revenue, priorWeekSamePeriod.revenue)
  const ordChange = pctChange(thisWeek.orders, priorWeekSamePeriod.orders)

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
          This Week (Mon–{dayLabel})
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          vs prior week same period
        </span>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px 24px',
        }}
      >
        {/* Orders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-disabled)',
            }}
          >
            Orders
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-pillar-value)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {thisWeek.orders}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: pctColor(thisWeek.orders, priorWeekSamePeriod.orders),
            }}
          >
            {ordChange} vs {priorWeekSamePeriod.orders} prior
          </span>
        </div>

        {/* Revenue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-disabled)',
            }}
          >
            Revenue
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-pillar-value)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmt(thisWeek.revenue)}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: pctColor(thisWeek.revenue, priorWeekSamePeriod.revenue),
            }}
          >
            {revChange} vs {fmt(priorWeekSamePeriod.revenue)} prior
          </span>
        </div>

        {/* Pace projection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-disabled)',
            }}
          >
            Projected Week
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-pillar-value)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmt(paceProjection)}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            at current {dayLabel} pace
          </span>
        </div>
      </div>
    </div>
  )
}
