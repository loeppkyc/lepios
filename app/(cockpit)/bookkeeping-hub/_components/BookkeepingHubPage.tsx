'use client'

import { useEffect, useState, Fragment } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthRow {
  month: string // 'YYYY-MM'
  count: number
  totalPretax: number
  totalTax: number
  businessPortion: number
  missingReceipts: number
}

interface CategoryRow {
  category: string
  count: number
  totalPretax: number
  totalTax: number
  businessPortion: number
}

interface MissingExpense {
  id: string
  date: string
  vendor: string
  category: string
  pretax: number
  tax_amount: number
  payment_method: string
  notes: string
}

interface Summary {
  year: number
  ytd: { count: number; totalPretax: number; totalTax: number; businessPortion: number }
  months: MonthRow[]
  categories: CategoryRow[]
  missingReceiptExpenses: MissingExpense[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-CA', {
    month: 'short',
    year: 'numeric',
  })
}

function allMonthsForYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
  } as React.CSSProperties,

  sectionTitle: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    marginBottom: 14,
  } as React.CSSProperties,

  metricLabel: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    color: 'var(--color-text-disabled)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 3,
  } as React.CSSProperties,

  metricValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.3rem',
    fontWeight: 700,
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,

  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
  } as React.CSSProperties,

  thRight: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,

  td: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)',
    padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,

  tdMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '8px 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,

  tdMonoMuted: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-muted)',
    padding: '8px 0 8px 10px',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,

  select: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    outline: 'none',
  } as React.CSSProperties,

  btnSecondary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    padding: '7px 16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BookkeepingHubPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showAllMissing, setShowAllMissing] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/bookkeeping/summary?year=${year}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as Summary
        if (!cancelled) setSummary(data)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [year])

  function handleExport() {
    window.open(`/api/bookkeeping/export?year=${year}`, '_blank')
  }

  const allMonths = allMonthsForYear(year)
  const monthIndex = new Map(summary?.months.map((m) => [m.month, m]) ?? [])

  const missing = summary?.missingReceiptExpenses ?? []
  const visibleMissing = showAllMissing ? missing : missing.slice(0, 8)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
      {/* ── Header ── */}
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
          Bookkeeping Hub
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={s.select}>
            {[currentYear - 1, currentYear].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button onClick={handleExport} style={s.btnSecondary}>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── States ── */}
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
      {fetchError && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          Error: {fetchError}
        </div>
      )}

      {!loading && !fetchError && summary && (
        <>
          {/* ── YTD Summary Cards ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              { label: 'Expenses', value: String(summary.ytd.count) },
              { label: 'Pre-Tax Total', value: `$${fmt(summary.ytd.totalPretax)}` },
              { label: 'GST Paid (ITCs)', value: `$${fmt(summary.ytd.totalTax)}` },
              { label: 'Business Portion', value: `$${fmt(summary.ytd.businessPortion)}` },
            ].map(({ label, value }) => (
              <div key={label} style={s.card}>
                <div style={s.metricLabel}>{label}</div>
                <div style={s.metricValue}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── GST Snapshot ── */}
          <div style={{ ...s.card, marginBottom: 16 }}>
            <div style={s.sectionTitle}>GST / Input Tax Credits</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
              <div>
                <div style={s.metricLabel}>ITCs Paid on Expenses</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--color-pillar-money)',
                  }}
                >
                  ${fmt(summary.ytd.totalTax)}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                    marginTop: 3,
                  }}
                >
                  Claimable against CRA
                </div>
              </div>
              <div>
                <div style={s.metricLabel}>Amazon GST Collected</div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                    paddingTop: 4,
                  }}
                >
                  Remitted by Amazon
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                    marginTop: 3,
                  }}
                >
                  Marketplace facilitator — not your obligation
                </div>
              </div>
              <div>
                <div style={s.metricLabel}>Net Position</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--color-positive, #4caf50)',
                  }}
                >
                  +${fmt(summary.ytd.totalTax)}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                    marginTop: 3,
                  }}
                >
                  ITCs claimable — refund expected
                </div>
              </div>
            </div>
          </div>

          {/* ── Month-by-Month Table ── */}
          <div style={{ ...s.card, marginBottom: 16 }}>
            <div style={s.sectionTitle}>Month-by-Month — {year}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>Month</th>
                  <th style={{ ...s.thRight, textAlign: 'right' }}># Exp</th>
                  <th style={{ ...s.thRight, textAlign: 'right' }}>Pre-Tax</th>
                  <th style={{ ...s.thRight, textAlign: 'right' }}>GST Paid</th>
                  <th style={{ ...s.thRight, textAlign: 'right' }}>Business</th>
                  <th style={{ ...s.thRight, textAlign: 'right' }}>Missing Receipts</th>
                </tr>
              </thead>
              <tbody>
                {allMonths.map((mo) => {
                  const row = monthIndex.get(mo)
                  const isEmpty = !row
                  return (
                    <tr key={mo}>
                      <td style={s.td}>{monthLabel(mo)}</td>
                      <td style={s.tdMonoMuted}>{isEmpty ? '—' : row.count}</td>
                      <td style={isEmpty ? s.tdMonoMuted : s.tdMono}>
                        {isEmpty ? '—' : `$${fmt(row.totalPretax)}`}
                      </td>
                      <td style={s.tdMonoMuted}>{isEmpty ? '—' : `$${fmt(row.totalTax)}`}</td>
                      <td style={isEmpty ? s.tdMonoMuted : s.tdMono}>
                        {isEmpty ? '—' : `$${fmt(row.businessPortion)}`}
                      </td>
                      <td
                        style={{
                          ...s.tdMonoMuted,
                          color:
                            !isEmpty && row.missingReceipts > 0
                              ? 'var(--color-critical)'
                              : undefined,
                          fontWeight: !isEmpty && row.missingReceipts > 0 ? 700 : undefined,
                        }}
                      >
                        {isEmpty ? '—' : row.missingReceipts > 0 ? row.missingReceipts : '✓'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {summary.ytd.count > 0 && (
                <tfoot>
                  <tr>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      YTD Total
                    </td>
                    <td style={{ ...s.tdMonoMuted, fontWeight: 700 }}>{summary.ytd.count}</td>
                    <td style={{ ...s.tdMono, fontWeight: 700 }}>
                      ${fmt(summary.ytd.totalPretax)}
                    </td>
                    <td style={{ ...s.tdMonoMuted, fontWeight: 700 }}>
                      ${fmt(summary.ytd.totalTax)}
                    </td>
                    <td style={{ ...s.tdMono, fontWeight: 700 }}>
                      ${fmt(summary.ytd.businessPortion)}
                    </td>
                    <td style={{ ...s.tdMonoMuted, fontWeight: 700 }}>
                      {missing.length > 0 ? missing.length : '✓'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            {summary.ytd.count === 0 && (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                  marginTop: 12,
                }}
              >
                No expenses logged for {year} yet.
              </div>
            )}
          </div>

          {/* ── Category Breakdown ── */}
          {summary.categories.length > 0 && (
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={s.sectionTitle}>Expenses by Category — {year} YTD</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Category</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}># Exp</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}>Pre-Tax</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}>GST Paid</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}>Business Portion</th>
                    <th style={{ ...s.thRight, textAlign: 'right' }}>% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.categories.map((cat) => (
                    <tr key={cat.category}>
                      <td style={s.td}>{cat.category}</td>
                      <td style={s.tdMonoMuted}>{cat.count}</td>
                      <td style={s.tdMono}>${fmt(cat.totalPretax)}</td>
                      <td style={s.tdMonoMuted}>${fmt(cat.totalTax)}</td>
                      <td style={s.tdMono}>${fmt(cat.businessPortion)}</td>
                      <td style={s.tdMonoMuted}>
                        {summary.ytd.totalPretax > 0
                          ? `${((cat.totalPretax / summary.ytd.totalPretax) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Missing Receipts ── */}
          <div style={s.card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <div style={s.sectionTitle}>
                Missing Receipts
                {missing.length > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--color-critical)', fontWeight: 700 }}>
                    ({missing.length})
                  </span>
                )}
              </div>
            </div>

            {missing.length === 0 ? (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-positive, #4caf50)',
                }}
              >
                All expenses have receipts in Hubdoc.
              </div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Vendor</th>
                      <th style={s.th}>Category</th>
                      <th style={{ ...s.thRight, textAlign: 'right' }}>Pre-Tax</th>
                      <th style={{ ...s.thRight, textAlign: 'right' }}>GST</th>
                      <th style={s.th}>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMissing.map((e) => (
                      <Fragment key={e.id}>
                        <tr>
                          <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>{e.date}</td>
                          <td style={s.td}>{e.vendor}</td>
                          <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
                            {e.category}
                          </td>
                          <td style={s.tdMono}>${fmt(e.pretax)}</td>
                          <td style={s.tdMonoMuted}>${fmt(e.tax_amount)}</td>
                          <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
                            {e.payment_method}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>

                {missing.length > 8 && (
                  <button
                    onClick={() => setShowAllMissing((v) => !v)}
                    style={{ ...s.btnSecondary, marginTop: 10 }}
                  >
                    {showAllMissing ? 'Show fewer' : `Show all ${missing.length}`}
                  </button>
                )}

                <div
                  style={{
                    marginTop: 12,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  Upload receipts via Hubdoc or mark expenses as documented in Monthly Expenses.
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
