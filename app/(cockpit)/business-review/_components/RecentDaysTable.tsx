'use client'

import { useEffect, useState } from 'react'

// Inline types — do NOT import from route files. Route handlers import lib/amazon/client
// which uses Node.js `crypto`. Turbopack traverses the import type graph and leaks
// server-only modules into the client bundle, silently breaking the component. (Constraint C-2)
interface RecentDayRow {
  date: string // ISO date string e.g. "2026-04-22"
  orders: number
  revenueCad: number
  units: number
}

interface RecentDaysResponse {
  rows: RecentDayRow[]
  fetchedAt: string
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

// ── Main exported component ───────────────────────────────────────────────────

export function RecentDaysTable() {
  const [data, setData] = useState<RecentDaysResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

      {/* Error state */}
      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Error: {error}
        </div>
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
                {/* Column headers */}
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
                  {/* Date — "Apr 22" format */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {formatDate(row.date)}
                  </td>

                  {/* Orders — confirmed count (Constraint C-7: 0 not blank) */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                      paddingLeft: 16,
                      padding: '10px 0 10px 16px',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {row.orders}
                  </td>

                  {/* Revenue (CAD) — ItemPrice.Amount, pre-tax (Constraint C-3) */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                      padding: '10px 0 10px 16px',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    ${row.revenueCad.toFixed(2)}
                  </td>

                  {/* Units — NumberOfItemsShipped + NumberOfItemsUnshipped */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                      padding: '10px 0 10px 16px',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {row.units}
                  </td>

                  {/* Fees (Sprint 5) — placeholder dash. No formula. (Constraint C-8) */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-disabled)',
                      textAlign: 'right',
                      padding: '10px 0 10px 16px',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    —
                  </td>

                  {/* Net (Sprint 5) — placeholder dash. No formula. (Constraint C-8) */}
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-disabled)',
                      textAlign: 'right',
                      padding: '10px 0 10px 16px',
                      borderBottom: '1px solid var(--color-border)',
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
