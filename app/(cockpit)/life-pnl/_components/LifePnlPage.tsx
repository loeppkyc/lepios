'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import type { PnlResponse, MonthlyPnlRow } from '@/app/api/pnl/route'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmtCad = (n: number, compact = false) => {
  if (compact && Math.abs(n) >= 1000) {
    return (n >= 0 ? '' : '-') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  }
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function profitColor(n: number | null): string {
  if (n == null) return 'var(--color-text-disabled)'
  if (n > 0) return 'var(--color-pillar-health)'
  if (n < 0) return '#e5534b'
  return 'var(--color-text-disabled)'
}

function KpiCard({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 18px',
        minWidth: 130,
        flex: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.25rem',
          fontWeight: 700,
          color: sub === 'profit' ? profitColor(value) : 'var(--color-accent-gold)',
        }}
      >
        {value == null ? '—' : fmtCad(value)}
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

function MonthRow({ row, isYtd }: { row: MonthlyPnlRow; isYtd?: boolean }) {
  const monthLabel = isYtd ? 'YTD Total' : MONTHS[parseInt(row.month.slice(5, 7), 10) - 1]
  const isEmpty = row.revenue === 0 && (row.cogs === 0 || row.cogs == null) && row.opex === 0

  const cell = (n: number | null, gold = false): React.CSSProperties => ({
    padding: '8px 14px',
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    color: gold
      ? n === 0 || n == null
        ? 'var(--color-text-disabled)'
        : 'var(--color-accent-gold)'
      : n === 0 || n == null
        ? 'var(--color-text-disabled)'
        : 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  })

  const cogsTitle = row.cogsApprox
    ? 'Approximate — only FBA fees counted (no inventory snapshot for this month)'
    : row.cogs == null
      ? 'Pending — needs inventory snapshot'
      : `Inventory drawdown ${row.cogsBreakdown.inventoryDrawdown != null ? fmtCad(row.cogsBreakdown.inventoryDrawdown) : '—'} + FBA fees ${fmtCad(row.cogsBreakdown.fbaFees)}`

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: isYtd ? 'var(--color-surface-2)' : isEmpty ? 'rgba(0,0,0,0.15)' : 'transparent',
        opacity: isEmpty && !isYtd ? 0.5 : 1,
      }}
    >
      <td
        style={{
          padding: '8px 14px',
          fontFamily: isYtd ? 'var(--font-ui)' : 'var(--font-mono)',
          fontSize: isYtd ? '0.72rem' : '0.8rem',
          fontWeight: isYtd ? 700 : 400,
          letterSpacing: isYtd ? '0.08em' : 0,
          textTransform: isYtd ? 'uppercase' : 'none',
          color: isYtd ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        {monthLabel}
      </td>
      <td style={cell(row.revenue, true)}>{row.revenue === 0 ? '—' : fmtCad(row.revenue)}</td>
      <td style={cell(row.cogs)} title={cogsTitle}>
        {row.cogs == null
          ? '—'
          : row.cogs === 0
            ? '—'
            : (row.cogsApprox ? '≈ ' : '') + fmtCad(row.cogs)}
      </td>
      <td
        style={{
          ...cell(row.grossProfit),
          color:
            row.grossProfit == null || row.grossProfit === 0
              ? 'var(--color-text-disabled)'
              : profitColor(row.grossProfit),
        }}
      >
        {row.grossProfit == null ? '—' : row.grossProfit === 0 ? '—' : fmtCad(row.grossProfit)}
      </td>
      <td style={cell(row.opex)}>{row.opex === 0 ? '—' : fmtCad(row.opex)}</td>
      <td
        style={{
          ...cell(row.netProfit),
          fontWeight: 700,
          fontSize: '0.85rem',
          color:
            row.netProfit == null || row.netProfit === 0
              ? 'var(--color-text-disabled)'
              : profitColor(row.netProfit),
        }}
      >
        {row.netProfit == null
          ? '—'
          : row.netProfit === 0 && row.revenue === 0
            ? '—'
            : fmtCad(row.netProfit)}
      </td>
    </tr>
  )
}

export function LifePnlPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<PnlResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(`/api/pnl?year=${year}`)
        const j = (await r.json()) as PnlResponse & { error?: string }
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        if (!cancelled) setData(j)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [year, refetchKey])

  const _ = refetchKey // consumed to avoid lint warning

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--font-ui)', maxWidth: 960 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
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
          Life P&L
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '6px 0 0',
          }}
        >
          Revenue (Amazon settlements) → COGS → Gross Profit → OpEx → Net Profit
        </p>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            margin: '8px 0 0',
          }}
        >
          Want to know where you sit right now? →{' '}
          <Link
            href="/net-worth"
            style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
          >
            Net Worth
          </Link>
        </p>
      </div>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {loading && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--color-text-disabled)',
            }}
          >
            Loading…
          </span>
        )}
      </div>

      {err && (
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
          {err}
        </div>
      )}

      {data && (
        <>
          {/* KPI row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
            <KpiCard label="Revenue" value={data.totals.revenue} />
            <KpiCard label="COGS" value={data.totals.cogs} />
            <KpiCard label="Gross Profit" value={data.totals.grossProfit} sub="profit" />
            <KpiCard label="OpEx" value={data.totals.opex} />
            <KpiCard label="Net Profit" value={data.totals.netProfit} sub="profit" />
          </div>

          {/* Monthly P&L table */}
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              marginBottom: 28,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {['Month', 'Revenue', 'COGS', 'Gross Profit', 'OpEx', 'Net Profit'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '9px 14px',
                        textAlign: h === 'Month' ? 'left' : 'right',
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        color: 'var(--color-text-disabled)',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.months.map((row) => (
                  <MonthRow key={row.month} row={row} />
                ))}
                <MonthRow
                  row={
                    {
                      month: 'YTD',
                      revenue: data.totals.revenue,
                      cogs: data.totals.cogs,
                      cogsApprox: data.totals.monthsMissingSnapshot > 0,
                      cogsBreakdown: {
                        beginningInventory: null,
                        endingInventory: null,
                        purchases: 0,
                        fbaFees: data.totals.fbaFeesIncludedInCogs,
                        inventoryDrawdown: data.totals.inventoryDrawdownIncludedInCogs || null,
                      },
                      grossProfit: data.totals.grossProfit,
                      opex: data.totals.opex,
                      netProfit: data.totals.netProfit,
                    } satisfies MonthlyPnlRow
                  }
                  isYtd
                />
              </tbody>
            </table>
          </div>

          {/* Expense category breakdown */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
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
              Expense Breakdown — {year}
            </div>
            {data.categories.length === 0 ? (
              <div
                style={{
                  padding: '20px 16px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                No expenses logged for {year}.
              </div>
            ) : (
              <div style={{ padding: '10px 0' }}>
                {data.categories.map((cat) => {
                  const maxTotal = data.categories[0]?.total ?? 1
                  const pct = (cat.total / maxTotal) * 100
                  return (
                    <div
                      key={cat.category}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '6px 16px',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: cat.isCogs
                            ? 'var(--color-accent-gold)'
                            : 'var(--color-text-disabled)',
                          width: 40,
                          flexShrink: 0,
                          textAlign: 'center',
                        }}
                      >
                        {cat.isCogs ? 'COGS' : 'OpEx'}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-ui)',
                          fontSize: 'var(--text-small)',
                          color: 'var(--color-text-primary)',
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cat.category}
                      </span>
                      <div
                        style={{
                          width: 160,
                          height: 6,
                          background: 'var(--color-surface-2)',
                          borderRadius: 3,
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: cat.isCogs
                              ? 'var(--color-accent-gold)'
                              : 'var(--color-text-disabled)',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.8rem',
                          color: 'var(--color-text-muted)',
                          width: 80,
                          textAlign: 'right',
                          flexShrink: 0,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtCad(cat.total)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer note */}
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '0.68rem',
              color: 'var(--color-text-disabled)',
              marginTop: 16,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--color-text-muted)' }}>Revenue</strong> = Amazon
            settlement net_payout.{' '}
            <strong style={{ color: 'var(--color-text-muted)' }}>COGS</strong> = Beginning Inventory
            + Purchases − Ending Inventory + FBA fees. Months with no end-of-month inventory
            snapshot show only the FBA-fees portion (marked <code>≈</code>) — add snapshots via{' '}
            <Link
              href="#inventory-snapshots"
              style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
            >
              the snapshots panel below
            </Link>{' '}
            for accurate monthly COGS.{' '}
            <strong style={{ color: 'var(--color-text-muted)' }}>OpEx</strong> = remaining business
            expenses (pretax, tax excluded).
            {data?.totals.fbaFeesIncludedInCogs ? (
              <>
                {' '}
                Year-to-date COGS includes{' '}
                <strong style={{ color: 'var(--color-text-muted)' }}>
                  {fmtCad(data.totals.fbaFeesIncludedInCogs)}
                </strong>{' '}
                of FBA fees
                {data.totals.inventoryDrawdownIncludedInCogs ? (
                  <>
                    {' '}
                    +{' '}
                    <strong style={{ color: 'var(--color-text-muted)' }}>
                      {fmtCad(data.totals.inventoryDrawdownIncludedInCogs)}
                    </strong>{' '}
                    of recognized inventory drawdown
                  </>
                ) : null}
                .
              </>
            ) : null}
          </div>

          {/* Inventory Snapshots panel */}
          <InventorySnapshotsPanel onChange={() => setRefetchKey((k) => k + 1)} />
        </>
      )}
    </div>
  )
}

interface SnapshotRow {
  id: string
  snapshot_date: string
  value_at_cost: number
  source: string
  notes: string | null
}

function InventorySnapshotsPanel({ onChange }: { onChange: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newValue, setNewValue] = useState('')
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/inventory-snapshots')
      const j = (await r.json()) as { snapshots?: SnapshotRow[]; error?: string }
      if (j.error) throw new Error(j.error)
      setSnapshots(j.snapshots ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  const add = async () => {
    if (!newDate || !newValue) return
    const value = parseFloat(newValue)
    if (!Number.isFinite(value)) {
      setError('Invalid value')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const r = await fetch('/api/inventory-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_date: newDate, value_at_cost: value }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setNewDate('')
      setNewValue('')
      await load()
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const updateSnapshot = async (id: string, value: number) => {
    setError(null)
    try {
      const r = await fetch('/api/inventory-snapshots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value_at_cost: value }),
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      await load()
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      const r = await fetch(`/api/inventory-snapshots?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      await load()
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      id="inventory-snapshots"
      style={{
        marginTop: 28,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
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
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Inventory Snapshots — drives monthly COGS</span>
        {loading && <span>Loading…</span>}
      </div>
      {error && (
        <div
          style={{
            padding: '8px 16px',
            background: '#2a1a1a',
            color: '#e5534b',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Add new */}
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '4px 8px',
          }}
        />
        <input
          type="number"
          step="0.01"
          placeholder="Inventory value (CAD)"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            padding: '4px 8px',
            width: 200,
            textAlign: 'right',
          }}
        />
        <button
          onClick={() => void add()}
          disabled={adding || !newDate || !newValue}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '5px 14px',
            background:
              adding || !newDate || !newValue
                ? 'var(--color-surface-2)'
                : 'var(--color-accent-gold)',
            color: adding || !newDate || !newValue ? 'var(--color-text-disabled)' : '#000',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: adding || !newDate || !newValue ? 'not-allowed' : 'pointer',
          }}
        >
          {adding ? 'Adding…' : 'Add Snapshot'}
        </button>
      </div>

      {/* List */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-2)' }}>
            {['Date', 'Inventory Value', 'Source', 'Notes', ''].map((h, i) => (
              <th
                key={h + i}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                  padding: '8px 12px',
                  textAlign: i === 1 ? 'right' : 'left',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshots.length === 0 && !loading && (
            <tr>
              <td
                colSpan={5}
                style={{
                  padding: '16px',
                  fontFamily: 'var(--font-ui)',
                  fontSize: '0.78rem',
                  color: 'var(--color-text-disabled)',
                }}
              >
                No snapshots yet. Add the inventory value at end of any month to power monthly COGS.
              </td>
            </tr>
          )}
          {snapshots.map((s) => (
            <SnapshotRowEditor
              key={s.id}
              snapshot={s}
              onSave={(value) => updateSnapshot(s.id, value)}
              onDelete={() => remove(s.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SnapshotRowEditor({
  snapshot,
  onSave,
  onDelete,
}: {
  snapshot: SnapshotRow
  onSave: (value: number) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(snapshot.value_at_cost))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const v = parseFloat(val)
    if (!Number.isFinite(v)) return
    setSaving(true)
    try {
      await onSave(v)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td
        style={{
          padding: '7px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          color: 'var(--color-text-primary)',
        }}
      >
        {snapshot.snapshot_date}
      </td>
      <td
        style={{
          padding: '7px 12px',
          textAlign: 'right',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          color: 'var(--color-accent-gold)',
        }}
      >
        {editing ? (
          <input
            type="number"
            step="0.01"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-accent-gold)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              padding: '3px 8px',
              width: 140,
              textAlign: 'right',
            }}
            autoFocus
            disabled={saving}
          />
        ) : (
          fmtCad(snapshot.value_at_cost)
        )}
      </td>
      <td
        style={{
          padding: '7px 12px',
          fontFamily: 'var(--font-ui)',
          fontSize: '0.7rem',
          color: 'var(--color-text-disabled)',
        }}
      >
        {snapshot.source}
      </td>
      <td
        style={{
          padding: '7px 12px',
          fontFamily: 'var(--font-ui)',
          fontSize: '0.7rem',
          color: 'var(--color-text-disabled)',
          maxWidth: 360,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={snapshot.notes ?? ''}
      >
        {snapshot.notes ?? '—'}
      </td>
      <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                padding: '3px 10px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                marginRight: 4,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '3px 10px',
                background: 'var(--color-accent-gold)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: '#000',
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                padding: '3px 10px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-disabled)',
                cursor: 'pointer',
                marginRight: 4,
              }}
            >
              Edit
            </button>
            <button
              onClick={() => void onDelete()}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.65rem',
                padding: '3px 10px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-disabled)',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  )
}
