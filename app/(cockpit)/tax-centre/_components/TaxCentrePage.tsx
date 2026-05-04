'use client'

import { useState, useEffect } from 'react'

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
}

function fmt(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
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

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 28,
          flexWrap: 'wrap',
        }}
      >
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

      {/* ── Error ── */}
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
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading…
        </p>
      )}

      {!loading && data && (
        <>
          {/* ── Quarterly ITC row ── */}
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
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
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
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {year} Total ITCs
                </span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.5rem',
                    fontWeight: 900,
                    color: 'var(--color-accent-gold)',
                  }}
                >
                  {fmt(data.ytd.itc)}
                </div>
              </div>
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'var(--color-border)',
                }}
              />
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {fmt(data.ytd.pretax)} total pretax
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  {fmt(data.ytd.businessPortion)} business portion · {data.ytd.count} expenses
                </div>
              </div>
              {data.zeroGstExpenses > 0 && (
                <>
                  <div
                    style={{
                      width: 1,
                      alignSelf: 'stretch',
                      background: 'var(--color-border)',
                    }}
                  />
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    {data.zeroGstExpenses} zero-rated rows (books, bank, insurance)
                    <br />
                    excluded from ITC total
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── Amazon GST note ── */}
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
              <strong style={{ color: 'var(--color-text-primary)' }}>
                Amazon Marketplace Facilitator:
              </strong>{' '}
              Amazon collects and remits GST/HST on your behalf (CRA Line 103 = $0). You still claim
              ITCs on all business expenses (Line 106). Blended rate varies by province — confirm
              Line 103 with your accountant before filing.
            </div>
          </section>

          {/* ── T2125 Preview ── */}
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

              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
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
                      <td
                        style={{
                          padding: '7px 10px',
                          color: 'var(--color-text-disabled)',
                          fontWeight: 700,
                        }}
                      >
                        {line.line}
                      </td>
                      <td
                        style={{
                          padding: '7px 10px',
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-ui)',
                        }}
                      >
                        {line.label}
                      </td>
                      <td
                        style={{
                          padding: '7px 10px',
                          textAlign: 'right',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {fmt(line.pretax)}
                      </td>
                      <td
                        style={{
                          padding: '7px 10px',
                          textAlign: 'right',
                          color: 'var(--color-text-primary)',
                          fontWeight: 600,
                        }}
                      >
                        {fmt(line.businessPortion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      borderTop: '2px solid var(--color-border)',
                    }}
                  >
                    <td
                      colSpan={2}
                      style={{
                        padding: '8px 10px',
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      Total Deductible
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {fmt(data.t2125.reduce((s, l) => s + l.pretax, 0))}
                    </td>
                    <td
                      style={{
                        padding: '8px 10px',
                        textAlign: 'right',
                        color: 'var(--color-accent-gold)',
                        fontWeight: 700,
                      }}
                    >
                      {fmt(data.t2125.reduce((s, l) => s + l.businessPortion, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {data.loanRepaymentPretax > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  Note: {fmt(data.loanRepaymentPretax)} in loan repayments (BDC/Tesla) excluded
                  above — principal is not deductible on T2125 (interest portion is — confirm with
                  accountant).
                </div>
              )}

              <div
                style={{
                  marginTop: 8,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                Annual filer · GST return due March 31, {year + 1} · T1 business income due June 15,{' '}
                {year + 1}
              </div>
            </section>
          )}

          {data.t2125.length === 0 && !loading && (
            <p
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-disabled)',
              }}
            >
              No expenses logged for {year}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
