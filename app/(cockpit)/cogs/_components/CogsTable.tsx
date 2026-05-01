import type { CogsEntry, CogsPerAsin } from '@/lib/cogs/types'

interface Props {
  entries: CogsEntry[]
  summary: CogsPerAsin[]
}

function fmtCad(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(yyyymmdd: string): string {
  const [year, mon, day] = yyyymmdd.split('-')
  const d = new Date(Number(year), Number(mon) - 1, Number(day))
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const thStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-disabled)',
}

export function CogsTable({ entries, summary }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Recent entries */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            Recent Entries
          </span>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {entries.length} shown · 50 max
          </span>
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)',
            }}
          >
            No entries yet. Add your first COGS entry above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-small)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Date</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>ASIN</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Model</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Vendor</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={e.id}
                    style={{
                      borderBottom:
                        i < entries.length - 1 ? '1px solid var(--color-border-pillar)' : undefined,
                    }}
                  >
                    <td style={{ padding: '10px 16px', color: 'var(--color-text-muted)' }}>
                      {fmtDate(e.purchased_at)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        color: 'var(--color-text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      {e.asin}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--color-text-muted)' }}>
                      {e.pricing_model === 'per_unit' ? 'per unit' : 'pallet'}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtCad(e.unit_cost_cad)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {e.quantity}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--color-text-disabled)' }}>
                      {e.vendor ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-ASIN summary */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            Per-ASIN Summary
          </span>
        </div>

        {summary.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-muted)',
            }}
          >
            No ASINs tracked yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-small)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>ASIN</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Wtd Avg Cost</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Latest Cost</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total Qty</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Entries</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Pallet</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, i) => (
                  <tr
                    key={row.asin}
                    style={{
                      borderBottom:
                        i < summary.length - 1 ? '1px solid var(--color-border-pillar)' : undefined,
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 16px',
                        color: 'var(--color-text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      {row.asin}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtCad(row.weighted_avg_unit_cost)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtCad(row.latest_unit_cost)}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.total_quantity_purchased}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        textAlign: 'right',
                        color: 'var(--color-text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.entry_count}
                    </td>
                    <td
                      style={{
                        padding: '10px 16px',
                        color: row.has_pallet_entries
                          ? 'var(--color-warning)'
                          : 'var(--color-text-disabled)',
                      }}
                    >
                      {row.has_pallet_entries ? 'yes' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
