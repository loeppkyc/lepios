'use client'

import { useEffect, useState } from 'react'
import type { SubscriptionsResponse } from '@/app/api/subscriptions/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

export function SubscriptionsPage() {
  const [data, setData] = useState<SubscriptionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/subscriptions')
      .then((r) => r.json())
      .then((d: SubscriptionsResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        padding: '28px 32px',
        maxWidth: 1080,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display, var(--font-ui))',
          fontSize: '1.15rem',
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: 'var(--color-text-primary)',
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        Subscriptions
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        Recurring software, services, insurance, and storage. Auto-detected from business expenses.
        Stale = no charge in 35+ days.
      </p>

      {loading && (
        <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </div>
      )}
      {error && <div style={{ color: '#e5534b', fontSize: 'var(--text-small)' }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <Kpi label="Active Monthly" value={fmt(data.totalMonthlyEstimate)} />
            <Kpi label="Annual Run-Rate" value={fmt(data.totalAnnualEstimate)} />
            <Kpi label="YTD Spent" value={fmt(data.ytdTotal)} />
            <Kpi
              label="Stale (cancel?)"
              value={String(data.staleCount)}
              color={data.staleCount > 0 ? '#FF9800' : 'var(--color-text-muted)'}
            />
          </div>

          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {[
                    'Vendor',
                    'Category',
                    'Hits',
                    'Monthly Est.',
                    'YTD',
                    'Last Charge',
                    'Status',
                  ].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '9px 12px',
                        textAlign: i >= 2 && i <= 4 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.subscriptions.map((s, i) => (
                  <tr
                    key={`${s.vendor}-${s.category}-${i}`}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      opacity: s.status === 'stale' ? 0.55 : 1,
                    }}
                  >
                    <td
                      style={{
                        padding: '9px 12px',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {s.vendor}
                    </td>
                    <td
                      style={{
                        padding: '9px 12px',
                        fontSize: '0.7rem',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {s.category}
                    </td>
                    <td style={numCell()}>{s.hits}</td>
                    <td style={numCell('var(--color-text-primary)')}>{fmt(s.monthlyEstimate)}</td>
                    <td style={numCell()}>{fmt(s.ytdTotal)}</td>
                    <td
                      style={{
                        padding: '9px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {s.lastChargeDate}
                    </td>
                    <td
                      style={{
                        padding: '9px 12px',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: s.status === 'stale' ? '#FF9800' : 'var(--color-pillar-health)',
                      }}
                    >
                      {s.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        minWidth: 150,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.3rem',
          fontWeight: 700,
          color: color ?? 'var(--color-accent-gold)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function numCell(color = 'var(--color-text-muted)'): React.CSSProperties {
  return {
    padding: '9px 12px',
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color,
    fontVariantNumeric: 'tabular-nums',
  }
}
