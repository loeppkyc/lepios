'use client'

import { useState, useEffect } from 'react'

interface ScanRow {
  id: string
  isbn: string | null
  asin: string | null
  title: string | null
  buy_box_price_cad: number | null
  profit_cad: number | null
  roi_pct: number | null
  decision: 'buy' | 'skip' | null
  cost_paid_cad: number
  bsr: number | null
  tier: string | null
  recorded_at: string
}

type Filter = 'all' | 'buy' | 'skip'

function formatDate(isoString: string): string {
  const d = new Date(isoString)
  const month = d.toLocaleString('en-CA', { month: 'short' })
  const day = d.getDate()
  const time = d.toLocaleString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${month} ${day} · ${time}`
}

function truncateTitle(title: string | null, max = 40): string {
  if (!title) return '—'
  return title.length > max ? title.slice(0, max) + '…' : title
}

function fmtCad(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return `$${n.toFixed(2)}`
}

function fmtRoi(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return `${n.toFixed(1)}%`
}

const FILTER_BUTTONS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'BUY', value: 'buy' },
  { label: 'SKIP', value: 'skip' },
]

export function ScanHistoryClient() {
  const [rows, setRows] = useState<ScanRow[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/scan/history?decision=${filter}&limit=100`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error ?? 'Failed to load history')
        }
        const data = (await res.json()) as ScanRow[]
        setRows(data)
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filter])

  const rowCount = rows.length

  return (
    <div
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-heading)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Scan History
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              margin: '4px 0 0',
            }}
          >
            {loading ? 'Loading…' : `Last ${rowCount} scan${rowCount === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* Filter buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {FILTER_BUTTONS.map(({ label, value }) => {
            const isActive = filter === value
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 600,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isActive ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                  background: isActive ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
                  color: isActive ? 'var(--color-base)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background var(--transition-fast)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-critical)',
            background: 'var(--color-critical-dim)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
          }}
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-muted)',
            padding: '32px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rowCount === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-muted)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No scans yet — go scan some books!{' '}
          <a
            href="/scan"
            style={{
              color: 'var(--color-accent-gold)',
              textDecoration: 'underline',
              fontWeight: 600,
            }}
          >
            Go to scanner
          </a>
        </div>
      )}

      {/* Table */}
      {!loading && !error && rowCount > 0 && (
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
                {['Date', 'ISBN', 'Title', 'Buy Box', 'Profit', 'ROI', 'Decision'].map((col) => (
                  <th
                    key={col}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                      borderBottom: '1px solid var(--color-border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const profitColor =
                  row.profit_cad !== null
                    ? row.profit_cad >= 3
                      ? 'var(--color-positive)'
                      : 'var(--color-critical)'
                    : 'var(--color-text-muted)'
                const roiColor =
                  row.roi_pct !== null
                    ? row.roi_pct >= 50
                      ? 'var(--color-positive)'
                      : 'var(--color-critical)'
                    : 'var(--color-text-muted)'
                const isBuy = row.decision === 'buy'

                return (
                  <tr
                    key={row.id}
                    style={{
                      background: idx % 2 === 0 ? 'transparent' : 'var(--color-surface-2)',
                    }}
                  >
                    {/* Date */}
                    <td
                      style={{
                        padding: '10px 10px',
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(row.recorded_at)}
                    </td>

                    {/* ISBN */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.isbn ?? '—'}
                    </td>

                    {/* Title */}
                    <td
                      style={{
                        padding: '10px 10px',
                        color: 'var(--color-text-primary)',
                        maxWidth: 280,
                      }}
                      title={row.title ?? undefined}
                    >
                      {truncateTitle(row.title)}
                    </td>

                    {/* Buy Box */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtCad(row.buy_box_price_cad)}
                    </td>

                    {/* Profit */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: profitColor,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtCad(row.profit_cad)}
                    </td>

                    {/* ROI */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: roiColor,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtRoi(row.roi_pct)}
                    </td>

                    {/* Decision badge */}
                    <td style={{ padding: '10px 10px' }}>
                      {row.decision ? (
                        <span
                          style={{
                            display: 'inline-block',
                            fontFamily: 'var(--font-ui)',
                            fontSize: 'var(--text-nano)',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            background: isBuy ? 'var(--color-positive)' : 'var(--color-surface-2)',
                            color: isBuy ? 'var(--color-base)' : 'var(--color-text-muted)',
                            border: isBuy ? 'none' : '1px solid var(--color-border)',
                          }}
                        >
                          {row.decision.toUpperCase()}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-disabled)' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
