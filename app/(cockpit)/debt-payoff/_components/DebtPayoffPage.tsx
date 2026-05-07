'use client'

import { useEffect, useState } from 'react'
import type { DebtPayoffResponse } from '@/app/api/debt-payoff/route'

const fmt = (n: number) =>
  n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

export function DebtPayoffPage() {
  const [data, setData] = useState<DebtPayoffResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch('/api/debt-payoff')
      .then((r) => r.json())
      .then((d: DebtPayoffResponse & { error?: string }) => {
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
        maxWidth: 980,
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
        Debt Payoff
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          margin: '6px 0 24px',
        }}
      >
        Active loans and credit balances. Tax obligations excluded — see /balance-sheet for those.
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
            <Kpi label="Total Debt" value={fmt(data.totalDebt)} color="#e5534b" />
            <Kpi
              label="Est. Monthly Payment"
              value={data.totalMonthlyPayment > 0 ? fmt(data.totalMonthlyPayment) : '—'}
              color="var(--color-accent-gold)"
            />
            <Kpi
              label="Longest Payoff"
              value={data.longestPayoffMonths != null ? `${data.longestPayoffMonths} months` : '—'}
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
                  {['Debt', 'Balance', 'Est. Monthly', 'Months Left', 'Payoff Date'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '9px 14px',
                        textAlign: i === 0 ? 'left' : 'right',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.debts.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: 20,
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      No active debts. 🎉
                    </td>
                  </tr>
                )}
                {data.debts.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '9px 14px', fontSize: 'var(--text-small)' }}>
                      <div style={{ color: 'var(--color-text-primary)' }}>{d.name}</div>
                      <div
                        style={{
                          fontSize: 'var(--text-nano)',
                          color: 'var(--color-text-disabled)',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          marginTop: 2,
                        }}
                      >
                        {d.category.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={numCell('var(--color-text-primary)')}>{fmt(d.balance)}</td>
                    <td style={numCell()}>
                      {d.monthlyPaymentEstimate ? fmt(d.monthlyPaymentEstimate) : '—'}
                    </td>
                    <td style={numCell()}>{d.monthsToPayoff ?? '—'}</td>
                    <td style={numCell()}>{d.payoffDateEstimate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p
            style={{
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginTop: 14,
              lineHeight: 1.6,
            }}
          >
            Monthly payment estimates derived from QuickBooks journal entries (debit transactions on
            the liability account, last 3 months). Months remaining = balance ÷ estimated monthly
            payment, simple linear projection (no interest modeling).
          </p>
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
        minWidth: 160,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.4rem',
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
    padding: '9px 14px',
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color,
    fontVariantNumeric: 'tabular-nums',
  }
}
