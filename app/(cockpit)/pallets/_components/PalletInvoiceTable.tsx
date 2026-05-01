import type { PalletInvoice } from '@/lib/pallets/types'

interface Props {
  invoices: PalletInvoice[]
  last12Total: number
}

const thStyle: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  textAlign: 'left',
  padding: '6px 12px',
  borderBottom: '1px solid var(--color-border)',
}

const tdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-small)',
  color: 'var(--color-text-secondary)',
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border-subtle)',
}

export function PalletInvoiceTable({ invoices, last12Total }: Props) {
  return (
    <div>
      {/* Total spend tile */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          padding: '16px 24px',
          marginBottom: 24,
          display: 'inline-block',
          minWidth: 200,
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
            display: 'block',
            marginBottom: 4,
          }}
        >
          Last 12 months pallet spend
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-heading)',
            fontWeight: 700,
            color: 'var(--color-pillar-money)',
          }}
        >
          ${last12Total.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Invoices table */}
      {invoices.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          No pallet invoices yet.
        </p>
      ) : (
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
              padding: '12px 16px 8px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
              }}
            >
              Recent Invoices
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Month</th>
                  <th style={thStyle}>Vendor</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Pallets</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total incl GST</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>GST</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={tdStyle}>{inv.invoice_month.slice(0, 7)}</td>
                    <td style={tdStyle}>{inv.vendor}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{inv.pallets_count}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-primary)' }}>
                      ${Number(inv.total_cost_incl_gst).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      ${Number(inv.gst_amount).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-disabled)' }}>
                      {inv.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
