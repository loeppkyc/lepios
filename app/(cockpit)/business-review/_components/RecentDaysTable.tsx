'use client'

import { useEffect, useState } from 'react'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

// Inline types — do NOT import from route files. Route handlers import lib/amazon/client
// which uses Node.js `crypto`. Turbopack traverses the import type graph and leaks
// server-only modules into the client bundle, silently breaking the component. (Constraint C-2)
interface RecentDayRow {
  date: string // ISO date string e.g. "2026-04-22"
  orders: number
  revenueCad: number
  units: number
  pendingOrders: number
  pendingRevenueCad: number
  pendingUnits: number
}

interface RecentDaysResponse {
  rows: RecentDayRow[]
  fetchedAt: string
  partialData?: { failedOrders: number; totalOrders: number }
}

// ── "Minutes ago" helper ──────────────────────────────────────────────────────

function minutesAgo(isoTimestamp: string): string {
  const fetchedAt = new Date(isoTimestamp).getTime()
  const now = Date.now()
  const diffMs = now - fetchedAt
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  return `${mins} min ago`
}

// ── Format date as "Apr 22" ───────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  // Append T12:00:00 so Date parsing isn't affected by timezone shifts for date-only strings
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function TableSkeleton() {
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
        SP-API Orders — Last 10 Days
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

// ── Shared cell styles ────────────────────────────────────────────────────────

const cellBase: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-small)',
  color: 'var(--color-text-primary)',
  fontVariantNumeric: 'tabular-nums',
  padding: '10px 0',
  borderBottom: '1px solid var(--color-border)',
  verticalAlign: 'top',
}

const cellRight: React.CSSProperties = {
  ...cellBase,
  textAlign: 'right',
  paddingLeft: 16,
}

const pendingSubline: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  color: 'var(--color-text-disabled)',
  marginTop: 3,
}

// ── Main exported component ───────────────────────────────────────────────────

export function RecentDaysTable() {
  const [data, setData] = useState<RecentDaysResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [devMode] = useDevMode()

  useEffect(() => {
    fetch('/api/business-review/recent-days')
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<RecentDaysResponse>
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
    return <TableSkeleton />
  }

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
      {/* Panel heading — source attribution required by acceptance criterion */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
          SP-API Orders — Last 10 Days
        </span>
        {data && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            Last updated: {minutesAgo(data.fetchedAt)}
          </span>
        )}
      </div>

      {/* Hard error state — SP-API completely unreachable, no data at all */}
      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Orders data unavailable — SP-API unreachable. Refresh in a few minutes.
        </div>
      )}

      {/* Partial data banner — some orders rate-limited but cached data is shown */}
      {data?.partialData && data.partialData.failedOrders > 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Partial data — {data.partialData.failedOrders} of {data.partialData.totalOrders} orders
          rate-limited. Revenue may be understated. Refresh in a few minutes.
        </div>
      )}

      {/* Debug section */}
      {devMode && data && (
        <DebugSection heading="Debug — Recent Days Table">
          <pre
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-nano)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        </DebugSection>
      )}

      {/* Table */}
      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
            }}
          >
            <thead>
              <tr>
                {(
                  [
                    { label: 'Date', align: 'left' },
                    { label: 'Orders', align: 'right' },
                    { label: 'Revenue (CAD)', align: 'right' },
                    { label: 'Units', align: 'right' },
                    { label: 'Fees (Sprint 5)', align: 'right' },
                    { label: 'Net (Sprint 5)', align: 'right' },
                  ] as const
                ).map((col) => (
                  <th
                    key={col.label}
                    style={{
                      textAlign: col.align,
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                      paddingBottom: 8,
                      paddingLeft: col.align === 'right' ? 16 : 0,
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.date}>
                  {/* Date */}
                  <td style={cellBase}>{formatDate(row.date)}</td>

                  {/* Orders — confirmed count (Constraint C-7: 0 not blank) */}
                  <td style={cellRight}>{row.orders}</td>

                  {/* Revenue (CAD) — confirmed pre-tax primary; pending sub-line when > 0 */}
                  <td style={cellRight}>
                    <div>${row.revenueCad.toFixed(2)}</div>
                    {row.pendingRevenueCad > 0 && (
                      <div style={pendingSubline}>
                        + ${row.pendingRevenueCad.toFixed(2)} pending
                      </div>
                    )}
                  </td>

                  {/* Units — confirmed primary; pending sub-line when > 0 */}
                  <td style={cellRight}>
                    <div>{row.units}</div>
                    {row.pendingUnits > 0 && (
                      <div style={pendingSubline}>+ {row.pendingUnits} pending</div>
                    )}
                  </td>

                  {/* Fees (Sprint 5) — placeholder dash. No formula. (Constraint C-8) */}
                  <td
                    style={{
                      ...cellRight,
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    —
                  </td>

                  {/* Net (Sprint 5) — placeholder dash. No formula. (Constraint C-8) */}
                  <td
                    style={{
                      ...cellRight,
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    —
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
