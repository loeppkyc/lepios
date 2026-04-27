'use client'

import type { TopSellerRow } from '@/lib/amazon/reports'

// ── Main export ───────────────────────────────────────────────────────────────

export function AmazonTopSellersTable({ data }: { data: TopSellerRow[] }) {
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
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        Top Sellers — Last 30 Days
      </span>

      {data.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No order data yet. Top sellers will appear after the first sync.
        </div>
      ) : (
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
                    { label: '#', align: 'left' },
                    { label: 'ASIN', align: 'left' },
                    { label: 'Title', align: 'left' },
                    { label: 'Units', align: 'right' },
                    { label: 'Revenue (CAD)', align: 'right' },
                    { label: 'Status', align: 'right' },
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
              {data.map((row, i) => (
                <tr key={row.asin}>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-disabled)',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                    }}
                  >
                    {i + 1}
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                    }}
                  >
                    {row.asin}
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      padding: '10px 0',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.title}
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '10px 0',
                      paddingLeft: 16,
                      textAlign: 'right',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                    }}
                  >
                    {row.units}
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                      padding: '10px 0',
                      paddingLeft: 16,
                      textAlign: 'right',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                    }}
                  >
                    ${row.revenue.toFixed(2)}
                  </td>
                  <td
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      padding: '10px 0',
                      paddingLeft: 16,
                      textAlign: 'right',
                      borderBottom: '1px solid var(--color-border)',
                      verticalAlign: 'top',
                    }}
                  >
                    {row.status}
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
