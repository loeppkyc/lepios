'use client'

import { useState, useRef } from 'react'
import { CATEGORIES, PAYMENT_METHODS } from '@/lib/types/expenses'
import type { ParsedTransaction } from '@/app/api/expenses/import/route'

interface ReviewRow {
  _id: string
  selected: boolean
  date: string
  vendor: string
  amount: number
  pretax: string
  taxAmount: string
  category: string
  notes: string
  bussPct: string
}

function toReviewRow(t: ParsedTransaction, idx: number): ReviewRow {
  const pretax = Math.round((t.amount / 1.05) * 100) / 100
  const tax = Math.round((t.amount - pretax) * 100) / 100
  const validCat = CATEGORIES.find((c) => c === t.suggested_category) ?? ''
  return {
    _id: `${idx}-${t.date}-${t.vendor}`,
    selected: true,
    date: t.date ?? '',
    vendor: t.vendor ?? '',
    amount: t.amount ?? 0,
    pretax: String(pretax),
    taxAmount: String(tax),
    category: validCat,
    notes: t.notes ?? '',
    bussPct: '100',
  }
}

const input = (extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  padding: '4px 6px',
  width: '100%',
  boxSizing: 'border-box',
  ...extra,
})

export function ImportPage() {
  const [account, setAccount] = useState<string>(PAYMENT_METHODS[0])
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  }

  function toggleAll(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected })))
  }

  async function handleParse() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setErr('Choose a CSV file first')
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('account', account)
      const r = await fetch('/api/expenses/import', { method: 'POST', body: fd })
      const j = (await r.json()) as {
        transactions?: ParsedTransaction[]
        truncated?: boolean
        error?: string
        raw?: string
      }
      if (!r.ok) throw new Error(j.error ?? 'Parse failed')
      setRows((j.transactions ?? []).map((t, i) => toReviewRow(t, i)))
      setTruncated(j.truncated ?? false)
      setStep('review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) {
      setErr('Select at least one row')
      return
    }
    const missing = selected.filter((r) => !r.category)
    if (missing.length > 0) {
      setErr(`${missing.length} row(s) have no category — assign before importing`)
      return
    }
    setErr(null)
    setImporting(true)
    try {
      const body = selected.map((r) => ({
        date: r.date,
        vendor: r.vendor.trim(),
        category: r.category,
        pretax: parseFloat(r.pretax) || 0,
        tax_amount: parseFloat(r.taxAmount) || 0,
        payment_method: account,
        notes: r.notes.trim(),
        business_use_pct: parseInt(r.bussPct) || 100,
      }))
      const res = await fetch('/api/expenses/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as { created?: number; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Import failed')
      setImportedCount(j.created ?? selected.length)
      setStep('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('upload')
    setRows([])
    setErr(null)
    setTruncated(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectedCount = rows.filter((r) => r.selected).length

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'var(--font-ui)' }}>
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
          Import Statement
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '6px 0 0',
          }}
        >
          Upload a bank or credit card CSV — Claude auto-categorizes each transaction
        </p>
      </div>

      {/* Error */}
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

      {/* ── UPLOAD STEP ── */}
      {step === 'upload' && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 28,
            maxWidth: 520,
          }}
        >
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--color-text-disabled)',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Account
            </label>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              style={{
                ...input(),
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--color-text-disabled)',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              CSV File
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                color: 'var(--color-text-muted)',
                width: '100%',
              }}
            />
            <div
              style={{
                fontSize: '0.68rem',
                color: 'var(--color-text-disabled)',
                marginTop: 6,
              }}
            >
              TD Bank, Amex, Capital One, CIBC — any CSV export works
            </div>
          </div>

          <button
            onClick={() => void handleParse()}
            disabled={loading}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '9px 22px',
              background: loading ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
              color: loading ? 'var(--color-text-disabled)' : '#000',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Parsing with Claude…' : 'Parse Statement'}
          </button>
        </div>
      )}

      {/* ── REVIEW STEP ── */}
      {step === 'review' && (
        <>
          {truncated && (
            <div
              style={{
                background: '#1e1a0e',
                border: '1px solid var(--color-accent-gold)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 14px',
                fontSize: '0.72rem',
                color: 'var(--color-accent-gold)',
                marginBottom: 14,
              }}
            >
              CSV was large — first 50,000 characters parsed. Upload the file in monthly chunks for
              full coverage.
            </div>
          )}

          {/* Controls bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                color: 'var(--color-text-muted)',
              }}
            >
              {rows.length} transactions · {selectedCount} selected
            </span>
            <button
              onClick={() => toggleAll(true)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.72rem',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              Select all
            </button>
            <button
              onClick={() => toggleAll(false)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.72rem',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              Deselect all
            </button>
            <button
              onClick={reset}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.72rem',
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-disabled)',
                padding: '4px 10px',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              ← New file
            </button>
          </div>

          {/* Review table */}
          <div
            style={{
              overflowX: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 18,
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {[
                    '',
                    'Date',
                    'Vendor',
                    'Bank $',
                    'Pretax',
                    'Tax',
                    'Category',
                    'Bus%',
                    'Notes',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'left',
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
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
                {rows.map((row) => (
                  <tr
                    key={row._id}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      background: row.selected ? 'transparent' : 'rgba(0,0,0,0.3)',
                      opacity: row.selected ? 1 : 0.45,
                    }}
                  >
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => updateRow(row._id, { selected: e.target.checked })}
                        style={{ accentColor: 'var(--color-accent-gold)', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', minWidth: 96 }}>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateRow(row._id, { date: e.target.value })}
                        style={input({ minWidth: 110 })}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', minWidth: 160 }}>
                      <input
                        value={row.vendor}
                        onChange={(e) => updateRow(row._id, { vendor: e.target.value })}
                        style={input({ minWidth: 150 })}
                      />
                    </td>
                    <td
                      style={{
                        padding: '4px 10px',
                        whiteSpace: 'nowrap',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      ${row.amount.toFixed(2)}
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="number"
                        value={row.pretax}
                        min={0}
                        step="0.01"
                        onChange={(e) => updateRow(row._id, { pretax: e.target.value })}
                        style={input({ width: 80 })}
                      />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="number"
                        value={row.taxAmount}
                        min={0}
                        step="0.01"
                        onChange={(e) => updateRow(row._id, { taxAmount: e.target.value })}
                        style={input({ width: 70 })}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', minWidth: 180 }}>
                      <select
                        value={row.category}
                        onChange={(e) => updateRow(row._id, { category: e.target.value })}
                        style={{
                          ...input(),
                          cursor: 'pointer',
                          color: row.category ? 'var(--color-text-primary)' : '#e5534b',
                        }}
                      >
                        <option value="">— pick —</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input
                        type="number"
                        value={row.bussPct}
                        min={0}
                        max={100}
                        onChange={(e) => updateRow(row._id, { bussPct: e.target.value })}
                        style={input({ width: 52 })}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', minWidth: 120 }}>
                      <input
                        value={row.notes}
                        onChange={(e) => updateRow(row._id, { notes: e.target.value })}
                        style={input({ minWidth: 110 })}
                        placeholder="optional"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import button */}
          <button
            onClick={() => void handleImport()}
            disabled={importing || selectedCount === 0}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '10px 28px',
              background:
                importing || selectedCount === 0
                  ? 'var(--color-surface-2)'
                  : 'var(--color-accent-gold)',
              color: importing || selectedCount === 0 ? 'var(--color-text-disabled)' : '#000',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: importing || selectedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {importing
              ? 'Importing…'
              : `Import ${selectedCount} expense${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </>
      )}

      {/* ── DONE STEP ── */}
      {step === 'done' && (
        <div
          style={{
            background: 'rgba(63, 185, 80, 0.08)',
            border: '1px solid rgba(63, 185, 80, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '28px 32px',
            maxWidth: 420,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '2rem',
              fontWeight: 700,
              color: 'var(--color-pillar-health)',
              marginBottom: 6,
            }}
          >
            {importedCount}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              marginBottom: 20,
            }}
          >
            expense{importedCount !== 1 ? 's' : ''} imported from {account}
          </div>
          <button
            onClick={reset}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '8px 20px',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}
