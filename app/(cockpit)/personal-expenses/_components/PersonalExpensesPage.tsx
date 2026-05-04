'use client'

import { useEffect, useState } from 'react'
import type { PersonalExpensesResponse } from '@/app/api/personal-expenses/route'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1]

function fmt(n: number) {
  if (n === 0) return '—'
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtFull(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

const s = {
  page: { padding: '28px 32px', maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  heading: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--color-pillar-health)',
    marginBottom: 20,
  },
  card: {
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', padding: '20px 24px', marginBottom: 20,
  } as React.CSSProperties,
  select: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)', padding: '6px 10px',
    borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
    background: 'var(--color-surface-2)', color: 'var(--color-text-primary)', outline: 'none',
  } as React.CSSProperties,
  th: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)', padding: '0 8px 8px 0',
    borderBottom: '1px solid var(--color-border)', textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
  },
  td: {
    fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)', padding: '7px 8px 7px 0',
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,
  tdNum: {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)', padding: '7px 8px 7px 0',
    borderBottom: '1px solid var(--color-border)', textAlign: 'right' as const,
  },
}

// Top categories bar chart
function CategoryBars({ totals, headers }: { totals: Record<string, number>; headers: string[] }) {
  const sorted = headers
    .map((h) => ({ label: h, value: totals[h] ?? 0 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const max = sorted[0]?.value ?? 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sorted.map(({ label, value }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-muted)', width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <div style={{ flex: 1, height: 8, background: 'var(--color-surface-2)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: 'var(--color-pillar-health)', borderRadius: 4 }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-nano)', color: 'var(--color-text-primary)', width: 72, textAlign: 'right', flexShrink: 0 }}>
            {fmtFull(value)}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PersonalExpensesPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<PersonalExpensesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/personal-expenses?year=${year}`)
      .then((r) => r.json())
      .then((d: PersonalExpensesResponse & { error?: string }) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!cancelled) { setError(String(e)); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [year])

  const activeMonths = data?.rows.filter((r) => r.total > 0) ?? []

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <span style={s.heading}>Personal Expenses</span>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={s.select}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>
          Loading from Google Sheets…
        </div>
      )}
      {error && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-critical)' }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI strip */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'YTD Total', value: data.grandTotal },
              { label: 'Months with spend', value: activeMonths.length, isCnt: true },
              { label: 'Monthly avg', value: activeMonths.length ? data.grandTotal / activeMonths.length : 0 },
            ].map(({ label, value, isCnt }) => (
              <div key={label} style={{ ...s.card, flex: 1, minWidth: 140, marginBottom: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-pillar-health)' }}>
                  {isCnt ? value : fmt(value as number)}
                </div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Category bars */}
          <div style={s.card}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginBottom: 14 }}>
              Top Categories — {year}
            </div>
            <CategoryBars totals={data.categoryTotals} headers={data.headers} />
          </div>

          {/* Monthly table */}
          <div style={s.card}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginBottom: 14 }}>
              Monthly Breakdown — {year}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Month</th>
                    {data.headers.map((h) => (
                      <th key={h} style={{ ...s.th, textAlign: 'right' }}>{h}</th>
                    ))}
                    <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.month} style={{ opacity: row.total === 0 ? 0.35 : 1 }}>
                      <td style={s.td}>{row.month}</td>
                      {data.headers.map((h) => (
                        <td key={h} style={s.tdNum}>{row.categories[h] ? fmtFull(row.categories[h]) : '—'}</td>
                      ))}
                      <td style={{ ...s.tdNum, fontWeight: 700, color: 'var(--color-pillar-health)' }}>
                        {row.total > 0 ? fmtFull(row.total) : '—'}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr style={{ background: 'color-mix(in srgb, var(--color-pillar-health) 6%, transparent)' }}>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-text-primary)' }}>Total</td>
                    {data.headers.map((h) => (
                      <td key={h} style={{ ...s.tdNum, fontWeight: 700, color: 'var(--color-text-primary)', borderBottom: 'none' }}>
                        {data.categoryTotals[h] ? fmtFull(data.categoryTotals[h]) : '—'}
                      </td>
                    ))}
                    <td style={{ ...s.tdNum, fontWeight: 700, color: 'var(--color-pillar-health)', borderBottom: 'none' }}>
                      {fmtFull(data.grandTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
