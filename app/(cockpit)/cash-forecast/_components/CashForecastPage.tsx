'use client'

import { useEffect, useState } from 'react'
import type { CashForecastResponse } from '@/app/api/cash-forecast/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

export function CashForecastPage() {
  const [data, setData] = useState<CashForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/cash-forecast')
      .then((r) => r.json())
      .then((d: CashForecastResponse & { error?: string }) => {
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
        Cash Forecast
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        30 / 60 / 90-day projection of cash + net worth using last 3 months of inflow and outflow.
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
            <Kpi
              label="Current Cash"
              value={fmt(data.currentCash)}
              color="var(--color-accent-gold)"
            />
            <Kpi
              label="Current Net Worth"
              value={fmt(data.currentNetWorth)}
              color="var(--color-pillar-health)"
            />
            <Kpi
              label="Monthly Net Cash Flow"
              value={(data.monthlyNetCashFlow >= 0 ? '+' : '') + fmt(data.monthlyNetCashFlow)}
              color={data.monthlyNetCashFlow >= 0 ? 'var(--color-pillar-health)' : '#e5534b'}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            <FlowCard label="Monthly Inflow Estimate" value={fmt(data.monthlyInflowEstimate)} />
            <FlowCard
              label="Monthly Outflow Estimate"
              value={fmt(data.monthlyOutflowEstimate)}
              negative
            />
          </div>

          {/* Forecast table */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
              }}
            >
              Forecast Trajectory
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Days Out', 'Date', 'Projected Cash', 'Projected Net Worth'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '9px 14px',
                        textAlign: i >= 2 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.forecast.map((p) => (
                  <tr key={p.daysOut} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td
                      style={{
                        padding: '9px 14px',
                        fontSize: 'var(--text-small)',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {p.daysOut === 0 ? 'Today' : `+${p.daysOut} days`}
                    </td>
                    <td
                      style={{
                        padding: '9px 14px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {p.date}
                    </td>
                    <td
                      style={{
                        padding: '9px 14px',
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-small)',
                        color: p.projectedCash >= 0 ? 'var(--color-accent-gold)' : '#e5534b',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmt(p.projectedCash)}
                    </td>
                    <td
                      style={{
                        padding: '9px 14px',
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-small)',
                        color: p.projectedNetWorth >= 0 ? 'var(--color-pillar-health)' : '#e5534b',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmt(p.projectedNetWorth)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.notes.length > 0 && (
            <div
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-muted)',
                lineHeight: 1.7,
              }}
            >
              {data.notes.map((n, i) => (
                <div key={i}>• {n}</div>
              ))}
            </div>
          )}
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
        minWidth: 180,
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

function FlowCard({
  label,
  value,
  negative,
}: {
  label: string
  value: string
  negative?: boolean
}) {
  return (
    <div
      style={{
        flex: '1 1 240px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.4rem',
          fontWeight: 700,
          color: negative ? '#e5534b' : 'var(--color-pillar-health)',
        }}
      >
        {negative ? '−' : '+'}
        {value}
      </div>
    </div>
  )
}
