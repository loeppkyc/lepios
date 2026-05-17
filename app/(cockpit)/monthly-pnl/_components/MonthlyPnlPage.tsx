'use client'

import { useEffect, useState } from 'react'

// Inline types — avoids server-only module leak per F11
interface MonthlyPnlRow {
  month: string
  revenue: number
  units: number
  orders: number
  amazonFees: number
  estPayout: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
  marginPct: number | null
  sessions: number
}

interface GoalRow {
  month: string
  salesGoal: number
  actualSales: number
  buyGoal: number
  actualBought: number
  estProfit: number
  actualProfit: number
}

type SettlementByMonth = Record<string, number>

interface MonthlyPnlResponse {
  months: MonthlyPnlRow[]
  totals: MonthlyPnlRow
  comparison2025: MonthlyPnlRow | null
  goals: GoalRow[]
  settlementRevenueByMonth: SettlementByMonth
}

const CURRENT_MONTH = new Date().toLocaleString('en-CA', { month: 'long' })

// Map month label (e.g. "January 2026") → YYYY-MM key for settlement lookup
function monthLabelToKey(label: string): string {
  const months: Record<string, string> = {
    January: '01',
    February: '02',
    March: '03',
    April: '04',
    May: '05',
    June: '06',
    July: '07',
    August: '08',
    September: '09',
    October: '10',
    November: '11',
    December: '12',
  }
  for (const [name, num] of Object.entries(months)) {
    if (label.startsWith(name)) {
      const yearMatch = label.match(/\b(20\d\d)\b/)
      const year = yearMatch ? yearMatch[1] : '2026'
      return `${year}-${num}`
    }
  }
  return ''
}

function fmt(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1000) {
    return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  }
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function pctColor(n: number | null) {
  if (n === null) return 'var(--color-text-disabled)'
  if (n > 5) return 'var(--color-pillar-health)'
  if (n > 0) return 'var(--color-accent-gold)'
  return '#e5534b'
}

function profitColor(n: number) {
  if (n > 0) return 'var(--color-pillar-health)'
  if (n < 0) return '#e5534b'
  return 'var(--color-text-disabled)'
}

const s = {
  page: { padding: '28px 32px', maxWidth: 1200, margin: '0 auto' } as React.CSSProperties,
  heading: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-pillar-money)',
  },
  card: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '20px 24px',
    marginBottom: 20,
  } as React.CSSProperties,
  sectionLabel: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)',
    marginBottom: 14,
  },
  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  },
  thLeft: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left' as const,
  },
  td: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '7px 10px 7px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right' as const,
  },
  tdLabel: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)',
    padding: '7px 10px 7px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left' as const,
  },
  tdSub: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    color: 'var(--color-text-disabled)',
    padding: '3px 10px 3px 16px',
    textAlign: 'left' as const,
  },
}

function PnlRow({
  row,
  isTotals,
  isMuted,
  settlementRevenue,
}: {
  row: MonthlyPnlRow
  isTotals?: boolean
  isMuted?: boolean
  settlementRevenue?: number
}) {
  const isCurrent = row.month.startsWith(CURRENT_MONTH)
  const hasData = row.revenue > 0 || row.units > 0
  const showSettlement = settlementRevenue !== undefined && settlementRevenue > 0

  return (
    <>
      <tr
        style={{
          opacity: !hasData && !isTotals && !isMuted ? 0.3 : 1,
          background: isCurrent
            ? 'color-mix(in srgb, var(--color-pillar-money) 5%, transparent)'
            : isTotals
              ? 'color-mix(in srgb, var(--color-border) 30%, transparent)'
              : isMuted
                ? 'color-mix(in srgb, var(--color-border) 20%, transparent)'
                : undefined,
        }}
      >
        <td
          style={{
            ...s.tdLabel,
            fontWeight: isTotals || isMuted ? 700 : 400,
            color: isTotals || isMuted ? 'var(--color-text-primary)' : s.tdLabel.color,
          }}
        >
          {row.month}
        </td>
        <td style={s.td}>{fmt(row.revenue, true)}</td>
        <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>{row.units.toLocaleString()}</td>
        <td style={{ ...s.td, color: '#e5534b' }}>{fmt(row.amazonFees, true)}</td>
        <td style={{ ...s.td, color: '#e5534b' }}>{fmt(row.cogs, true)}</td>
        <td style={{ ...s.td, color: profitColor(row.grossProfit) }}>
          {fmt(row.grossProfit, true)}
        </td>
        <td style={{ ...s.td, color: '#e5534b' }}>
          {row.expenses > 0 ? fmt(row.expenses, true) : '—'}
        </td>
        <td style={{ ...s.td, fontWeight: 700, color: profitColor(row.netProfit) }}>
          {fmt(row.netProfit, true)}
        </td>
        <td style={{ ...s.td, color: pctColor(row.marginPct) }}>
          {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : '—'}
        </td>
        <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
          {row.sessions > 0 ? row.sessions.toLocaleString() : '—'}
        </td>
      </tr>
      {/* Amazon settlement sub-row — shows gap between JE and settlement */}
      {showSettlement && (
        <tr style={{ opacity: 0.7 }}>
          <td style={{ ...s.tdSub, paddingLeft: 20 }}>
            ↳ Settlement: {fmt(settlementRevenue!, true)}
            {Math.abs(row.revenue - settlementRevenue!) > 1 && (
              <span
                style={{
                  color:
                    Math.abs(row.revenue - settlementRevenue!) > 100
                      ? '#e5534b'
                      : 'var(--color-accent-gold)',
                  marginLeft: 6,
                }}
              >
                (gap: {fmt(row.revenue - settlementRevenue!, true)})
              </span>
            )}
          </td>
          <td colSpan={9} />
        </tr>
      )}
    </>
  )
}

function GoalStrip({ goals }: { goals: GoalRow[] }) {
  const currentGoal = goals.find((g) => g.month.startsWith(CURRENT_MONTH))
  if (!currentGoal) return null

  const salesPct =
    currentGoal.salesGoal > 0
      ? Math.min(100, (currentGoal.actualSales / currentGoal.salesGoal) * 100)
      : 0
  const buyPct =
    currentGoal.buyGoal > 0
      ? Math.min(100, (currentGoal.actualBought / currentGoal.buyGoal) * 100)
      : 0

  return (
    <div style={s.card}>
      <div style={s.sectionLabel}>{CURRENT_MONTH} Goals vs Actuals</div>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {[
          {
            label: 'Sales',
            goal: currentGoal.salesGoal,
            actual: currentGoal.actualSales,
            pct: salesPct,
          },
          {
            label: 'Buying Budget',
            goal: currentGoal.buyGoal,
            actual: currentGoal.actualBought,
            pct: buyPct,
          },
          {
            label: 'Est. Profit Target',
            goal: currentGoal.estProfit,
            actual: currentGoal.actualProfit,
            pct:
              currentGoal.estProfit > 0
                ? Math.min(100, (currentGoal.actualProfit / currentGoal.estProfit) * 100)
                : 0,
          },
        ].map(({ label, goal, actual, pct }) => (
          <div key={label} style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {fmt(actual)} / {fmt(goal)}
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: 'var(--color-surface-2)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background:
                    pct >= 100
                      ? 'var(--color-pillar-health)'
                      : pct >= 50
                        ? 'var(--color-accent-gold)'
                        : '#e5534b',
                  borderRadius: 3,
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                marginTop: 3,
              }}
            >
              {pct.toFixed(0)}% of goal
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MonthlyPnlPage() {
  const [data, setData] = useState<MonthlyPnlResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/monthly-pnl')
      .then((r) => r.json())
      .then((d: MonthlyPnlResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  const activeMonths = data?.months.filter((m) => m.revenue > 0 || m.units > 0) ?? []
  const ytd = data?.totals
  const settlements = data?.settlementRevenueByMonth ?? {}

  return (
    <div style={s.page}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <span style={s.heading}>Monthly P&L — 2026</span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Source: Sellerboard via Google Sheets · Amazon settlements from SP-API
        </span>
      </div>

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </div>
      )}
      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* YTD KPIs */}
          {ytd && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'YTD Revenue', value: ytd.revenue, color: 'var(--color-accent-gold)' },
                { label: 'Est Payout', value: ytd.estPayout, color: 'var(--color-pillar-money)' },
                { label: 'COGS', value: ytd.cogs, color: '#e5534b' },
                {
                  label: 'Gross Profit',
                  value: ytd.grossProfit,
                  color: profitColor(ytd.grossProfit),
                },
                { label: 'Net Profit', value: ytd.netProfit, color: profitColor(ytd.netProfit) },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ ...s.card, flex: 1, minWidth: 130, marginBottom: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      color,
                    }}
                  >
                    {fmt(value, true)}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
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
              ))}
            </div>
          )}

          {/* Current month goals */}
          <GoalStrip goals={data.goals} />

          {/* Monthly table — Chunk A: YTD column built from totals row; 2025 row in tfoot */}
          <div style={s.card}>
            <div style={s.sectionLabel}>
              Month-by-Month — 2026 (Sellerboard) · Settlement sub-rows from SP-API
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[
                      'Month',
                      'Revenue',
                      'Units',
                      'Amz Fees',
                      'COGS',
                      'Gross Profit',
                      'Expenses',
                      'Net Profit',
                      'Margin',
                      'Sessions',
                    ].map((h, i) => (
                      <th key={h} style={i === 0 ? s.thLeft : s.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((row) => {
                    const monthKey = monthLabelToKey(row.month)
                    const settlementRevenue = monthKey ? settlements[monthKey] : undefined
                    return (
                      <PnlRow key={row.month} row={row} settlementRevenue={settlementRevenue} />
                    )
                  })}
                </tbody>
                <tfoot>
                  {/* YTD 2026 totals row */}
                  {ytd && <PnlRow row={{ ...ytd, month: 'YTD 2026' }} isTotals />}
                  {/* 2025 Full Year row */}
                  {data.comparison2025 && (
                    <PnlRow row={{ ...data.comparison2025, month: '2025 Full Year' }} isMuted />
                  )}
                </tfoot>
              </table>
            </div>
          </div>

          {activeMonths.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-disabled)',
              }}
            >
              No Sellerboard data yet — paste daily rows into the 📊 Amazon 2026 sheet to populate
              this view.
            </div>
          )}
        </>
      )}
    </div>
  )
}
