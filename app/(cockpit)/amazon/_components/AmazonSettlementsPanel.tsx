'use client'

import type { SettlementRow } from '@/lib/amazon/reports'

// ── Format date range ─────────────────────────────────────────────────────────

function formatDateShort(isoTs: string | null): string {
  if (!isoTs) return '—'
  return new Date(isoTs).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AmazonSettlementsPanel({ data }: { data: SettlementRow[] }) {
  // Show last 5 settlements (most recent first)
  const recent = [...data]
    .sort((a, b) => {
      const aEnd = a.period_end_at ?? ''
      const bEnd = b.period_end_at ?? ''
      return bEnd.localeCompare(aEnd)
    })
    .slice(0, 5)

  const cellBase: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    fontVariantNumeric: 'tabular-nums',
    padding: '10px 0',
    borderBottom: '1px solid var(--color-border)',
    verticalAlign: 'top',
  }

  const cellRight: React.CSSProperties = {
    ...cellBase,
    textAlign: 'right',
    paddingLeft: 16,
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
      <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
        Recent Settlements
      </span>

      {recent.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No settlements synced yet. First sync runs daily at 06:00 UTC.
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
                    { label: 'Period', align: 'left' },
                    { label: 'Gross', align: 'right' },
                    { label: 'Fees', align: 'right' },
                    { label: 'Net Payout', align: 'right' },
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
              {recent.map((row) => {
                // Fees = gross - net when both present, else null (deferred per migration note)
                const fees =
                  row.fees_total !== null
                    ? row.fees_total
                    : row.gross !== null && row.net_payout !== null
                      ? Math.round((row.gross - row.net_payout) * 100) / 100
                      : null

                return (
                  <tr key={row.id}>
                    <td style={cellBase}>
                      {formatDateShort(row.period_start_at)}–{formatDateShort(row.period_end_at)}
                    </td>
                    <td style={cellRight}>
                      {row.gross !== null ? `$${row.gross.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...cellRight, color: 'var(--color-text-disabled)' }}>
                      {fees !== null ? `$${fees.toFixed(2)}` : '—'}
                    </td>
                    <td style={cellRight}>
                      {row.net_payout !== null ? `$${row.net_payout.toFixed(2)}` : '—'}
                    </td>
                    <td
                      style={{
                        ...cellRight,
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {row.fund_transfer_status ?? '—'}
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
