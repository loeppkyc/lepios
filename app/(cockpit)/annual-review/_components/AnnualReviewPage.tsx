'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { AnnualReviewResponse, YearRow, YearVerdict } from '@/app/api/annual-review/route'
import type { LifeMilestone, MilestoneCategory } from '@/app/api/life-milestones/route'

const CATEGORY_LABELS: Record<MilestoneCategory, string> = {
  housing: 'Housing',
  vehicle: 'Vehicle',
  debt: 'Debt',
  family: 'Family',
  business: 'Business',
  health: 'Health',
  other: 'Other',
}

const CATEGORY_COLORS: Record<MilestoneCategory, string> = {
  housing: '#4CAF50',
  vehicle: '#2196F3',
  debt: 'var(--color-accent-gold)',
  family: '#E91E63',
  business: 'var(--color-pillar-money)',
  health: '#FF9800',
  other: 'var(--color-text-muted)',
}

const CATEGORIES: MilestoneCategory[] = [
  'housing',
  'vehicle',
  'debt',
  'family',
  'business',
  'health',
  'other',
]

function fmt(n: number): string {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function fmtDelta(n: number | null): string {
  if (n == null) return '—'
  return (n >= 0 ? '+' : '') + fmt(n)
}

function verdictColor(v: YearVerdict): string {
  if (v === 'winning') return 'var(--color-pillar-health)'
  if (v === 'expanding') return 'var(--color-pillar-health)'
  if (v === 'flat') return 'var(--color-text-muted)'
  if (v === 'tightening') return '#e5534b'
  return 'var(--color-text-disabled)'
}

function verdictLabel(v: YearVerdict): string {
  if (v === 'winning') return 'WINNING'
  if (v === 'expanding') return 'EXPANDING'
  if (v === 'flat') return 'FLAT'
  if (v === 'tightening') return 'TIGHTENING'
  return '—'
}

export function AnnualReviewPage() {
  const [data, setData] = useState<AnnualReviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/annual-review')
      const j = (await r.json()) as AnnualReviewResponse & { error?: string }
      if (j.error) throw new Error(j.error)
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div
      style={{
        padding: '28px 32px',
        maxWidth: 1080,
        margin: '0 auto',
        fontFamily: 'var(--font-ui)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: '1.15rem',
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          Annual Review
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '6px 0 0',
          }}
        >
          Year-over-year wealth trajectory + life milestones. The real &ldquo;how am I doing&rdquo;
          view.
        </p>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            margin: '4px 0 0',
          }}
        >
          Sibling pages:{' '}
          <Link
            href="/net-worth"
            style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
          >
            Net Worth
          </Link>{' '}
          ·{' '}
          <Link
            href="/life-pnl"
            style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
          >
            Life P&L
          </Link>
        </p>
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
            background: '#2a1a1a',
            border: '1px solid #e5534b',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            color: '#e5534b',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Headline */}
          <div
            style={{
              background: 'rgba(63,185,80,0.08)',
              border: '1px solid rgba(63,185,80,0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '20px 24px',
              marginBottom: 28,
              fontFamily: 'var(--font-ui)',
              fontSize: '1rem',
              lineHeight: 1.5,
              color: 'var(--color-text-primary)',
            }}
          >
            {renderMarkdownBold(data.headline)}
          </div>

          {/* Years table */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              marginBottom: 32,
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border)',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
              }}
            >
              Year-over-Year Liquidation
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {[
                    'Year',
                    'Jan 1 Liquid',
                    'End Liquid',
                    'Δ',
                    'Δ %',
                    'Milestones',
                    'Debt Cleared',
                    'Verdict',
                  ].map((h, i) => (
                    <th
                      key={h + i}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '9px 12px',
                        textAlign: i === 0 || i >= 5 ? 'left' : 'right',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.years.map((y) => (
                  <YearTableRow key={y.year} row={y} />
                ))}
              </tbody>
            </table>
            {data.years.length === 0 && (
              <div
                style={{
                  padding: '20px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                No years tracked yet. Add a Net Worth snapshot dated Dec 31, 2024 to start your
                first year.
              </div>
            )}
          </div>

          {/* Milestones */}
          <MilestonesSection milestones={data.milestones} onChange={load} />
        </>
      )}
    </div>
  )
}

function YearTableRow({ row }: { row: YearRow }) {
  const cell: React.CSSProperties = {
    padding: '9px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    color: 'var(--color-text-primary)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td
        style={{
          ...cell,
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
        }}
      >
        {row.year}
        {row.isYtd && (
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: 'var(--color-accent-gold)',
              marginLeft: 8,
            }}
          >
            YTD
          </span>
        )}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {row.jan1Liquid == null ? '—' : fmt(row.jan1Liquid)}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        {row.yearEndLiquid == null ? '—' : fmt(row.yearEndLiquid)}
      </td>
      <td
        style={{
          ...cell,
          textAlign: 'right',
          color:
            row.delta == null
              ? 'var(--color-text-disabled)'
              : row.delta >= 0
                ? 'var(--color-pillar-health)'
                : '#e5534b',
          fontWeight: 700,
        }}
      >
        {fmtDelta(row.delta)}
      </td>
      <td
        style={{
          ...cell,
          textAlign: 'right',
          color: 'var(--color-text-muted)',
        }}
      >
        {row.deltaPct == null
          ? '—'
          : (row.deltaPct >= 0 ? '+' : '') + row.deltaPct.toFixed(1) + '%'}
      </td>
      <td style={{ ...cell, color: 'var(--color-text-muted)' }}>{row.milestoneCount}</td>
      <td
        style={{
          ...cell,
          color:
            row.debtEliminated > 0 ? 'var(--color-pillar-health)' : 'var(--color-text-disabled)',
        }}
      >
        {row.debtEliminated > 0 ? fmt(row.debtEliminated) : '—'}
      </td>
      <td
        style={{
          padding: '9px 12px',
          fontFamily: 'var(--font-ui)',
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: verdictColor(row.verdict),
        }}
      >
        {verdictLabel(row.verdict)}
      </td>
    </tr>
  )
}

function MilestonesSection({
  milestones,
  onChange,
}: {
  milestones: LifeMilestone[]
  onChange: () => void
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border)',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
        }}
      >
        Life Milestones
      </div>

      <AddMilestoneForm onAdded={onChange} />

      <div style={{ padding: '8px 0' }}>
        {milestones.length === 0 && (
          <div
            style={{
              padding: '20px 16px',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)',
            }}
          >
            No milestones yet. Add a major life event above (housing change, debt eliminated, etc.).
          </div>
        )}
        {milestones.map((m) => (
          <MilestoneRow key={m.id} milestone={m} onChange={onChange} />
        ))}
      </div>
    </div>
  )
}

function AddMilestoneForm({ onAdded }: { onAdded: () => void }) {
  const [date, setDate] = useState('')
  const [category, setCategory] = useState<MilestoneCategory>('debt')
  const [title, setTitle] = useState('')
  const [moneyImpact, setMoneyImpact] = useState('')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!date || !title.trim()) {
      setErr('Date and title required')
      return
    }
    setAdding(true)
    setErr(null)
    try {
      const r = await fetch('/api/life-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestone_date: date,
          category,
          title: title.trim(),
          money_impact: moneyImpact === '' ? null : parseFloat(moneyImpact),
        }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setDate('')
      setTitle('')
      setMoneyImpact('')
      onAdded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    padding: '5px 9px',
  }

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={inputStyle}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as MilestoneCategory)}
        style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Title (e.g. Moved to nicer apartment)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ ...inputStyle, flex: 1, minWidth: 200, fontFamily: 'var(--font-ui)' }}
      />
      <input
        type="number"
        step="0.01"
        placeholder="$ impact (optional)"
        value={moneyImpact}
        onChange={(e) => setMoneyImpact(e.target.value)}
        style={{ ...inputStyle, width: 130, textAlign: 'right' }}
      />
      <button
        onClick={() => void submit()}
        disabled={adding || !date || !title.trim()}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '6px 14px',
          background:
            adding || !date || !title.trim()
              ? 'var(--color-surface-2)'
              : 'var(--color-accent-gold)',
          color: adding || !date || !title.trim() ? 'var(--color-text-disabled)' : '#000',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: adding || !date || !title.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {adding ? 'Adding…' : 'Add'}
      </button>
      {err && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: '#e5534b',
            alignSelf: 'center',
          }}
        >
          {err}
        </span>
      )}
    </div>
  )
}

function MilestoneRow({ milestone, onChange }: { milestone: LifeMilestone; onChange: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const remove = async () => {
    if (!confirm('Delete this milestone?')) return
    setDeleting(true)
    try {
      await fetch(`/api/life-milestones?id=${encodeURIComponent(milestone.id)}`, {
        method: 'DELETE',
      })
      onChange()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '10px 16px',
        borderBottom: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        alignItems: 'flex-start',
      }}
    >
      {/* Date column */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          color: 'var(--color-text-disabled)',
          width: 92,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {milestone.milestone_date}
      </div>

      {/* Category dot */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: CATEGORY_COLORS[milestone.category],
          marginTop: 6,
          flexShrink: 0,
        }}
        title={CATEGORY_LABELS[milestone.category]}
      />

      {/* Title + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {milestone.title}
        </div>
        {milestone.description && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.72rem',
              color: 'var(--color-text-muted)',
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            {milestone.description}
          </div>
        )}
      </div>

      {/* Money impact */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          color:
            milestone.money_impact == null
              ? 'var(--color-text-disabled)'
              : milestone.money_impact > 0
                ? 'var(--color-pillar-health)'
                : '#e5534b',
          width: 100,
          textAlign: 'right',
          flexShrink: 0,
          paddingTop: 2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {milestone.money_impact == null
          ? '—'
          : (milestone.money_impact > 0 ? '+' : '') + fmt(milestone.money_impact)}
      </div>

      <button
        onClick={() => void remove()}
        disabled={deleting}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.65rem',
          padding: '3px 8px',
          background: 'none',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-disabled)',
          cursor: 'pointer',
          height: 'fit-content',
          marginTop: 2,
        }}
      >
        {deleting ? '…' : 'Delete'}
      </button>
    </div>
  )
}

// Tiny markdown renderer for **bold** in headline (SSR-safe, no library)
function renderMarkdownBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={i} style={{ color: 'var(--color-pillar-health)' }}>
          {p.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{p}</span>
  })
}
