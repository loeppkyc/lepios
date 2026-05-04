'use client'

import { useState, useEffect } from 'react'
import type { QuarterReadiness, QuarterStatus } from '@/app/api/tax-centre/summary/route'

interface QuarterSummary {
  q: number
  label: string
  itc: number
  pretax: number
  businessPortion: number
  count: number
}

interface T2125Line {
  line: string
  label: string
  pretax: number
  businessPortion: number
  count: number
}

interface TaxSummary {
  year: number
  quarters: QuarterSummary[]
  ytd: { itc: number; pretax: number; businessPortion: number; count: number }
  t2125: T2125Line[]
  loanRepaymentPretax: number
  zeroGstExpenses: number
  quarterReadiness: QuarterReadiness[]
}

// Years with GST + income tax fully filed per accountant (Rob)
const FILED_YEARS = new Set([2024, 2025])

function fmt(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  return fmt(n)
}

const STATUS_CONFIG: Record<QuarterStatus, { label: string; color: string; border: string; bg: string }> = {
  complete: {
    label: 'Complete',
    color: 'var(--color-pillar-health)',
    border: 'rgba(63, 185, 80, 0.4)',
    bg: 'rgba(63, 185, 80, 0.05)',
  },
  in_progress: {
    label: 'In Progress',
    color: 'var(--color-accent-gold)',
    border: 'rgba(210, 160, 60, 0.4)',
    bg: 'rgba(210, 160, 60, 0.05)',
  },
  needs_attention: {
    label: 'Needs Attention',
    color: '#e5534b',
    border: 'rgba(229, 83, 75, 0.4)',
    bg: 'rgba(229, 83, 75, 0.05)',
  },
  upcoming: {
    label: 'Upcoming',
    color: 'var(--color-text-disabled)',
    border: 'var(--color-border)',
    bg: 'transparent',
  },
}

function ReadinessCard({ q }: { q: QuarterReadiness }) {
  const cfg = STATUS_CONFIG[q.status]
  return (
    <div
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 'var(--radius-sm)',
        padding: '16px',
        opacity: q.status === 'upcoming' ? 0.6 : 1,
      }}
    >
      {/* Quarter header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.06em' }}>
          {q.label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: cfg.color,
          }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Revenue */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
          Amazon Revenue
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: q.revenue > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)' }}>
          {q.revenue > 0 ? fmtCompact(q.revenue) : '—'}
        </div>
        {q.settlementCount > 0 && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
            {q.settlementCount} settlement{q.settlementCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Expenses */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
          Expenses
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
          {q.expenseCount > 0 ? `${q.expenseCount} logged` : '—'}
        </div>
        {q.uncategorizedCount > 0 && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: '#e5534b', fontWeight: 600 }}>
            {q.uncategorizedCount} uncategorized — fix before filing
          </div>
        )}
        {q.expenseCount > 0 && q.uncategorizedCount === 0 && q.hasStarted && (
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-pillar-health)' }}>
            All categorized
          </div>
        )}
      </div>

      {/* Mileage */}
      <div>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
          Mileage
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
          {q.mileageTrips > 0 ? `${q.mileageTrips} trips · ${q.mileageKm.toFixed(0)} km` : '—'}
        </div>
      </div>
    </div>
  )
}

function YearEndChecklist({ readiness, year }: { readiness: QuarterReadiness[]; year: number }) {
  const allExpensesCategorized = readiness.every(
    (q) => !q.hasEnded || q.uncategorizedCount === 0
  )
  const completedQuarters = readiness.filter((q) => q.hasEnded && q.status === 'complete')
  const hasRevenue = readiness.some((q) => q.revenue > 0)
  const hasMileage = readiness.some((q) => q.mileageTrips > 0)
  const totalKm = readiness.reduce((s, q) => s + q.mileageKm, 0)

  const items = [
    {
      label: 'Expenses categorized (all completed quarters)',
      done: allExpensesCategorized,
      detail: allExpensesCategorized
        ? 'No uncategorized expenses'
        : `${readiness.filter((q) => q.hasEnded && q.uncategorizedCount > 0).reduce((s, q) => s + q.uncategorizedCount, 0)} uncategorized — go to Monthly Expenses to fix`,
    },
    {
      label: 'Amazon revenue reconciled',
      done: hasRevenue,
      detail: hasRevenue
        ? `${readiness.reduce((s, q) => s + q.settlementCount, 0)} settlements logged`
        : 'No settlements — run SP-API backfill',
    },
    {
      label: 'Mileage log active',
      done: hasMileage,
      detail: hasMileage ? `${totalKm.toFixed(0)} km logged YTD` : 'No trips logged',
    },
    {
      label: `Completed quarters clean`,
      done: completedQuarters.length > 0,
      detail:
        completedQuarters.length > 0
          ? `${completedQuarters.map((q) => `Q${q.q}`).join(', ')} fully reconciled`
          : 'No quarters complete yet',
    },
  ]

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 28,
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border)',
          fontFamily: 'var(--font-ui)',
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: 'var(--color-text-disabled)',
          textTransform: 'uppercase',
        }}
      >
        Year-End Prep — {year}
      </div>
      <div style={{ padding: '12px 16px' }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                color: item.done ? 'var(--color-pillar-health)' : '#e5534b',
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {item.done ? '✓' : '✗'}
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
                {item.label}
              </div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: item.done ? 'var(--color-text-disabled)' : '#e5534b' }}>
                {item.detail}
              </div>
            </div>
          </div>
        ))}
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--color-border)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Annual GST filing due end of April {year + 1} · T1 income tax (self-employed) due June 15, {year + 1}
        </div>
      </div>
    </div>
  )
}

export function TaxCentrePage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState<TaxSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/tax-centre/summary?year=${year}`)
        if (!res.ok) {
          const j = (await res.json()) as { error?: string }
          throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as TaxSummary
        if (!cancelled) setData(json)
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

  const currentYear = new Date().getFullYear()
  const years = [currentYear, currentYear - 1, currentYear - 2]
  const isFiled = FILED_YEARS.has(year)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontWeight: 900,
            fontSize: '1.4rem',
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            margin: 0,
            textTransform: 'uppercase',
          }}
        >
          Tax Centre
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-small)',
                padding: '4px 12px',
                background: y === year ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
                color: y === year ? '#000' : 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: y === year ? 700 : 400,
              }}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Prior year filed banner */}
      {isFiled && (
        <div
          style={{
            background: 'rgba(63, 185, 80, 0.07)',
            border: '1px solid rgba(63, 185, 80, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 18px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--color-pillar-health)' }}>✓</span>
          <div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, color: 'var(--color-pillar-health)' }}>
              {year} — Filed & Assessed
            </div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
              GST return and T1 income tax both complete. Notice of Assessment received from CRA. Managed by Rob.
            </div>
          </div>
        </div>
      )}

      {fetchError && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-negative, #ef4444)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            marginBottom: 20,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-negative, #ef4444)',
          }}
        >
          {fetchError}
        </div>
      )}

      {loading && (
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading…
        </p>
      )}

      {!loading && data && (
        <>
          {/* Quarterly Readiness */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
              }}
            >
              Quarterly Readiness — {year}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {data.quarterReadiness.map((q) => (
                <ReadinessCard key={q.q} q={q} />
              ))}
            </div>
          </section>

          {/* Year-end checklist */}
          {!isFiled && <YearEndChecklist readiness={data.quarterReadiness} year={year} />}

          {/* ITCs by Quarter */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
              }}
            >
              Input Tax Credits (ITCs) by Quarter
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {data.quarters.map((q) => (
                <div
                  key={q.q}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: 'var(--color-text-disabled)',
                      textTransform: 'uppercase',
                      marginBottom: 8,
                    }}
                  >
                    {q.label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      color: 'var(--color-accent-gold)',
                      marginBottom: 6,
                    }}
                  >
                    {fmt(q.itc)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
                    {fmt(q.pretax)} pretax · {q.count} exp
                  </div>
                </div>
              ))}
            </div>

            {/* Annual ITC total */}
            <div
              style={{
                marginTop: 12,
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-accent-gold)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
              }}
            >
              <div>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {year} Total ITCs
                </span>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 900, color: 'var(--color-accent-gold)' }}>
                  {fmt(data.ytd.itc)}
                </div>
              </div>
              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)' }} />
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>
                  {fmt(data.ytd.pretax)} total pretax
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
                  {fmt(data.ytd.businessPortion)} business portion · {data.ytd.count} expenses
                </div>
              </div>
              {data.zeroGstExpenses > 0 && (
                <>
                  <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)' }} />
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
                    {data.zeroGstExpenses} zero-rated rows (books, bank, insurance)
                    <br />excluded from ITC total
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Amazon GST note */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              <strong style={{ color: 'var(--color-text-primary)' }}>Amazon Marketplace Facilitator:</strong>{' '}
              Amazon collects and remits GST/HST on your behalf (CRA Line 103 = $0). You still claim ITCs on all business expenses (Line 106). Confirm Line 103 with Rob before filing.
            </div>
          </section>

          {/* T2125 Preview */}
          {data.t2125.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                  marginBottom: 12,
                }}
              >
                T2125 Line Preview — {year}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Line', 'Description', 'Expenses', 'Business Portion'].map((h) => (
                      <th
                        key={h}
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-nano)',
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--color-text-disabled)',
                          padding: '6px 10px',
                          textAlign: h === 'Line' || h === 'Description' ? 'left' : 'right',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.t2125.map((line, i) => (
                    <tr
                      key={line.line}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)',
                        borderBottom: '1px solid var(--color-border)',
                      }}
                    >
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-disabled)', fontWeight: 700 }}>{line.line}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)' }}>{line.label}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{fmt(line.pretax)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 600 }}>{fmt(line.businessPortion)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                    <td colSpan={2} style={{ padding: '8px 10px', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                      Total Deductible
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {fmt(data.t2125.reduce((s, l) => s + l.pretax, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-accent-gold)', fontWeight: 700 }}>
                      {fmt(data.t2125.reduce((s, l) => s + l.businessPortion, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {data.loanRepaymentPretax > 0 && (
                <div style={{ marginTop: 8, fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
                  Note: {fmt(data.loanRepaymentPretax)} in loan repayments (BDC/Tesla) excluded — principal is not deductible on T2125 (interest portion is — confirm with Rob).
                </div>
              )}
            </section>
          )}

          {data.t2125.length === 0 && !loading && (
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
              No expenses logged for {year}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
