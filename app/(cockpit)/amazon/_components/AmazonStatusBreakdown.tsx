'use client'

import type { StatusBreakdownRow } from '@/lib/amazon/reports'

// ── Status color map ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Shipped: 'var(--color-positive)',
  Unshipped: 'var(--color-pillar-money)',
  PartiallyShipped: 'var(--color-pillar-money)',
  Canceled: 'var(--color-critical)',
  Pending: 'var(--color-text-disabled)',
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'var(--color-text-disabled)'
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AmazonStatusBreakdown({ data }: { data: StatusBreakdownRow[] }) {
  const total = data.reduce((sum, row) => sum + row.count, 0)

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
        Order Status — Last 30 Days
      </span>

      {data.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No order data yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((row) => {
            const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
            return (
              <div key={row.status}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <span>{row.status}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    {row.count} ({pct}%)
                  </span>
                </div>
                {/* Proportional bar — Tailwind-free, CSS-var only */}
                <div
                  style={{
                    height: 6,
                    backgroundColor: 'var(--color-border)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      backgroundColor: statusColor(row.status),
                      borderRadius: 3,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
