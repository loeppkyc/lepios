'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type {
  BalanceSheetEntryLite,
  CategoryTotal,
  NetWorthResponse,
  NetWorthSnapshot,
} from '@/app/api/net-worth/route'
import { ManualAssetsSection } from './ManualAssetsSection'

interface SaveRowInput {
  id: string
  balance: number
  as_of_date: string
}

const CATEGORY_LABELS: Record<string, string> = {
  bank: 'Business Banking',
  cash: 'Cash',
  amazon: 'Amazon Receivable',
  prepaid: 'Prepaid Expenses',
  inventory: 'Inventory',
  equipment: 'Equipment & Vehicles',
  vehicle: 'Vehicles (Auto)',
  receivable: 'Receivables',
  personal_bank: 'Personal Banking',
  personal_investment: 'Personal Investments',
  credit_card: 'Credit Cards',
  loan: 'Loans',
  tax: 'Tax Payable',
  other: 'Other',
}

type Pillar = 'all' | 'business' | 'personal'

function fmt(n: number) {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function fmtDelta(n: number) {
  const sign = n >= 0 ? '+' : ''
  return sign + fmt(n)
}

function isPersonal(category: string) {
  return category.startsWith('personal_')
}

function applyPillar(rows: BalanceSheetEntryLite[], pillar: Pillar) {
  if (pillar === 'all') return rows
  return rows.filter((r) =>
    pillar === 'personal' ? isPersonal(r.category) : !isPersonal(r.category)
  )
}

function applyPillarToCats(cats: CategoryTotal[], pillar: Pillar) {
  if (pillar === 'all') return cats
  return cats.filter((c) =>
    pillar === 'personal' ? isPersonal(c.category) : !isPersonal(c.category)
  )
}

function PillarTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '6px 14px',
        background: active ? 'var(--color-accent-gold)' : 'transparent',
        color: active ? '#000' : 'var(--color-text-muted)',
        border: '1px solid ' + (active ? 'var(--color-accent-gold)' : 'var(--color-border)'),
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function KpiBlock({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ minWidth: 160 }}>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-disabled)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// shadcn/ui ChartConfig for the 3-series AreaChart (F20: Tailwind + CSS vars only)
const trendChartConfig = {
  total_assets: { label: 'Assets', color: 'var(--color-pillar-money)' },
  total_liabilities: { label: 'Liabilities', color: 'hsl(var(--destructive))' },
  net_worth: { label: 'Net Worth', color: 'hsl(var(--primary))' },
} satisfies ChartConfig

export function NetWorthPage() {
  const [data, setData] = useState<NetWorthResponse | null>(null)
  const [history, setHistory] = useState<NetWorthSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pillar, setPillar] = useState<Pillar>('all')
  const [savingSnap, setSavingSnap] = useState(false)
  const [snapMsg, setSnapMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nw, hist] = await Promise.all([
        fetch('/api/net-worth').then((r) => r.json()),
        fetch('/api/net-worth/history?limit=24').then((r) => r.json()),
      ])
      if (nw.error) throw new Error(nw.error)
      if (hist.error) throw new Error(hist.error)
      setData(nw as NetWorthResponse)
      setHistory((hist as { snapshots: NetWorthSnapshot[] }).snapshots ?? [])
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

  const saveSnapshot = useCallback(async () => {
    setSavingSnap(true)
    setSnapMsg(null)
    try {
      const r = await fetch('/api/net-worth/snapshot', { method: 'POST' })
      const j = (await r.json()) as { snapshot?: NetWorthSnapshot; error?: string }
      if (j.error) throw new Error(j.error)
      setSnapMsg('Snapshot saved.')
      await load()
    } catch (e) {
      setSnapMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingSnap(false)
    }
  }, [load])

  const saveRow = useCallback(
    async ({ id, balance, as_of_date }: SaveRowInput) => {
      const r = await fetch('/api/balance-sheet', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, balance, as_of_date }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
      await load()
    },
    [load]
  )

  const filteredRows = data ? applyPillar(data.rows, pillar) : []
  const filteredCats = data ? applyPillarToCats(data.byCategory, pillar) : []

  // Pillar-filtered totals
  let viewAssets = 0
  let viewLiab = 0
  for (const r of filteredRows) {
    if (r.account_type === 'asset') viewAssets += r.balance
    else viewLiab += r.balance
  }
  const viewNet = viewAssets - viewLiab
  const isPositive = viewNet >= 0

  // Group rows by category for the table
  const grouped = filteredRows.reduce<Record<string, BalanceSheetEntryLite[]>>((acc, r) => {
    const key = `${r.account_type}:${r.category}`
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  // Staleness banner: days since latest snapshot
  const snapshotAgeDays =
    data?.latestSnapshot
      ? Math.floor(
          (Date.now() - new Date(data.latestSnapshot.snapshot_date).getTime()) / 86_400_000
        )
      : null

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
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
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
            Net Worth
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              margin: '6px 0 0',
            }}
          >
            How much money and value you have right now. Assets - Liabilities, point in time.
          </p>
          {data?.asOfDate && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                margin: '4px 0 0',
              }}
            >
              as of {data.asOfDate}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            href="/balance-sheet"
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              padding: '7px 14px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
            }}
          >
            Edit Balances
          </Link>
          <button
            onClick={saveSnapshot}
            disabled={savingSnap || !data}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '7px 14px',
              background: 'var(--color-accent-gold)',
              color: '#000',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: savingSnap ? 'wait' : 'pointer',
              opacity: savingSnap ? 0.6 : 1,
            }}
          >
            {savingSnap ? 'Saving...' : 'Save Snapshot'}
          </button>
        </div>
      </div>

      {snapMsg && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-muted)',
            marginBottom: 16,
          }}
        >
          {snapMsg}
        </div>
      )}

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading...
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
          {/* Staleness banner - visible when latest snapshot is >1 day old (F20: Tailwind only) */}
          {snapshotAgeDays !== null && snapshotAgeDays > 1 && (
            <div className="mb-4 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
              Snapshot {snapshotAgeDays}d old - save a fresh one to update the trend.
            </div>
          )}

          {/* Big KPI banner */}
          <div
            style={{
              background: isPositive ? 'rgba(63,185,80,0.07)' : 'rgba(229,83,75,0.07)',
              border: `1px solid ${isPositive ? 'rgba(63,185,80,0.3)' : 'rgba(229,83,75,0.3)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '20px 22px',
              marginBottom: 24,
              display: 'flex',
              gap: 32,
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <KpiBlock
              label="Total Assets"
              value={fmt(viewAssets)}
              color="var(--color-accent-gold)"
            />
            <KpiBlock label="Total Liabilities" value={fmt(viewLiab)} color="#e5534b" />
            <div style={{ minWidth: 200 }}>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-disabled)',
                  marginBottom: 6,
                }}
              >
                Net Worth
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: isPositive ? 'var(--color-pillar-health)' : '#e5534b',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                }}
              >
                {fmt(viewNet)}
              </div>
              {pillar === 'all' && data.changeSinceSnapshot !== null && (
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-nano)',
                    color: data.changeSinceSnapshot >= 0 ? 'var(--color-pillar-health)' : '#e5534b',
                    marginTop: 4,
                  }}
                >
                  {fmtDelta(data.changeSinceSnapshot)} since last snapshot
                  {data.latestSnapshot ? ` (${data.latestSnapshot.snapshot_date})` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Pillar tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <PillarTab active={pillar === 'all'} label="All" onClick={() => setPillar('all')} />
            <PillarTab
              active={pillar === 'business'}
              label="Business"
              onClick={() => setPillar('business')}
            />
            <PillarTab
              active={pillar === 'personal'}
              label="Personal"
              onClick={() => setPillar('personal')}
            />
          </div>

          {/* Breakdown table */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
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
                  {['Account', 'Balance', 'As Of', ''].map((h, i) => (
                    <th
                      key={h + i}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--color-text-disabled)',
                        padding: '9px 14px',
                        textAlign: i === 1 ? 'right' : i === 2 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCats.map((cat) => {
                  const key = `${cat.account_type}:${cat.category}`
                  const catRows = grouped[key] ?? []
                  if (catRows.length === 0) return null
                  return (
                    <RowGroup
                      key={key}
                      label={CATEGORY_LABELS[cat.category] ?? cat.category}
                      isLiability={cat.account_type === 'liability'}
                      rows={catRows}
                      total={cat.total}
                      onSave={saveRow}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Trend chart - shadcn/ui AreaChart (F20: no style={}, Tailwind only for new JSX) */}
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 18px',
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
                marginBottom: 8,
              }}
            >
              Trend
            </div>
            {history.length < 2 ? (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                  padding: '20px 0',
                }}
              >
                Save snapshots monthly to see your trend over time.
                {history.length === 1 && ' (1 snapshot saved - 1 more and the chart appears.)'}
              </div>
            ) : (
              <>
                <ChartContainer config={trendChartConfig} className="h-56 w-full">
                  <AreaChart data={history} margin={{ top: 4, right: 0, left: -8, bottom: 0 }}>
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--color-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="snapshot_date"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      tick={{
                        fontSize: 10,
                        fill: 'var(--color-text-disabled)',
                        fontFamily: 'var(--font-ui)',
                      }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                      }
                      tick={{
                        fontSize: 10,
                        fill: 'var(--color-text-disabled)',
                        fontFamily: 'var(--font-ui)',
                      }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="total_assets"
                      stroke="var(--color-total_assets)"
                      fill="var(--color-total_assets)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="total_liabilities"
                      stroke="var(--color-total_liabilities)"
                      fill="var(--color-total_liabilities)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="net_worth"
                      stroke="var(--color-net_worth)"
                      fill="var(--color-net_worth)"
                      fillOpacity={0.15}
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ChartContainer>
                <div className="mt-2 flex flex-wrap gap-4 font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
                  <span>
                    <span className="mr-1 inline-block size-2 rounded-full bg-[var(--color-pillar-money)]" />
                    Assets
                  </span>
                  <span>
                    <span className="mr-1 inline-block size-2 rounded-full bg-[hsl(var(--destructive))]" />
                    Liabilities
                  </span>
                  <span>
                    <span className="mr-1 inline-block size-2 rounded-full bg-[hsl(var(--primary))]" />
                    Net Worth
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Manual Assets - non-API wealth items (vehicles, real estate, etc.) */}
          <ManualAssetsSection />

          {/* Footer note */}
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              lineHeight: 1.6,
            }}
          >
            Equity rows (Retained Earnings, Owner&apos;s Draw, Net Income YTD, etc.) are excluded -
            they&apos;re accounting balances, not wealth. Edit any line on the{' '}
            <Link
              href="/balance-sheet"
              style={{ color: 'var(--color-accent-gold)', textDecoration: 'underline' }}
            >
              Balance Sheet
            </Link>{' '}
            page. To track over time, click <em>Save Snapshot</em> at month-end.
          </div>
        </>
      )}
    </div>
  )
}

function RowGroup({
  label,
  isLiability,
  rows,
  total,
  onSave,
}: {
  label: string
  isLiability: boolean
  rows: BalanceSheetEntryLite[]
  total: number
  onSave: (input: SaveRowInput) => Promise<void>
}) {
  return (
    <>
      <tr style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
        <td
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: isLiability ? '#e5534b' : 'var(--color-accent-gold)',
            padding: '7px 14px',
          }}
        >
          {label}
        </td>
        <td
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-nano)',
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            textAlign: 'right',
            padding: '7px 14px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(total)}
        </td>
        <td />
        <td />
      </tr>
      {rows.map((r) => (
        <EditableRow key={r.id} row={r} onSave={onSave} />
      ))}
    </>
  )
}

function EditableRow({
  row,
  onSave,
}: {
  row: BalanceSheetEntryLite
  onSave: (input: SaveRowInput) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [balanceStr, setBalanceStr] = useState(String(row.balance))
  const [asOfDate, setAsOfDate] = useState(row.as_of_date)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function startEdit() {
    setBalanceStr(String(row.balance))
    setAsOfDate(row.as_of_date)
    setErr(null)
    setEditing(true)
  }

  async function save() {
    const val = parseFloat(balanceStr)
    if (!Number.isFinite(val)) {
      setErr('Invalid number')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onSave({ id: row.id, balance: val, as_of_date: asOfDate })
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setBalanceStr(String(row.balance))
    setAsOfDate(row.as_of_date)
    setErr(null)
    setEditing(false)
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-accent-gold)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    padding: '4px 8px',
    outline: 'none',
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-secondary)',
          padding: '7px 14px 7px 28px',
        }}
      >
        {row.name}
      </td>
      <td
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-primary)',
          textAlign: 'right',
          padding: '7px 14px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {editing ? (
          <input
            type="number"
            step="0.01"
            value={balanceStr}
            onChange={(e) => setBalanceStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') cancel()
            }}
            style={{ ...inputStyle, width: 130, textAlign: 'right' }}
            autoFocus
            disabled={saving}
          />
        ) : (
          fmt(row.balance)
        )}
      </td>
      <td
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
          textAlign: 'right',
          padding: '7px 14px',
          whiteSpace: 'nowrap',
        }}
      >
        {editing ? (
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
            disabled={saving}
          />
        ) : (
          row.as_of_date
        )}
      </td>
      <td
        style={{
          padding: '7px 14px',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        {editing ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button
              onClick={cancel}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                padding: '3px 10px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                padding: '3px 10px',
                background: 'var(--color-accent-gold)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: '#000',
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {err && (
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: '#e5534b',
                  alignSelf: 'center',
                }}
                title={err}
              >
                !
              </span>
            )}
          </span>
        ) : (
          <button
            onClick={startEdit}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              padding: '3px 10px',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-disabled)',
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  )
}
