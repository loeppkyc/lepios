'use client'

import { useEffect, useState } from 'react'
// Inline types — do NOT import from route files. Route handlers import server-only modules
// (lib/amazon/client uses Node.js `crypto`). Turbopack traverses the import type graph
// and leaks server-only modules into the client bundle, silently breaking the component. (F11)
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

// ── Inline types (mirrored from route — F11 safe) ────────────────────────────

interface DayPanelData {
  confirmedCount: number
  unitsSold: number
  revenueCad: number
  pendingCount: number
  taxCad: number
}

interface DebugOrder {
  id: string
  status: string
  purchaseDate: string | undefined
  units: number
  orderTotal: string | undefined
}

interface TodayYesterdayResponse {
  today: DayPanelData
  yesterday: DayPanelData
  fetchedAt: string
  payout_estimate: number | null
  margin_mtd: number | null
  _debug: {
    today: DebugOrder[]
    yesterday: DebugOrder[]
    todayAfter: string
    yesterdayAfter: string
    yesterdayBefore: string
  }
}

// ── Primitive: single stat row ────────────────────────────────────────────────

function StatRow({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
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
          color: valueColor ?? 'var(--color-text-primary)',
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
  payoutEstimate,
  marginMtd,
}: {
  heading: string
  data: DayPanelData
  /** Today panel surfaces pending orders as a sub-line — never in the headline counts */
  showPendingIndicator: boolean
  /** Estimated open settlement payout — null when not yet available. Today panel only. */
  payoutEstimate?: number | null
  /** Gross margin month-to-date from settlements — null when no data. Today panel only. */
  marginMtd?: number | null
}) {
  // Headline numbers always reflect CONFIRMED only — matches Amazon "Sales today
  // so far". Pending orders are not sales and never appear in the bold headline.
  const displayOrders = data.confirmedCount
  const displayUnits = data.unitsSold

  const revenueValue = data.confirmedCount > 0 ? `$${data.revenueCad.toFixed(2)}` : '$0.00'

  // Sub-lines: always show pending count on Today panel when pending > 0.
  // Tax sub-line only when there's confirmed revenue.
  const pendingSub =
    showPendingIndicator && data.pendingCount > 0
      ? `+ ${data.pendingCount} pending order${data.pendingCount === 1 ? '' : 's'}`
      : undefined

  const taxSub =
    data.confirmedCount > 0 && data.taxCad > 0 ? `+ $${data.taxCad.toFixed(2)} tax` : undefined

  // Revenue prefers tax sub-line when there's confirmed revenue + tax;
  // otherwise falls back to pending indicator.
  const revenueSub = taxSub ?? pendingSub

  // Orders sub-line surfaces pending count whenever pending > 0 on Today.
  const ordersSub = pendingSub

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
        <StatRow label="Units" value={displayUnits.toString()} />
        <StatRow
          label="Est. Payout"
          value={payoutEstimate != null ? `$${payoutEstimate.toFixed(2)}` : '—'}
          sub={payoutEstimate != null ? 'Open settlement period' : undefined}
        />
        {marginMtd != null && (
          <StatRow
            label="Margin MTD"
            value={`$${marginMtd.toFixed(2)}`}
            sub="Estimated · settlement basis"
            valueColor={marginMtd >= 0 ? 'var(--color-positive)' : 'var(--color-critical)'}
          />
        )}
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
              <td colSpan={5} style={{ padding: '4px 6px', color: 'var(--color-text-disabled)' }}>
                No orders in window
              </td>
            </tr>
          )}
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{'…' + o.id.slice(-10)}</td>
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

// Auto-refresh interval — keep Today/Yesterday counts current without manual reload.
const REFRESH_INTERVAL_MS = 15 * 60 * 1000

export function TodayYesterdayPanel() {
  const [data, setData] = useState<TodayYesterdayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [devMode] = useDevMode()

  useEffect(() => {
    let cancelled = false

    const load = () => {
      fetch('/api/business-review/today-yesterday', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
          return res.json() as Promise<TodayYesterdayResponse>
        })
        .then((payload) => {
          if (cancelled) return
          setData(payload)
          setError(null)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        })
    }

    load()
    const interval = setInterval(load, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
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
    // Friendly UX: don't dump raw SP-API JSON to the user. Most 5xx are
    // Amazon-transient and self-heal on retry; the auto-refresh interval
    // re-runs the fetch every 15 min. The technical detail is preserved in
    // the dev-mode debug section for diagnosis.
    const isUpstream = /SP-API|HTTP 5\d\d|InternalFailure|ServiceUnavailable/i.test(error)
    const friendly = isUpstream
      ? 'Amazon temporarily unavailable — retrying.'
      : 'Could not load orders.'
    return (
      <div>
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
          {friendly}
        </div>
        {devMode && (
          <DebugSection heading="Debug — Today/Yesterday error">
            <pre
              style={{
                color: 'var(--color-critical)',
                fontSize: 'var(--text-nano)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error}
            </pre>
          </DebugSection>
        )}
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      {/* Panels row */}
      <div style={{ display: 'flex', gap: 16 }}>
        <DayPanel
          heading="Today"
          data={data.today}
          showPendingIndicator={true}
          payoutEstimate={data.payout_estimate}
          marginMtd={data.margin_mtd}
        />
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
