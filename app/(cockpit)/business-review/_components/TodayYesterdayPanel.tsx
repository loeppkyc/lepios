'use client'

import { useEffect, useState } from 'react'
import type { TodayYesterdayResponse } from '@/app/api/business-review/today-yesterday/route'
import type { DayPanelData } from '@/lib/amazon/orders'

// ── Primitive: single stat row ────────────────────────────────────────────────

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
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
        {label}
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
        {value}
      </span>
      {sub && (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Primitive: single day panel card ─────────────────────────────────────────

function DayPanel({
  heading,
  data,
  showPendingIndicator,
}: {
  heading: string
  data: DayPanelData
  /** Only Today panel shows pending indicator when confirmed = 0 and pending > 0 */
  showPendingIndicator: boolean
}) {
  const pendingLabel =
    showPendingIndicator && data.confirmedCount === 0 && data.pendingCount > 0
      ? `(${data.pendingCount} pending not shown)`
      : undefined

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Panel heading */}
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        {heading}
      </span>

      {/* Stat grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px 24px',
        }}
      >
        <StatRow label="Orders" value={data.confirmedCount.toString()} sub={pendingLabel} />
        <StatRow
          label="Revenue"
          value={data.confirmedCount > 0 ? `$${data.revenueCad.toFixed(2)}` : '—'}
        />
        <StatRow label="Units" value={data.confirmedCount > 0 ? data.unitsSold.toString() : '—'} />
        {/* Constraint 6: static payout label — no number */}
        <StatRow label="Payout" value="—" sub="Full payout estimate in Sprint 5" />
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PanelSkeleton({ heading }: { heading: string }) {
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        {heading}
      </span>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Loading…
      </div>
    </div>
  )
}

// ── Main exported component ───────────────────────────────────────────────────

export function TodayYesterdayPanel() {
  const [data, setData] = useState<TodayYesterdayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/business-review/today-yesterday')
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<TodayYesterdayResponse>
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

  if (loading) {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        <PanelSkeleton heading="Today" />
        <PanelSkeleton heading="Yesterday" />
      </div>
    )
  }

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
          color: 'var(--color-critical)',
        }}
      >
        Failed to load orders: {error}
      </div>
    )
  }

  if (!data) return null

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <DayPanel heading="Today" data={data.today} showPendingIndicator={true} />
      <DayPanel heading="Yesterday" data={data.yesterday} showPendingIndicator={false} />
    </div>
  )
}
