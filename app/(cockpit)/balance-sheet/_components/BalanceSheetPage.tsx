'use client'

import { useEffect, useState, useCallback } from 'react'
import type { BalanceSheetEntry, BalanceSheetResponse } from '@/app/api/balance-sheet/route'

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

const CATEGORY_LABELS: Record<string, string> = {
  bank: 'Bank Accounts',
  inventory: 'Inventory',
  equipment: 'Equipment',
  other: 'Other Assets',
  credit_card: 'Credit Cards',
  loan: 'Loans',
}

function EntryRow({
  entry,
  onSave,
}: {
  entry: BalanceSheetEntry
  onSave: (id: string, balance: number, asOfDate: string, notes: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [balanceStr, setBalanceStr] = useState(String(entry.balance))
  const [asOfDate, setAsOfDate] = useState(entry.as_of_date)
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    const val = parseFloat(balanceStr)
    if (isNaN(val)) return
    setSaving(true)
    await onSave(entry.id, val, asOfDate, notes)
    setSaving(false)
    setEditing(false)
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-accent-gold)',
    borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)',
    padding: '4px 8px', outline: 'none',
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-secondary)', padding: '8px 12px 8px 0' }}>
        {entry.name}
      </td>
      <td style={{ padding: '8px 12px 8px 0', textAlign: 'right' }}>
        {editing ? (
          <input
            type="number"
            value={balanceStr}
            onChange={e => setBalanceStr(e.target.value)}
            style={{ ...inputStyle, width: 110, textAlign: 'right' }}
            autoFocus
          />
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {fmt(entry.balance)}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 12px 8px 0', textAlign: 'right' }}>
        {editing ? (
          <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} style={{ ...inputStyle, width: 130 }} />
        ) : (
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
            {entry.as_of_date}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 12px 8px 0' }}>
        {editing ? (
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes…"
            style={{ ...inputStyle, width: '100%' }}
          />
        ) : (
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
            {entry.notes ?? ''}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(false)} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', padding: '3px 10px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 600, padding: '3px 10px', background: 'var(--color-accent-gold)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', padding: '3px 10px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-disabled)', cursor: 'pointer' }}>
            Edit
          </button>
        )}
      </td>
    </tr>
  )
}

function Section({
  title,
  entries,
  total,
  totalColor,
  onSave,
}: {
  title: string
  entries: BalanceSheetEntry[]
  total: number
  totalColor: string
  onSave: (id: string, balance: number, asOfDate: string, notes: string) => Promise<void>
}) {
  const grouped = entries.reduce<Record<string, BalanceSheetEntry[]>>((acc, e) => {
    const cat = e.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(e)
    return acc
  }, {})

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
              {['Account', 'Balance', 'As Of', 'Notes', ''].map((h, i) => (
                <th key={h + i} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', padding: '8px 12px 8px 0', textAlign: i === 1 || i === 2 ? 'right' : 'left' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).map(([cat, rows]) => (
              <>
                <tr key={`cat-${cat}`} style={{ background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)' }}>
                  <td colSpan={5} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', padding: '5px 12px 5px 0' }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </td>
                </tr>
                {rows.map(entry => (
                  <EntryRow key={entry.id} entry={entry} onSave={onSave} />
                ))}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--color-border)' }}>
              <td style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, color: 'var(--color-text-primary)', padding: '10px 12px 10px 0' }}>
                Total {title}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: totalColor, textAlign: 'right', padding: '10px 12px 10px 0' }}>
                {fmt(total)}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export function BalanceSheetPage() {
  const [data, setData] = useState<BalanceSheetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/balance-sheet')
      .then(r => r.json())
      .then((d: BalanceSheetResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async (id: string, balance: number, asOfDate: string, notes: string) => {
    await fetch('/api/balance-sheet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, balance, as_of_date: asOfDate, notes }),
    })
    load()
  }, [load])

  const assets = data?.entries.filter(e => e.account_type === 'asset') ?? []
  const liabilities = data?.entries.filter(e => e.account_type === 'liability') ?? []
  const isPositive = (data?.netEquity ?? 0) >= 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-pillar-money)' }}>
          Balance Sheet
        </span>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)' }}>
          Update each balance to reflect today's statement
        </span>
      </div>

      {loading && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Loading…</div>}
      {error && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: '#e5534b' }}>{error}</div>}

      {data && !loading && (
        <>
          {/* Net Equity banner */}
          <div style={{
            background: isPositive ? 'rgba(63,185,80,0.07)' : 'rgba(229,83,75,0.07)',
            border: `1px solid ${isPositive ? 'rgba(63,185,80,0.3)' : 'rgba(229,83,75,0.3)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: 28,
            display: 'flex',
            gap: 32,
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'Total Assets', value: data.totalAssets, color: 'var(--color-pillar-health)' },
              { label: 'Total Liabilities', value: data.totalLiabilities, color: '#e5534b' },
              { label: 'Net Equity', value: data.netEquity, color: isPositive ? 'var(--color-pillar-health)' : '#e5534b' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', fontWeight: 700, color }}>{fmt(value)}</div>
              </div>
            ))}
          </div>

          <Section title="Assets" entries={assets} total={data.totalAssets} totalColor="var(--color-pillar-health)" onSave={handleSave} />
          <Section title="Liabilities" entries={liabilities} total={data.totalLiabilities} totalColor="#e5534b" onSave={handleSave} />

          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginTop: 8 }}>
            Click Edit on any row to update the balance. Balances are entered manually — pull from your latest bank statements and loan statements.
          </div>
        </>
      )}
    </div>
  )
}
