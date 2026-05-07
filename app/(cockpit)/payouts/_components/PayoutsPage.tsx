'use client'

import { useEffect, useState } from 'react'
import type { PayoutsResponse, MonthRollup, SettlementRow } from '@/app/api/payouts/route'
import type { PaceResult } from '@/lib/payouts/benchmark'

const CURRENT_YEAR = new Date().getFullYear()

function fmt(n: number) {
  if (n === 0) return '—'
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

function fmtCompact(n: number) {
  if (n === 0) return '—'
  if (Math.abs(n) >= 1000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

const s = {
  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-disabled)',
    padding: '8px 10px 8px 0',
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
    padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left' as const,
  },
  td: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-muted)',
    padding: '7px 10px 7px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right' as const,
  },
}

function MonthRow({ row }: { row: MonthRollup }) {
  const hasData = row.settlementCount > 0
  return (
    <tr style={{ opacity: hasData ? 1 : 0.3 }}>
      <td
        style={{
          ...s.td,
          textAlign: 'left',
          fontFamily: 'var(--font-ui)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {row.label}
      </td>
      <td
        style={{
          ...s.td,
          color: row.gross > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
        }}
      >
        {fmtCompact(row.gross)}
      </td>
      <td style={{ ...s.td, color: '#e5534b' }}>
        {row.feesTotal !== 0 ? fmtCompact(row.feesTotal) : '—'}
      </td>
      <td
        style={{
          ...s.td,
          color: row.refundsTotal !== 0 ? '#e5534b' : 'var(--color-text-disabled)',
        }}
      >
        {row.refundsTotal !== 0 ? fmtCompact(row.refundsTotal) : '—'}
      </td>
      <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
        {row.reimbursements > 0 ? fmtCompact(row.reimbursements) : '—'}
      </td>
      <td
        style={{
          ...s.td,
          fontWeight: 700,
          color: row.netPayout > 0 ? 'var(--color-pillar-health)' : 'var(--color-text-disabled)',
        }}
      >
        {fmtCompact(row.netPayout)}
      </td>
      <td style={{ ...s.td, color: 'var(--color-text-disabled)' }}>
        {hasData ? row.settlementCount : '—'}
      </td>
    </tr>
  )
}

function NotesCell({
  settlementId,
  initial,
  onSave,
}: {
  settlementId: string
  initial: string | null
  onSave: (id: string, notes: string | null) => Promise<void>
}) {
  // NotesCell is keyed by settlementId in the parent table; when the year
  // changes or the settlement set refreshes, this component remounts and
  // `initial` picks up the new value — no sync effect needed.
  const [draft, setDraft] = useState<string>(initial ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function commit() {
    const next = draft.trim()
    const original = (initial ?? '').trim()
    if (next === original) return
    setSaving(true)
    setErr(null)
    try {
      await onSave(settlementId, next.length === 0 ? null : next)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'save failed')
      setDraft(initial ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input
        type="text"
        value={draft}
        maxLength={500}
        placeholder="—"
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(initial ?? '')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        style={{
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)',
          padding: '4px 6px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-secondary)',
          width: '100%',
          minWidth: 160,
          outline: 'none',
          opacity: saving ? 0.5 : 1,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      />
      {err && (
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.65rem', color: '#e5534b' }}>
          {err}
        </span>
      )}
    </div>
  )
}

function SettlementDetail({
  settlements,
  onUpdateNotes,
}: {
  settlements: SettlementRow[]
  onUpdateNotes: (id: string, notes: string | null) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  if (settlements.length === 0) return null
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'var(--color-surface-2)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-text-disabled)',
          }}
        >
          Settlement Detail — {settlements.length} settlements
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.6rem',
            color: 'var(--color-text-disabled)',
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {[
                  'Period',
                  'Gross',
                  'Amazon Fees',
                  'Refunds',
                  'Reimb.',
                  'Net Payout',
                  'Status',
                  'Notes',
                ].map((h, i) => (
                  <th
                    key={h}
                    style={
                      i === 0 ? s.thLeft : i === 7 ? { ...s.th, textAlign: 'left' as const } : s.th
                    }
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s2) => (
                <tr key={s2.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td
                    style={{
                      ...s.td,
                      textAlign: 'left',
                      fontFamily: 'var(--font-ui)',
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s2.periodStart} → {s2.periodEnd}
                  </td>
                  <td style={{ ...s.td, color: 'var(--color-text-primary)' }}>{fmt(s2.gross)}</td>
                  <td style={{ ...s.td, color: '#e5534b' }}>{fmt(s2.feesTotal)}</td>
                  <td
                    style={{
                      ...s.td,
                      color: s2.refundsTotal !== 0 ? '#e5534b' : 'var(--color-text-disabled)',
                    }}
                  >
                    {s2.refundsTotal !== 0 ? fmt(s2.refundsTotal) : '—'}
                  </td>
                  <td style={{ ...s.td, color: 'var(--color-text-muted)' }}>
                    {s2.reimbursements > 0 ? fmt(s2.reimbursements) : '—'}
                  </td>
                  <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-pillar-health)' }}>
                    {fmt(s2.netPayout)}
                  </td>
                  <td
                    style={{
                      ...s.td,
                      color:
                        s2.fundTransferStatus === 'SUCCESSFUL'
                          ? 'var(--color-pillar-health)'
                          : 'var(--color-accent-gold)',
                      textAlign: 'left',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                    }}
                  >
                    {s2.fundTransferStatus}
                  </td>
                  <td style={{ ...s.td, textAlign: 'left', padding: '4px 10px 4px 0' }}>
                    <NotesCell settlementId={s2.id} initial={s2.notes} onSave={onUpdateNotes} />
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

/**
 * F18 surfacing widget — YTD net payout vs. target pace.
 * Bench source: lib/payouts/benchmark.ts (BENCHMARK_MONTHLY_NET_CAD).
 */
function PaceBadge({ benchmark, ytdNet }: { benchmark: PaceResult; ytdNet: number }) {
  const { monthlyTargetCad, expectedYtdCad, ytdPacePct, status } = benchmark
  const dollarDelta = ytdNet - expectedYtdCad
  const tone =
    status === 'ahead'
      ? { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'AHEAD' }
      : status === 'on_pace'
        ? { dot: 'bg-amber-400', text: 'text-amber-300', label: 'ON PACE' }
        : { dot: 'bg-red-500', text: 'text-red-400', label: 'BEHIND' }

  return (
    <div className="mb-6 flex items-center gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 font-mono text-[var(--text-small)]">
      <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
      <span className={`text-xs font-bold tracking-wider uppercase ${tone.text}`}>
        {tone.label} · {ytdPacePct}%
      </span>
      <span className="text-[var(--color-text-muted)]">
        YTD ${ytdNet.toLocaleString('en-CA', { maximumFractionDigits: 0 })} · Expected $
        {expectedYtdCad.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
      </span>
      <span className={`ml-auto text-xs ${dollarDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {dollarDelta >= 0 ? '+' : ''}$
        {dollarDelta.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
      </span>
      <span className="text-[var(--color-text-disabled)]">
        target ${monthlyTargetCad.toLocaleString('en-CA')}/mo
      </span>
    </div>
  )
}

export function PayoutsPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<PayoutsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Pre-existing pattern; refactor to derived-loading state is out of scope for this gap-fill.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(`/api/payouts?year=${year}`)
      .then((r) => r.json())
      .then((d: PayoutsResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e))
        setLoading(false)
      })
  }, [year])

  const years = [CURRENT_YEAR, CURRENT_YEAR - 1]

  async function handleUpdateNotes(id: string, notes: string | null) {
    const res = await fetch(`/api/payouts/${encodeURIComponent(id)}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        settlements: prev.settlements.map((s2) => (s2.id === id ? { ...s2, notes } : s2)),
      }
    })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
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
          Amazon Payouts
        </span>
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
          style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: '#e5534b' }}
        >
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* F18 surfacing — YTD-vs-target pace indicator */}
          <PaceBadge benchmark={data.benchmark} ytdNet={data.ytd.netPayout} />
          {/* YTD KPI strip */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Gross Revenue', value: data.ytd.gross, color: 'var(--color-accent-gold)' },
              { label: 'Amazon Fees', value: data.ytd.feesTotal, color: '#e5534b' },
              { label: 'Refunds', value: data.ytd.refundsTotal, color: '#e5534b' },
              {
                label: 'Reimbursements',
                value: data.ytd.reimbursements,
                color: 'var(--color-text-muted)',
              },
              {
                label: 'Net Payout',
                value: data.ytd.netPayout,
                color: 'var(--color-pillar-health)',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  flex: 1,
                  minWidth: 130,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color,
                  }}
                >
                  {fmtCompact(value)}
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

          {/* Fee rate note */}
          {data.ytd.gross > 0 && (
            <div
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 16px',
                marginBottom: 20,
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
              }}
            >
              Effective Amazon fee rate:{' '}
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {((data.ytd.feesTotal / data.ytd.gross) * 100).toFixed(1)}%
              </strong>{' '}
              of gross revenue. Net margin after fees:{' '}
              <strong style={{ color: 'var(--color-pillar-health)' }}>
                {((data.ytd.netPayout / data.ytd.gross) * 100).toFixed(1)}%
              </strong>
              .
            </div>
          )}

          {/* Monthly table */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              marginBottom: 20,
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
              Monthly Breakdown — {year}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[
                      'Month',
                      'Gross Revenue',
                      'Amazon Fees',
                      'Refunds',
                      'Reimb.',
                      'Net Payout',
                      'Settlements',
                    ].map((h, i) => (
                      <th key={h} style={i === 0 ? s.thLeft : s.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.monthlyRollups.map((row) => (
                    <MonthRow key={row.month} row={row} />
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      background: 'color-mix(in srgb, var(--color-pillar-money) 5%, transparent)',
                    }}
                  >
                    <td
                      style={{
                        ...s.td,
                        textAlign: 'left',
                        fontFamily: 'var(--font-ui)',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      YTD Total
                    </td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-accent-gold)' }}>
                      {fmtCompact(data.ytd.gross)}
                    </td>
                    <td style={{ ...s.td, fontWeight: 700, color: '#e5534b' }}>
                      {fmtCompact(data.ytd.feesTotal)}
                    </td>
                    <td style={{ ...s.td, fontWeight: 700, color: '#e5534b' }}>
                      {fmtCompact(data.ytd.refundsTotal)}
                    </td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-text-muted)' }}>
                      {fmtCompact(data.ytd.reimbursements)}
                    </td>
                    <td style={{ ...s.td, fontWeight: 700, color: 'var(--color-pillar-health)' }}>
                      {fmtCompact(data.ytd.netPayout)}
                    </td>
                    <td style={{ ...s.td, color: 'var(--color-text-disabled)' }}>
                      {data.ytd.settlementCount}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <SettlementDetail settlements={data.settlements} onUpdateNotes={handleUpdateNotes} />
        </>
      )}

      {data && !loading && data.settlements.length === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No settlements found for {year}. Run the SP-API backfill to import settlement data.
        </div>
      )}
    </div>
  )
}
