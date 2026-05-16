'use client'

import { useEffect, useState, useCallback } from 'react'
import type { BalanceSheetEntry, BalanceSheetResponse } from '@/app/api/balance-sheet/route'

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 })
}

const CATEGORY_LABELS: Record<string, string> = {
  bank: 'Bank Accounts',
  cash: 'Cash',
  amazon: 'Amazon Receivable',
  prepaid: 'Prepaid Expenses',
  inventory: 'Inventory',
  equipment: 'Equipment & Vehicles',
  receivable: 'Receivables',
  personal_bank: 'Personal Banking',
  personal_investment: 'Personal Investments',
  credit_card: 'Credit Cards',
  loan: 'Loans',
  tax: 'Tax Payable',
  other: 'Other',
}

function EntryRow({
  entry,
  onSave,
  onDelete,
}: {
  entry: BalanceSheetEntry
  onSave: (id: string, balance: number, asOfDate: string, notes: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [balanceStr, setBalanceStr] = useState(String(entry.balance))
  const [asOfDate, setAsOfDate] = useState(entry.as_of_date)
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isAutoSync = entry.source === 'auto_sync'

  async function save() {
    const val = parseFloat(balanceStr)
    if (isNaN(val)) return
    setSaving(true)
    await onSave(entry.id, val, asOfDate, notes)
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await onDelete(entry.id)
    setDeleting(false)
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
          padding: '8px 12px 8px 0',
        }}
      >
        {entry.name}
        {isAutoSync && (
          <span className="text-muted-foreground/60 ring-border ml-2 inline-flex items-center rounded px-1 py-0.5 text-[10px] leading-none font-medium ring-1 ring-inset">
            auto
          </span>
        )}
      </td>
      <td style={{ padding: '8px 12px 8px 0', textAlign: 'right' }}>
        {editing && !isAutoSync ? (
          <input
            type="number"
            value={balanceStr}
            onChange={(e) => setBalanceStr(e.target.value)}
            style={{ ...inputStyle, width: 110, textAlign: 'right' }}
            autoFocus
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            {fmt(entry.balance)}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 12px 8px 0', textAlign: 'right' }}>
        {editing && !isAutoSync ? (
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            style={{ ...inputStyle, width: 130 }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {entry.as_of_date}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 12px 8px 0' }}>
        {editing && !isAutoSync ? (
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes…"
            style={{ ...inputStyle, width: '100%' }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            {entry.notes ?? ''}
          </span>
        )}
      </td>
      <td style={{ padding: '8px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {isAutoSync ? (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            —
          </span>
        ) : editing ? (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setEditing(false)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                padding: '3px 10px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
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
          </div>
        ) : (
          <div
            style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}
          >
            <button
              onClick={() => setEditing(true)}
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
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete this row"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                padding: '3px 8px',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: '#e5534b',
                cursor: deleting ? 'wait' : 'pointer',
                opacity: deleting ? 0.5 : 1,
              }}
            >
              {deleting ? '…' : '×'}
            </button>
          </div>
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
  onDelete,
}: {
  title: string
  entries: BalanceSheetEntry[]
  total: number
  totalColor: string
  onSave: (id: string, balance: number, asOfDate: string, notes: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const grouped = entries.reduce<Record<string, BalanceSheetEntry[]>>((acc, e) => {
    const cat = e.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(e)
    return acc
  }, {})

  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
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
              {['Account', 'Balance', 'As Of', 'Notes', ''].map((h, i) => (
                <th
                  key={h + i}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-disabled)',
                    padding: '8px 12px 8px 0',
                    textAlign: i === 1 || i === 2 ? 'right' : 'left',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).map(([cat, rows]) => (
              <>
                <tr
                  key={`cat-${cat}`}
                  style={{
                    background: 'color-mix(in srgb, var(--color-surface-2) 50%, transparent)',
                  }}
                >
                  <td
                    colSpan={5}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                      padding: '5px 12px 5px 0',
                    }}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </td>
                </tr>
                {rows.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onSave={onSave} onDelete={onDelete} />
                ))}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--color-border)' }}>
              <td
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  padding: '10px 12px 10px 0',
                }}
              >
                Total {title}
              </td>
              <td
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: totalColor,
                  textAlign: 'right',
                  padding: '10px 12px 10px 0',
                }}
              >
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

// Known categories for the Add Row form dropdown
const KNOWN_CATEGORIES = [
  'bank',
  'cash',
  'amazon',
  'prepaid',
  'inventory',
  'equipment',
  'receivable',
  'personal_bank',
  'personal_investment',
  'credit_card',
  'loan',
  'tax',
  'other',
]

function AddRowForm({
  onAdd,
  onCancel,
}: {
  onAdd: (fields: {
    name: string
    account_type: 'asset' | 'liability'
    category: string
    balance: number
    as_of_date: string
    notes: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [name, setName] = useState('')
  const [accountType, setAccountType] = useState<'asset' | 'liability'>('asset')
  const [category, setCategory] = useState('bank')
  const [customCategory, setCustomCategory] = useState('')
  const [balanceStr, setBalanceStr] = useState('0')
  const [asOfDate, setAsOfDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const effectiveCategory = category === '__custom__' ? customCategory.trim() : category

  async function handleSubmit() {
    const balance = parseFloat(balanceStr)
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    if (!effectiveCategory) {
      setErr('Category is required')
      return
    }
    if (!Number.isFinite(balance)) {
      setErr('Balance must be a number')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onAdd({
        name: name.trim(),
        account_type: accountType,
        category: effectiveCategory,
        balance,
        as_of_date: asOfDate,
        notes,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    padding: '6px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  const selectStyle: React.CSSProperties = { ...inputStyle }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-accent-gold)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
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
          color: 'var(--color-accent-gold)',
          marginBottom: 16,
        }}
      >
        Add Row
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Account Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. TD Business Chequing"
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Type *
          </label>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as 'asset' | 'liability')}
            style={selectStyle}
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
          </select>
        </div>
        <div>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Category *
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={selectStyle}
          >
            {KNOWN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </div>
        {category === '__custom__' && (
          <div>
            <label
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Custom Category *
            </label>
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="e.g. crypto"
              style={inputStyle}
            />
          </div>
        )}
        <div>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Balance *
          </label>
          <input
            type="number"
            step="0.01"
            value={balanceStr}
            onChange={(e) => setBalanceStr(e.target.value)}
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </div>
        <div>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            As Of
          </label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional…"
            style={inputStyle}
          />
        </div>
      </div>
      {err && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: '#e5534b',
            marginBottom: 12,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            padding: '6px 16px',
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 700,
            padding: '6px 16px',
            background: 'var(--color-accent-gold)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: '#000',
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Adding…' : 'Add Row'}
        </button>
      </div>
    </div>
  )
}

export function BalanceSheetPage() {
  const [data, setData] = useState<BalanceSheetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/balance-sheet')
      .then((r) => r.json())
      .then((d: BalanceSheetResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const handleSave = useCallback(
    async (id: string, balance: number, asOfDate: string, notes: string) => {
      await fetch('/api/balance-sheet', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, balance, as_of_date: asOfDate, notes }),
      })
      load()
    },
    [load]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/balance-sheet/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
          error?: string
        }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      load()
    },
    [load]
  )

  const handleAdd = useCallback(
    async (fields: {
      name: string
      account_type: 'asset' | 'liability'
      category: string
      balance: number
      as_of_date: string
      notes: string
    }) => {
      const res = await fetch('/api/balance-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const j = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`)
      setShowAddForm(false)
      load()
    },
    [load]
  )

  const assets = data?.entries.filter((e) => e.account_type === 'asset') ?? []
  const liabilities = data?.entries.filter((e) => e.account_type === 'liability') ?? []
  const isPositive = (data?.netEquity ?? 0) >= 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto' }}>
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
          Balance Sheet
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
            }}
          >
            Update each balance to reflect today&apos;s statement
          </span>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 700,
                padding: '6px 14px',
                background: 'var(--color-accent-gold)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: '#000',
                cursor: 'pointer',
              }}
            >
              + Add Row
            </button>
          )}
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

      {showAddForm && <AddRowForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />}

      {data && !loading && (
        <>
          {/* Net Equity banner */}
          <div
            style={{
              background: isPositive ? 'rgba(63,185,80,0.07)' : 'rgba(229,83,75,0.07)',
              border: `1px solid ${isPositive ? 'rgba(63,185,80,0.3)' : 'rgba(229,83,75,0.3)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '16px 20px',
              marginBottom: 28,
              display: 'flex',
              gap: 32,
              flexWrap: 'wrap',
            }}
          >
            {[
              {
                label: 'Total Assets',
                value: data.totalAssets,
                color: 'var(--color-pillar-health)',
              },
              { label: 'Total Liabilities', value: data.totalLiabilities, color: '#e5534b' },
              {
                label: 'Net Equity',
                value: data.netEquity,
                color: isPositive ? 'var(--color-pillar-health)' : '#e5534b',
              },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-disabled)',
                    marginBottom: 4,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    color,
                  }}
                >
                  {fmt(value)}
                </div>
              </div>
            ))}
          </div>

          <Section
            title="Assets"
            entries={assets}
            total={data.totalAssets}
            totalColor="var(--color-pillar-health)"
            onSave={handleSave}
            onDelete={handleDelete}
          />
          <Section
            title="Liabilities"
            entries={liabilities}
            total={data.totalLiabilities}
            totalColor="#e5534b"
            onSave={handleSave}
            onDelete={handleDelete}
          />

          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              marginTop: 8,
            }}
          >
            Click Edit on any row to update the balance. Rows marked <strong>auto</strong> are
            updated daily by the net-worth sync cron — manual edits are not needed.
          </div>
        </>
      )}
    </div>
  )
}
