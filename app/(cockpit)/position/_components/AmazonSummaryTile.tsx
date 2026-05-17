'use client'

import { useEffect, useState } from 'react'
import type { PayoutsResponse } from '@/app/api/payouts/route'

function fmt(n: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function AmazonSummaryTile() {
  const [data, setData] = useState<PayoutsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/payouts')
      .then((r) => r.json())
      .then((d: PayoutsResponse & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const panelStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '20px 24px',
  }

  if (loading) return <div style={{ ...panelStyle, minHeight: 100 }} />

  if (error) {
    return (
      <div
        style={{
          ...panelStyle,
          color: 'var(--color-critical)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
        }}
      >
        Amazon: {error}
      </div>
    )
  }

  if (!data) return null

  const lastPayout = data.settlements.find(
    (s) => s.fundTransferStatus === 'Succeeded' || s.fundTransferStatus === 'SUCCEEDED'
  )
  const currentMonth = new Date().toISOString().slice(0, 7)
  const thisMonth = data.monthlyRollups.find((r) => r.month === currentMonth)
  const paceColor =
    data.benchmark.status === 'ahead'
      ? 'var(--color-positive)'
      : data.benchmark.status === 'behind'
        ? 'var(--color-critical)'
        : 'var(--color-text-muted)'

  const metricStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--color-text-primary)' as string,
    lineHeight: 1,
  }

  const labelStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-muted)',
    marginBottom: 6,
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-label)',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          marginBottom: 16,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        Amazon Payouts
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div>
          <div style={labelStyle}>YTD Net</div>
          <div style={metricStyle}>{fmt(data.ytd.netPayout)}</div>
        </div>

        <div>
          <div style={labelStyle}>{thisMonth ? thisMonth.label : 'This Month'}</div>
          <div style={metricStyle}>{thisMonth ? fmt(thisMonth.netPayout) : '—'}</div>
        </div>

        <div>
          <div style={labelStyle}>Last Payout</div>
          <div style={metricStyle}>{lastPayout ? fmt(lastPayout.netPayout) : '—'}</div>
          {lastPayout && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
                marginTop: 4,
              }}
            >
              {lastPayout.periodEnd}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: paceColor,
        }}
      >
        {data.benchmark.ytdPacePct}% of annual target ·{' '}
        {data.benchmark.status === 'ahead'
          ? 'ahead of pace'
          : data.benchmark.status === 'behind'
            ? 'behind pace'
            : 'on pace'}
      </div>
    </div>
  )
}
