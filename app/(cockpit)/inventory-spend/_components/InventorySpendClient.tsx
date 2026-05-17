'use client'

import { useEffect, useState } from 'react'

// Inline types per F11
interface InventorySpendResponse {
  thisMonth: number
  thisQuarter: number
  ytd: number
  byCategory: Record<string, number>
  periodStart: string
  today: string
}

function fmt(n: number): string {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export function InventorySpendClient() {
  const [data, setData] = useState<InventorySpendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/inventory-spend')
      .then(async (r) => {
        const json = (await r.json()) as InventorySpendResponse & { error?: string }
        if (json.error) setError(json.error)
        else setData(json)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div
        style={{
          padding: '32px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: '32px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: '#e5534b',
        }}
      >
        {error}
      </div>
    )
  }

  const categories = data ? Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]) : []
  const categoryTotal = categories.reduce((s, [, v]) => s + v, 0)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-pillar-money)',
          }}
        >
          Inventory Spend
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Source: Journal entries · COGS &amp; inventory accounts
        </span>
      </div>

      {/* Three stat tiles */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { label: 'This Month', value: data?.thisMonth ?? 0 },
          { label: 'This Quarter', value: data?.thisQuarter ?? 0 },
          { label: 'YTD', value: data?.ytd ?? 0 },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              flex: 1,
              minWidth: 160,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px 24px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.5rem',
                fontWeight: 700,
                color: value > 0 ? 'var(--color-accent-gold)' : 'var(--color-text-disabled)',
              }}
            >
              {fmt(value)}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
                marginTop: 6,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Category breakdown table */}
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            background: 'var(--color-surface-2)',
            borderBottom: '1px solid var(--color-border)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-disabled)',
          }}
        >
          Spend by Category (YTD)
        </div>

        {categories.length === 0 ? (
          <div
            style={{
              padding: '20px',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)',
            }}
          >
            No COGS / inventory journal entries found for this year.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Category', 'Amount', '% of Total'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                      padding: '8px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      textAlign: i === 0 ? 'left' : 'right',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(([cat, amount], i) => {
                const pct = categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0
                return (
                  <tr
                    key={cat}
                    style={{
                      background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <td
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                        padding: '10px 16px',
                      }}
                    >
                      {cat}
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-accent-gold)',
                        padding: '10px 16px',
                        textAlign: 'right',
                        fontWeight: 700,
                      }}
                    >
                      {fmt(amount)}
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-muted)',
                        padding: '10px 16px',
                        textAlign: 'right',
                      }}
                    >
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                <td
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    padding: '10px 16px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Total
                </td>
                <td
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    fontWeight: 700,
                    color: 'var(--color-accent-gold)',
                    padding: '10px 16px',
                    textAlign: 'right',
                  }}
                >
                  {fmt(categoryTotal)}
                </td>
                <td
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                    padding: '10px 16px',
                    textAlign: 'right',
                  }}
                >
                  100%
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Footer note */}
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Categories are estimated from account names and descriptions. Covers accounts matching: Cost
        of Goods, COGS, Inventory, Purchase.
        {data && ` Period: ${data.periodStart} → ${data.today}.`}
      </div>
    </div>
  )
}
