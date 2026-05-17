'use client'

import { useEffect, useState } from 'react'

interface BalanceRow {
  id: string
  name: string
  account_type: string
  category: string
  lepios_balance: number
  lepios_as_of: string
  freshness: 'fresh' | 'aging' | 'stale'
  qbo_balance: number | null
  variance: number | null
  qbo_account_id: string | null
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtVariance(n: number) {
  const abs = Math.abs(n)
  const formatted = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(abs)
  return n === 0 ? '—' : n > 0 ? `+${formatted}` : `-${formatted}`
}

const FRESHNESS_COLOR: Record<BalanceRow['freshness'], string> = {
  fresh: 'var(--color-positive)',
  aging: '#f5a623',
  stale: 'var(--color-critical)',
}

const PERSONAL_CATEGORIES = new Set(['personal_bank', 'personal_investment'])

export function AccountsList() {
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    fetch('/api/position/balances')
      .then((r) => r.json())
      .then((d: { rows: BalanceRow[]; error?: string }) => {
        if (d.error) { setError(d.error); return }
        setRows(d.rows ?? [])
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function saveEdit(id: string) {
    const balance = parseFloat(editValue.replace(/[^0-9.-]/g, ''))
    if (isNaN(balance)) return
    setSaving(true)
    try {
      const res = await fetch('/api/accounts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, balance }),
      })
      if (!res.ok) throw new Error('Save failed')
      setEditId(null)
      setLoading(true)
      load()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const businessRows = rows.filter((r) => !PERSONAL_CATEGORIES.has(r.category))
  const personalRows = rows.filter((r) => PERSONAL_CATEGORIES.has(r.category))

  const businessAssets = businessRows.filter((r) => r.account_type === 'asset')
  const liabilities = businessRows.filter((r) => r.account_type === 'liability')

  const panelStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '20px 24px',
  }

  const sectionLabel = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-label)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  }

  const colHead = {
    fontFamily: 'var(--font-ui)',
    fontSize: 11,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...panelStyle, minHeight: 160 }} />
        <div style={{ ...panelStyle, minHeight: 120 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...panelStyle, color: 'var(--color-critical)', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)' }}>
        {error}
      </div>
    )
  }

  function renderRow(r: BalanceRow) {
    const isEditing = editId === r.id
    const varColor = r.variance === null ? 'var(--color-text-muted)'
      : r.variance === 0 ? 'var(--color-positive)'
      : 'var(--color-critical)'

    return (
      <div
        key={r.id}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 90px 80px 60px',
          alignItems: 'center',
          paddingBlock: 10,
          borderBottom: '1px solid var(--color-border)',
          gap: 8,
        }}
      >
        {/* Name + freshness dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            title={r.freshness}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              backgroundColor: FRESHNESS_COLOR[r.freshness],
            }}
          />
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)', color: 'var(--color-text-primary)' }}>
            {r.name}
          </span>
        </div>

        {/* LepiOS balance — editable */}
        <div style={{ textAlign: 'right' }}>
          {isEditing ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              style={{
                width: '100%',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-body)',
                backgroundColor: 'var(--color-base)',
                border: '1px solid var(--color-pillar-money)',
                borderRadius: 4,
                padding: '2px 6px',
                color: 'var(--color-text-primary)',
                textAlign: 'right',
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(r.id)
                if (e.key === 'Escape') setEditId(null)
              }}
            />
          ) : (
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {fmt(r.lepios_balance)}
            </span>
          )}
        </div>

        {/* QBO balance */}
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)', color: 'var(--color-text-muted)' }}>
          {r.qbo_balance !== null ? fmt(r.qbo_balance) : '—'}
        </div>

        {/* Variance */}
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body)', color: varColor }}>
          {r.variance !== null ? fmtVariance(r.variance) : '—'}
        </div>

        {/* Edit / Save / Cancel */}
        <div style={{ textAlign: 'right' }}>
          {isEditing ? (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button
                disabled={saving}
                onClick={() => saveEdit(r.id)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 11,
                  padding: '2px 8px',
                  backgroundColor: 'var(--color-pillar-money)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => setEditId(null)}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 11,
                  padding: '2px 6px',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setEditId(r.id); setEditValue(String(r.lepios_balance)) }}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                padding: '2px 10px',
                backgroundColor: 'transparent',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          )}
        </div>
      </div>
    )
  }

  function renderSection(title: string, sectionRows: BalanceRow[]) {
    if (sectionRows.length === 0) return null
    return (
      <div style={{ marginBottom: 4 }}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>{title}</div>
        {sectionRows.map(renderRow)}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Business accounts */}
      <div style={panelStyle}>
        {/* Column headers */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 90px 80px 60px',
            gap: 8,
            paddingBottom: 10,
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 4,
          }}
        >
          <div style={{ ...colHead, paddingLeft: 15 }}>Account</div>
          <div style={{ ...colHead, textAlign: 'right' }}>LepiOS</div>
          <div style={{ ...colHead, textAlign: 'right' }}>QBO</div>
          <div style={{ ...colHead, textAlign: 'right' }}>Variance</div>
          <div />
        </div>
        {renderSection('Bank Accounts', businessAssets)}
        {renderSection('Cards & Debt', liabilities)}
      </div>

      {/* Personal accounts */}
      {personalRows.length > 0 && (
        <div style={panelStyle}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 90px 80px 60px',
              gap: 8,
              paddingBottom: 10,
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 4,
            }}
          >
            <div style={{ ...colHead, paddingLeft: 15 }}>Personal</div>
            <div style={{ ...colHead, textAlign: 'right' }}>LepiOS</div>
            <div style={{ ...colHead, textAlign: 'right' }}>QBO</div>
            <div style={{ ...colHead, textAlign: 'right' }}>Variance</div>
            <div />
          </div>
          {renderSection('Personal Accounts', personalRows)}
        </div>
      )}

      {/* Freshness legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
        {(['fresh', 'aging', 'stale'] as const).map((f) => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: FRESHNESS_COLOR[f], display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{f}</span>
          </div>
        ))}
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--color-text-muted)' }}>&lt;30d / 30–60d / 60+d</span>
      </div>
    </div>
  )
}
