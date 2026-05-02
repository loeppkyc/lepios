'use client'

import { useEffect, useState } from 'react'
import type {
  TodayYesterdayResponse,
  DebugOrder,
} from '@/app/api/business-review/today-yesterday/route'
import type { DayPanelData } from '@/lib/amazon/orders'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

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
  /** Today panel includes pending orders in headline counts */
  showPendingIndicator: boolean
}) {
  // Today: count all orders including pending so "0 orders" never shows on an active day
  const displayOrders = showPendingIndicator
    ? data.confirmedCount + data.pendingCount
    : data.confirmedCount

  // Today: include pending units when there are no confirmed ones yet
  const displayUnits =
    showPendingIndicator && data.confirmedCount === 0 && data.pendingCount > 0
      ? data.pendingUnits
      : data.unitsSold

  // Revenue: show dollar amount for confirmed orders, "N pending" label otherwise
  const revenueValue =
    data.confirmedCount > 0
      ? `$${data.revenueCad.toFixed(2)}`
      : showPendingIndicator && data.pendingCount > 0
        ? `${data.pendingCount} pending`
        : '—'

  const revenueSub =
    data.confirmedCount > 0 && data.taxCad > 0
      ? `+ $${data.taxCad.toFixed(2)} tax`
      : data.confirmedCount > 0 && showPendingIndicator && data.pendingCount > 0
        ? `+ ${data.pendingCount} pending`
        : undefined

  const ordersSub =
    showPendingIndicator && data.confirmedCount > 0 && data.pendingCount > 0
      ? `${data.confirmedCount} confirmed + ${data.pendingCount} pending`
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
        <StatRow label="Orders" value={displayOrders.toString()} sub={ordersSub} />
        <StatRow label="Revenue" value={revenueValue} sub={revenueSub} />
        <StatRow label="Units" value={displayOrders > 0 ? displayUnits.toString() : '—'} />
        {/* Constraint 6: static payout label — no number */}
        <StatRow label="Payout" value="—" sub="Full payout estimate in Sprint 5" />
      </div>
    </div>
  )
}

// ── Debug order table (used inside shared DebugSection) ──────────────────────

function DebugOrderTable({
  orders,
  windowStart,
  windowEnd,
}: {
  orders: DebugOrder[]
  windowStart: string
  windowEnd: string
}) {
  return (
    <>
      <div style={{ color: 'var(--color-text-disabled)', marginBottom: 6 }}>
        Window: {windowStart} → {windowEnd}
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          color: 'var(--color-text-primary)',
        }}
      >
        <thead>
          <tr>
            {['Order ID', 'Status', 'Date (UTC)', 'Units', 'OrderTotal'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '2px 6px',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-disabled)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr>
              <td
                colSpan={5}
                style={{ padding: '4px 6px', color: 'var(--color-text-disabled)' }}
              >
                No orders in window
              </td>
            </tr>
          )}
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>
                {'…' + o.id.slice(-10)}
              </td>
              <td
                style={{
                  padding: '2px 6px',
                  color:
                    o.status === 'Pending'
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-primary)',
                }}
              >
                {o.status}
              </td>
              <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>
                {o.purchaseDate ? o.purchaseDate.replace('T', ' ').slice(0, 19) : '—'}
              </td>
              <td style={{ padding: '2px 6px', textAlign: 'right' }}>{o.units}</td>
              <td style={{ padding: '2px 6px', textAlign: 'right' }}>
                {o.orderTotal ? `$${o.orderTotal}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
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
  const [devMode] = useDevMode()

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
    <div>
      {/* Panels row */}
      <div style={{ display: 'flex', gap: 16 }}>
        <DayPanel heading="Today" data={data.today} showPendingIndicator={true} />
        <DayPanel heading="Yesterday" data={data.yesterday} showPendingIndicator={false} />
      </div>

      {/* Debug sections (dev mode only) */}
      {devMode && data._debug && (
        <div style={{ display: 'flex', gap: 16, marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <DebugSection heading="Debug — Today Live Sales">
              <DebugOrderTable
                orders={data._debug.today}
                windowStart={data._debug.todayAfter}
                windowEnd="(now)"
              />
            </DebugSection>
          </div>
          <div style={{ flex: 1 }}>
            <DebugSection heading="Debug — Yesterday Sales">
              <DebugOrderTable
                orders={data._debug.yesterday}
                windowStart={data._debug.yesterdayAfter}
                windowEnd={data._debug.yesterdayBefore}
              />
            </DebugSection>
          </div>
        </div>
      )}
    </div>
  )
}
