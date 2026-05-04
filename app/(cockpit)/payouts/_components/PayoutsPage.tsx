'use client'

import { useEffect, useState } from 'react'
import type { PayoutsResponse, MonthRollup, SettlementRow } from '@/app/api/payouts/route'

const CURRENT_YEAR = new Date().getFullYear()

function fmt(n: number) {
  if (n === 0) return '—'
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

function fmtCompact(n: number) {
  if (n === 0) return '—'
  if (Math.abs(n) >= 1000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const s = {
  th: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)', padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)', textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  },
  thLeft: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)', padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)', textAlign: 'left' as const,
  },
  td: {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
    color: 'var(--color-text-muted)', padding: '7px 10px 7px 0',
    borderBottom: '1px solid var(--color-border)', textAlign: 'right' as const,
  },
}

function MonthRow({ row }: { row: MonthRollup }) {
  const hasData = row.settlementCount > 0
  return (
    <tr style={{ opacity: hasData ? 1 : 0.3 }}>
      <td style={{ ...s.td, textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--color-text-secondary)' }}>{row.label}</td>
      <td style={{ ...s.td, color: row.gross > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)' }}>{fmtCompact(row.gross)}</td>
      <td style={{ ...s.td, color: '#e5534b' }}>{row.feesTotal !== 0 ? fmtCompact(row.feesTotal) : '—'}</td>
      <td style={{ ...s.td, color: row.refundsTotal !== 0 ? '#e5534b' : 'var(--color-text-disabled)' }}>{row.refundsTotal !== 0 ? fmtCompact(row.refundsTotal) : '—'}</td>
      <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>{row.reimbursements > 0 ? fmtCompact(row.reimbursements) : '—'}</td>
      <td style={{ ...s.td, fontWeight: 700, color: row.netPayout > 0 ? 'var(--color-pillar-health)' : 'var(--color-text-disabled)' }}>{fmtCompact(row.netPayout)}</td>
      <td style={{ ...s.td, color: 'var(--color-text-disabled)' }}>{hasData ? row.settlementCount : '—'}</td>
    </tr>
  )
}

function SettlementDetail({ settlements }: { settlements: SettlementRow[] }) {
  const [expanded, setExpanded] = useState(false)
  if (settlements.length === 0) return null
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)' }}>
          Settlement Detail — {settlements.length} settlements
        </span>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.6rem', color: 'var(--color-text-disabled)' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Period', 'Gross', 'Amazon Fees', 'Refunds', 'Reimb.', 'Net Payout', 'Status'].map((h, i) => (
                  <th key={h} style={i === 0 ? s.thLeft : s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map(s2 => (
                <tr key={s2.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ ...s.td, textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {s2.periodStart} → {s2.periodEnd}
                  </td>
                  <td style={{ ...s.td, color: 'var(--color-text-primary)' }}>{fmt(s2.gross)}</td>
                  <td style={{ ...s.td, color: '#e5534b' }}>{fmt(s2.feesTotal)}</td>
                  <td style={{ ...s.td, color: s2.refundsTotal !== 0 ? '#e5534b' : 'var(--color-text-disabled)' }}>{s2.refundsTotal !== 0 ? fmt(s2.refundsTotal) : '—'}</td>
                  <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>{s2.reimbursements > 0 ? fmt(s2.reimbursements) : '—'}</td>
                  <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-pillar-health)' }}>{fmt(s2.netPayout)}</td>
                  <td style={{ ...s.td, color: s2.fundTransferStatus === 'SUCCESSFUL' ? 'var(--color-pillar-health)' : 'var(--color-accent-gold)', textAlign: 'left', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)' }}>
                    {s2.fundTransferStatus}
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

export function PayoutsPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<PayoutsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/payouts?year=${year}`)
      .then(r => r.json())
      .then((d: PayoutsResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [year])

  const years = [CURRENT_YEAR, CURRENT_YEAR - 1]

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-pillar-money)' }}>
          Amazon Payouts
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)} style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', padding: '4px 12px',
              background: y === year ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
              color: y === year ? '#000' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', fontWeight: y === year ? 700 : 400,
            }}>{y}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Loading…</div>}
      {error && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: '#e5534b' }}>{error}</div>}

      {data && !loading && (
        <>
          {/* YTD KPI strip */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Gross Revenue', value: data.ytd.gross, color: 'var(--color-accent-gold)' },
              { label: 'Amazon Fees', value: data.ytd.feesTotal, color: '#e5534b' },
              { label: 'Refunds', value: data.ytd.refundsTotal, color: '#e5534b' },
              { label: 'Reimbursements', value: data.ytd.reimbursements, color: 'var(--color-text-muted)' },
              { label: 'Net Payout', value: data.ytd.netPayout, color: 'var(--color-pillar-health)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px 20px', flex: 1, minWidth: 130 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, color }}>{fmtCompact(value)}</div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Fee rate note */}
          {data.ytd.gross > 0 && (
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 20, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
              Effective Amazon fee rate: <strong style={{ color: 'var(--color-text-primary)' }}>{((data.ytd.feesTotal / data.ytd.gross) * 100).toFixed(1)}%</strong> of gross revenue.
              {' '}Net margin after fees: <strong style={{ color: 'var(--color-pillar-health)' }}>{((data.ytd.netPayout / data.ytd.gross) * 100).toFixed(1)}%</strong>.
            </div>
          )}

          {/* Monthly table */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '10px 16px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-ui)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-text-disabled)', textTransform: 'uppercase' }}>
              Monthly Breakdown — {year}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Month', 'Gross Revenue', 'Amazon Fees', 'Refunds', 'Reimb.', 'Net Payout', 'Settlements'].map((h, i) => (
                      <th key={h} style={i === 0 ? s.thLeft : s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.monthlyRollups.map(row => <MonthRow key={row.month} row={row} />)}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'color-mix(in srgb, var(--color-pillar-money) 5%, transparent)' }}>
                    <td style={{ ...s.td, textAlign: 'left', fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--color-text-primary)' }}>YTD Total</td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-accent-gold)' }}>{fmtCompact(data.ytd.gross)}</td>
                    <td style={{ ...s.td, fontWeight: 700, color: '#e5534b' }}>{fmtCompact(data.ytd.feesTotal)}</td>
                    <td style={{ ...s.td, fontWeight: 700, color: '#e5534b' }}>{fmtCompact(data.ytd.refundsTotal)}</td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-text-muted)' }}>{fmtCompact(data.ytd.reimbursements)}</td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-pillar-health)' }}>{fmtCompact(data.ytd.netPayout)}</td>
                    <td style={{ ...s.td, color: 'var(--color-text-disabled)' }}>{data.ytd.settlementCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <SettlementDetail settlements={data.settlements} />
        </>
      )}

      {data && !loading && data.settlements.length === 0 && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          No settlements found for {year}. Run the SP-API backfill to import settlement data.
        </div>
      )}
    </div>
  )
}
