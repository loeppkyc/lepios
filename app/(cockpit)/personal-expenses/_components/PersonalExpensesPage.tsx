'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  PersonalExpensesResponse,
  Person,
  CategoryTotal,
  MonthRow,
} from '@/app/api/personal-expenses/route'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1]

type View = 'all' | 'colin' | 'megan'

function fmt(n: number) {
  if (n === 0) return '—'
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function fmtFull(n: number) {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  })
}

const PERSON_COLORS: Record<Person, string> = {
  colin: 'var(--color-pillar-money)',
  megan: 'var(--color-accent-gold)',
}

// Diverse palette for donut slices, cycled
const SLICE_PALETTE = [
  '#4CAF50',
  '#2196F3',
  '#FF9800',
  '#E91E63',
  '#9C27B0',
  '#00BCD4',
  '#FFC107',
  '#3F51B5',
  '#8BC34A',
  '#F44336',
  '#009688',
  '#673AB7',
  '#CDDC39',
  '#FF5722',
]

export function PersonalExpensesPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<PersonalExpensesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('all')

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const filtered = useMemo(() => {
    if (!data) return null
    const matchPerson = (p: Person) => view === 'all' || view === p

    const cats = data.categories.filter((c) => matchPerson(c.person))
    const rows: MonthRow[] = data.combinedRows.map((r) => {
      const filteredCats: Record<string, number> = {}
      for (const [k, v] of Object.entries(r.categories)) {
        const [person] = k.split('|')
        if (matchPerson(person as Person)) filteredCats[k] = v
      }
      const colinTotal = view === 'megan' ? 0 : r.colin
      const meganTotal = view === 'colin' ? 0 : r.megan
      return {
        month: r.month,
        colin: colinTotal,
        megan: meganTotal,
        total: colinTotal + meganTotal,
        categories: filteredCats,
      }
    })
    const total = cats.reduce((s, c) => s + c.total, 0)
    return { cats, rows, total }
  }, [data, view])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1180, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display, var(--font-ui))',
              fontSize: '1.15rem',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Family Expenses
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              margin: '6px 0 0',
            }}
          >
            Combined household expenses (Colin + Megan), pulled live from Google Sheets.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {(['all', 'colin', 'megan'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 14px',
              background: view === v ? 'var(--color-accent-gold)' : 'transparent',
              color: view === v ? '#000' : 'var(--color-text-muted)',
              border:
                '1px solid ' + (view === v ? 'var(--color-accent-gold)' : 'var(--color-border)'),
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {v === 'all' ? 'Combined' : v}
          </button>
        ))}
      </div>

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading from Google Sheets…
        </div>
      )}
      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: '#e5534b',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {data && filtered && !loading && (
        <>
          {/* KPI strip */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <KpiCard label="YTD Total" value={fmt(filtered.total)} accent />
            <KpiCard label="Colin" value={fmt(data.totals.colin)} color={PERSON_COLORS.colin} />
            <KpiCard label="Megan" value={fmt(data.totals.megan)} color={PERSON_COLORS.megan} />
            <KpiCard
              label="Monthly avg"
              value={fmt(
                filtered.rows.length
                  ? filtered.total / filtered.rows.filter((r) => r.total > 0).length
                  : 0
              )}
            />
          </div>

          {/* Charts row: donut + trend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <div
              style={{
                flex: '1 1 360px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                  marginBottom: 14,
                }}
              >
                Category Mix — {year}
              </div>
              <Donut categories={filtered.cats} />
            </div>

            <div
              style={{
                flex: '2 1 480px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                  marginBottom: 14,
                }}
              >
                Monthly Spend — {year}
              </div>
              <MonthlyTrendChart rows={filtered.rows} view={view} />
            </div>
          </div>

          {/* Top categories bars */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 20px',
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
                marginBottom: 14,
              }}
            >
              Top Categories — {year}
            </div>
            <CategoryBars
              cats={filtered.cats.slice(0, 12)}
              maxValue={filtered.cats[0]?.total ?? 1}
            />
          </div>

          {/* Monthly table */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 20px',
              marginBottom: 24,
              overflowX: 'auto',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
                marginBottom: 14,
              }}
            >
              Monthly Breakdown — {year}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Month', 'Colin', 'Megan', 'Combined'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '8px 14px',
                        textAlign: i === 0 ? 'left' : 'right',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.rows.map((r) => (
                  <tr
                    key={r.month}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      opacity: r.total === 0 ? 0.35 : 1,
                    }}
                  >
                    <td
                      style={{
                        padding: '8px 14px',
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {r.month}
                    </td>
                    <td style={tdNumStyle(r.colin)}>{r.colin > 0 ? fmtFull(r.colin) : '—'}</td>
                    <td style={tdNumStyle(r.megan)}>{r.megan > 0 ? fmtFull(r.megan) : '—'}</td>
                    <td
                      style={{
                        ...tdNumStyle(r.total),
                        fontWeight: 700,
                        color:
                          r.total > 0 ? 'var(--color-pillar-health)' : 'var(--color-text-disabled)',
                      }}
                    >
                      {r.total > 0 ? fmtFull(r.total) : '—'}
                    </td>
                  </tr>
                ))}
                <tr
                  style={{
                    background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)',
                  }}
                >
                  <td
                    style={{
                      padding: '10px 14px',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    Total
                  </td>
                  <td
                    style={{
                      ...tdNumStyle(data.totals.colin),
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {fmtFull(data.totals.colin)}
                  </td>
                  <td
                    style={{
                      ...tdNumStyle(data.totals.megan),
                      fontWeight: 700,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {fmtFull(data.totals.megan)}
                  </td>
                  <td
                    style={{
                      ...tdNumStyle(filtered.total),
                      fontWeight: 700,
                      color: 'var(--color-pillar-health)',
                    }}
                  >
                    {fmtFull(filtered.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const tdNumStyle = (val: number): React.CSSProperties => ({
  padding: '8px 14px',
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-small)',
  color: val > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
  fontVariantNumeric: 'tabular-nums',
})

function KpiCard({
  label,
  value,
  accent,
  color,
}: {
  label: string
  value: string
  accent?: boolean
  color?: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        minWidth: 140,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.2rem',
          fontWeight: 700,
          color: color ?? (accent ? 'var(--color-pillar-health)' : 'var(--color-accent-gold)'),
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.65rem',
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
  )
}

function CategoryBars({ cats, maxValue }: { cats: CategoryTotal[]; maxValue: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {cats.map((c) => (
        <div
          key={`${c.person}|${c.name}`}
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: PERSON_COLORS[c.person],
              width: 50,
              flexShrink: 0,
            }}
          >
            {c.person}
          </span>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-muted)',
              width: 180,
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.name}
          </div>
          <div
            style={{
              flex: 1,
              height: 8,
              background: 'var(--color-surface-2)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(c.total / maxValue) * 100}%`,
                background: PERSON_COLORS[c.person],
                borderRadius: 4,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-primary)',
              width: 80,
              textAlign: 'right',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtFull(c.total)}
          </div>
        </div>
      ))}
      {cats.length === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No data for this view.
        </div>
      )}
    </div>
  )
}

export function Donut({ categories }: { categories: CategoryTotal[] }) {
  const total = categories.reduce((s, c) => s + c.total, 0)
  if (total === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
          padding: '20px 0',
        }}
      >
        No data for this view.
      </div>
    )
  }

  const size = 200
  const radius = 90
  const innerRadius = 56
  const cx = size / 2
  const cy = size / 2

  // Build slices, group small ones into "Other"
  const sorted = [...categories].sort((a, b) => b.total - a.total)
  const top = sorted.slice(0, 8)
  const rest = sorted.slice(8)
  const slices: { label: string; value: number; color: string; person?: string }[] = top.map(
    (c, i) => ({
      label: c.name,
      value: c.total,
      color: SLICE_PALETTE[i % SLICE_PALETTE.length],
      person: c.person,
    })
  )
  if (rest.length > 0) {
    slices.push({
      label: `Other (${rest.length})`,
      value: rest.reduce((s, c) => s + c.total, 0),
      color: 'var(--color-text-disabled)',
    })
  }

  // Compute cumulative angles up-front (no mid-render mutation in .map)
  const sliceAngles: { startAngle: number; endAngle: number }[] = []
  {
    let cum = -Math.PI / 2
    for (const slice of slices) {
      const angle = (slice.value / total) * 2 * Math.PI
      sliceAngles.push({ startAngle: cum, endAngle: cum + angle })
      cum += angle
    }
  }
  const arcs = slices.map((slice, idx) => {
    const { startAngle, endAngle } = sliceAngles[idx]
    const x1 = cx + radius * Math.cos(startAngle)
    const y1 = cy + radius * Math.sin(startAngle)
    const x2 = cx + radius * Math.cos(endAngle)
    const y2 = cy + radius * Math.sin(endAngle)
    const xi1 = cx + innerRadius * Math.cos(startAngle)
    const yi1 = cy + innerRadius * Math.sin(startAngle)
    const xi2 = cx + innerRadius * Math.cos(endAngle)
    const yi2 = cy + innerRadius * Math.sin(endAngle)
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

    const d = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${xi2.toFixed(2)} ${yi2.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${xi1.toFixed(2)} ${yi1.toFixed(2)}`,
      'Z',
    ].join(' ')

    return { d, slice }
  })

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill={arc.slice.color}>
            <title>
              {arc.slice.label}: {fmtFull(arc.slice.value)} (
              {Math.round((arc.slice.value / total) * 100)}%)
            </title>
          </path>
        ))}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="13"
          fontWeight="700"
          fill="var(--color-text-primary)"
        >
          {fmt(total)}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontFamily="var(--font-ui)"
          fontSize="9"
          letterSpacing="0.1em"
          fill="var(--color-text-disabled)"
        >
          TOTAL
        </text>
      </svg>

      <div
        style={{
          flex: 1,
          minWidth: 160,
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
        }}
      >
        {slices.map((slice, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
              color: 'var(--color-text-muted)',
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: slice.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {slice.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
              }}
            >
              {Math.round((slice.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthlyTrendChart({ rows, view }: { rows: MonthRow[]; view: View }) {
  const active = rows.filter((r) => r.total > 0)
  if (active.length < 2) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-disabled)',
          padding: '20px 0',
        }}
      >
        Need at least 2 months of data for a trend.
      </div>
    )
  }

  const w = 540
  const h = 200
  const padL = 50
  const padR = 12
  const padT = 12
  const padB = 30
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const allValues = active.flatMap((r) =>
    view === 'all' ? [r.total, r.colin, r.megan] : view === 'colin' ? [r.colin] : [r.megan]
  )
  const maxV = Math.max(...allValues, 1)
  const minV = 0

  const xStep = innerW / Math.max(active.length - 1, 1)
  const xy = (i: number, v: number) => ({
    x: padL + i * xStep,
    y: padT + innerH - ((v - minV) / (maxV - minV || 1)) * innerH,
  })

  const series: { key: 'colin' | 'megan' | 'total'; color: string; label: string }[] =
    view === 'all'
      ? [
          { key: 'total', color: 'var(--color-pillar-health)', label: 'Combined' },
          { key: 'colin', color: PERSON_COLORS.colin, label: 'Colin' },
          { key: 'megan', color: PERSON_COLORS.megan, label: 'Megan' },
        ]
      : view === 'colin'
        ? [{ key: 'colin', color: PERSON_COLORS.colin, label: 'Colin' }]
        : [{ key: 'megan', color: PERSON_COLORS.megan, label: 'Megan' }]

  const yTicks = [0, maxV / 2, maxV]

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* Y grid lines */}
        {yTicks.map((t, i) => {
          const y = padT + innerH - ((t - minV) / (maxV - minV || 1)) * innerH
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="2 4"
              />
              <text
                x={padL - 6}
                y={y + 3}
                fontFamily="var(--font-mono)"
                fontSize="9"
                fill="var(--color-text-disabled)"
                textAnchor="end"
              >
                {fmt(t)}
              </text>
            </g>
          )
        })}

        {/* Series lines */}
        {series.map((s) => {
          const path = active
            .map((r, i) => {
              const p = xy(i, r[s.key])
              return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
            })
            .join(' ')
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
              {active.map((r, i) => {
                const p = xy(i, r[s.key])
                return <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} />
              })}
            </g>
          )
        })}

        {/* X labels (month abbr) */}
        {active.map((r, i) => {
          const p = xy(i, 0)
          const label = r.month.slice(0, 3)
          return (
            <text
              key={i}
              x={p.x}
              y={h - 10}
              fontFamily="var(--font-ui)"
              fontSize="9"
              fill="var(--color-text-disabled)"
              textAnchor="middle"
            >
              {label}
            </text>
          )
        })}
      </svg>

      <div
        style={{
          display: 'flex',
          gap: 16,
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-muted)',
          marginTop: 4,
        }}
      >
        {series.map((s) => (
          <span key={s.key}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background: s.color,
                marginRight: 4,
                borderRadius: 2,
                verticalAlign: 'middle',
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
