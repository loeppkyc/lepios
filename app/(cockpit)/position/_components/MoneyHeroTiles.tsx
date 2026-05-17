'use client'

import { useEffect, useState } from 'react'

interface HeroData {
  cash: number
  debt: number
  net: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function MoneyHeroTiles() {
  const [data, setData] = useState<HeroData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d: { totalCash: number; totalCardsOwing: number; netWorth: number; error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData({ cash: d.totalCash, debt: d.totalCardsOwing, net: d.netWorth })
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {['Cash', 'Debt', 'Net'].map((label) => (
          <div
            key={label}
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderTop: '3px solid var(--color-border)',
              borderRadius: 8,
              padding: '20px 24px',
              height: 104,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: '16px 24px',
          color: 'var(--color-critical)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
        }}
      >
        {error}
      </div>
    )
  }

  if (!data) return null

  const tiles = [
    {
      label: 'Cash',
      sub: 'in bank accounts',
      value: data.cash,
      accent: 'var(--color-positive)',
      color: 'var(--color-positive)',
    },
    {
      label: 'Debt',
      sub: 'on credit cards',
      value: data.debt,
      accent: 'var(--color-critical)',
      color: 'var(--color-critical)',
    },
    {
      label: 'Net',
      sub: 'cash minus debt',
      value: data.net,
      accent: data.net >= 0 ? 'var(--color-pillar-money)' : 'var(--color-critical)',
      color: data.net >= 0 ? 'var(--color-pillar-money)' : 'var(--color-critical)',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderTop: `3px solid ${t.accent}`,
            borderRadius: 8,
            padding: '20px 24px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {t.label}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 28,
              fontWeight: 700,
              color: t.color,
              letterSpacing: '-0.5px',
              lineHeight: 1,
            }}
          >
            {fmt(t.value)}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              marginTop: 6,
            }}
          >
            {t.sub}
          </div>
        </div>
      ))}
    </div>
  )
}
