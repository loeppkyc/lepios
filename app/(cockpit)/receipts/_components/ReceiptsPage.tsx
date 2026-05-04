'use client'

import { useEffect, useRef, useState, Fragment } from 'react'
import { CATEGORIES } from '@/lib/types/expenses'
import type { OcrResult, Receipt } from '@/lib/types/receipts'
import type { BusinessExpense } from '@/lib/types/expenses'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function allMonthsForYear(year: number) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

function monthLabel(yyyyMM: string) {
  const [y, m] = yyyyMM.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-CA', {
    month: 'long',
    year: 'numeric',
  })
}

function fmt(n: number | null) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: '20px 24px',
  } as React.CSSProperties,

  label: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    display: 'block',
    marginBottom: 4,
  } as React.CSSProperties,

  input: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,

  select: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,

  btnPrimary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '8px 20px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--color-pillar-money)',
    color: '#fff',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnSecondary: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    fontWeight: 600,
    padding: '7px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnDanger: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid color-mix(in srgb, var(--color-critical) 40%, transparent)',
    background: 'none',
    color: 'var(--color-critical)',
    cursor: 'pointer',
  } as React.CSSProperties,

  th: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-disabled)',
    padding: '0 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'left',
  } as React.CSSProperties,

  td: {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-secondary)',
    padding: '8px 10px 8px 0',
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,

  tdMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '8px 0 8px 0',
    borderBottom: '1px solid var(--color-border)',
    textAlign: 'right',
  } as React.CSSProperties,
}

// ── OcrForm — review / correct OCR result before saving ──────────────────────

interface OcrFormState {
  receiptDate: string
  vendor: string
  category: string
  pretax: string
  taxAmount: string
  notes: string
}

interface OcrFormProps {
  initial: OcrFormState
  onSave: (form: OcrFormState) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function OcrForm({ initial, onSave, onCancel, saving }: OcrFormProps) {
  const [f, setF] = useState<OcrFormState>(initial)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof OcrFormState>(key: K, val: OcrFormState[K]) {
    setF((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.vendor.trim()) {
      setErr('Vendor is required.')
      return
    }
    setErr(null)
    await onSave(f)
  }

  const gridTwo: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {err && (
        <div
          style={{
            color: 'var(--color-critical)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ ...gridTwo, marginBottom: 12 }}>
        <div>
          <label style={s.label}>Receipt Date</label>
          <input
            type="date"
            value={f.receiptDate}
            onChange={(e) => set('receiptDate', e.target.value)}
            style={s.input}
          />
        </div>
        <div>
          <label style={s.label}>Vendor</label>
          <input
            type="text"
            value={f.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            style={s.input}
            required
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={s.label}>Category</label>
        <select
          value={f.category}
          onChange={(e) => set('category', e.target.value)}
          style={s.select}
        >
          <option value="">— select —</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div style={{ ...gridTwo, marginBottom: 12 }}>
        <div>
          <label style={s.label}>Pre-Tax ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={f.pretax}
            onChange={(e) => set('pretax', e.target.value)}
            placeholder="0.00"
            style={s.input}
          />
        </div>
        <div>
          <label style={s.label}>GST / Tax ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={f.taxAmount}
            onChange={(e) => set('taxAmount', e.target.value)}
            placeholder="0.00"
            style={s.input}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={s.label}>Notes (optional)</label>
        <input
          type="text"
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          style={s.input}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={saving}
          style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Receipt'}
        </button>
        <button type="button" onClick={onCancel} style={s.btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── MatchPicker — inline expense selector for linking a receipt ───────────────

interface MatchPickerProps {
  receiptId: string
  month: string
  onMatched: () => void
  onCancel: () => void
}

function MatchPicker({ receiptId, month, onMatched, onCancel }: MatchPickerProps) {
  const [expenses, setExpenses] = useState<BusinessExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/expenses?month=${month}`)
      .then((r) => r.json() as Promise<{ expenses: BusinessExpense[] }>)
      .then((d) => {
        if (!cancelled) {
          setExpenses(d.expenses.filter((e) => !e.hubdoc))
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [month])

  async function handleLink() {
    if (!selectedId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId: selectedId }),
      })
      if (res.ok) onMatched()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{ padding: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      {loading ? (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading expenses…
        </span>
      ) : expenses.length === 0 ? (
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          No unmatched expenses for this month.
        </span>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ ...s.select, width: 'auto', minWidth: 280 }}
          >
            <option value="">— pick an expense —</option>
            {expenses.map((e) => (
              <option key={e.id} value={e.id}>
                {e.date} {e.vendor} ${e.pretax.toFixed(2)}
              </option>
            ))}
          </select>
          <button
            onClick={handleLink}
            disabled={!selectedId || saving}
            style={{
              ...s.btnPrimary,
              opacity: !selectedId || saving ? 0.5 : 1,
              padding: '7px 14px',
              fontSize: 'var(--text-nano)',
            }}
          >
            {saving ? 'Linking…' : 'Link'}
          </button>
        </>
      )}
      <button onClick={onCancel} style={s.btnSecondary}>
        Cancel
      </button>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Receipt['match_status'] }) {
  const styles: Record<Receipt['match_status'], React.CSSProperties> = {
    matched: {
      color: 'var(--color-positive, #4caf50)',
      borderColor: 'color-mix(in srgb, var(--color-positive, #4caf50) 35%, transparent)',
    },
    review: {
      color: 'var(--color-warning, #ff9800)',
      borderColor: 'color-mix(in srgb, var(--color-warning, #ff9800) 35%, transparent)',
    },
    unmatched: { color: 'var(--color-text-disabled)', borderColor: 'var(--color-border)' },
  }
  const labels = { matched: 'Matched', review: 'Review', unmatched: 'Unmatched' }
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid',
        ...styles[status],
      }}
    >
      {labels[status]}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'scanning' | 'review'

export function ReceiptsPage() {
  const currentYear = new Date().getFullYear()
  const months = allMonthsForYear(currentYear)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [month, setMonth] = useState(currentMonthStr)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loadingReceipts, setLoadingReceipts] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refetchKey, setRefetchKey] = useState(0)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanError, setScanError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [ocrForm, setOcrForm] = useState<OcrFormState | null>(null)
  const [saving, setSaving] = useState(false)

  const [matchingId, setMatchingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // ── Load receipts ──
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingReceipts(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/receipts?month=${month}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { receipts: Receipt[] }
        if (!cancelled) setReceipts(data.receipts)
      } catch (e: unknown) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingReceipts(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [month, refetchKey])

  // ── Scan a file ──
  async function handleFile(file: File) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.type)) {
      setScanError(`Unsupported file type. Upload JPEG, PNG, or WebP.`)
      return
    }
    if (file.size > 4.5 * 1024 * 1024) {
      setScanError('File is too large (max 4.5 MB). Compress the image first.')
      return
    }

    setScanError(null)
    setPendingFile(file)
    setScanState('scanning')

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/receipts/scan', { method: 'POST', body: fd })
      const body = (await res.json()) as OcrResult & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      setOcrForm({
        receiptDate: body.date ?? todayStr(),
        vendor: body.vendor ?? '',
        category:
          body.suggested_category &&
          CATEGORIES.includes(body.suggested_category as (typeof CATEGORIES)[number])
            ? body.suggested_category
            : '',
        pretax: body.pretax != null ? String(body.pretax) : '',
        taxAmount: body.tax_amount != null ? String(body.tax_amount) : '',
        notes: '',
      })
      setScanState('review')
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e))
      setScanState('idle')
      setPendingFile(null)
    }
  }

  // ── Save confirmed receipt ──
  async function handleSave(form: OcrFormState) {
    if (!pendingFile) return
    setSaving(true)
    try {
      const base64 = await toBase64(pendingFile)
      const body = {
        receiptDate: form.receiptDate || null,
        vendor: form.vendor,
        pretax: form.pretax ? parseFloat(form.pretax) : null,
        taxAmount: form.taxAmount ? parseFloat(form.taxAmount) : 0,
        total:
          form.pretax && form.taxAmount
            ? Math.round((parseFloat(form.pretax) + parseFloat(form.taxAmount)) * 100) / 100
            : form.pretax
              ? parseFloat(form.pretax)
              : null,
        category: form.category,
        notes: form.notes,
        fileBase64: base64,
        fileName: pendingFile.name,
        fileType: pendingFile.type,
      }
      const res = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setScanState('idle')
      setPendingFile(null)
      setOcrForm(null)
      setRefetchKey((k) => k + 1)
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Delete receipt ──
  async function handleDelete(id: string) {
    if (!confirm('Delete this receipt?')) return
    const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' })
    if (res.ok) setRefetchKey((k) => k + 1)
  }

  // ── Drag-drop handlers ──
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }
  function onDragLeave() {
    setDragging(false)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const unmatched = receipts.filter((r) => r.match_status === 'unmatched')
  const review = receipts.filter((r) => r.match_status === 'review')
  const matched = receipts.filter((r) => r.match_status === 'matched')

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
      {/* ── Header ── */}
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
          Receipts
        </span>
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value)
            setScanState('idle')
          }}
          style={{ ...s.select, width: 200 }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {/* ── Upload Zone ── */}
      <div style={{ ...s.card, marginBottom: 16 }}>
        {scanState === 'idle' && (
          <>
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? 'var(--color-pillar-money)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '32px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
                backgroundColor: dragging
                  ? 'color-mix(in srgb, var(--color-pillar-money) 4%, transparent)'
                  : 'transparent',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-muted)',
                  marginBottom: 6,
                }}
              >
                Drop receipt here or click to browse
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                JPEG · PNG · WebP · Max 4.5 MB
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
            {scanError && (
              <div
                style={{
                  marginTop: 10,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-critical)',
                }}
              >
                {scanError}
              </div>
            )}
          </>
        )}

        {scanState === 'scanning' && (
          <div
            style={{
              padding: '24px 0',
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
            }}
          >
            Scanning receipt with Claude Vision…
          </div>
        )}

        {scanState === 'review' && ocrForm && (
          <>
            <div
              style={{
                marginBottom: 14,
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
              }}
            >
              Review OCR Result — {pendingFile?.name}
            </div>
            <OcrForm
              initial={ocrForm}
              onSave={handleSave}
              onCancel={() => {
                setScanState('idle')
                setPendingFile(null)
                setOcrForm(null)
              }}
              saving={saving}
            />
          </>
        )}
      </div>

      {/* ── Receipts List ── */}
      <div style={s.card}>
        {loadingReceipts && (
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
        {fetchError && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-critical)',
            }}
          >
            Error: {fetchError}
          </div>
        )}
        {!loadingReceipts && !fetchError && receipts.length === 0 && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-disabled)',
            }}
          >
            No receipts uploaded for {monthLabel(month)} yet.
          </div>
        )}

        {!loadingReceipts && !fetchError && receipts.length > 0 && (
          <>
            {/* Summary counts */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
              {[
                { label: 'Total', count: receipts.length, color: 'var(--color-text-muted)' },
                {
                  label: 'Unmatched',
                  count: unmatched.length,
                  color:
                    unmatched.length > 0 ? 'var(--color-critical)' : 'var(--color-text-disabled)',
                },
                {
                  label: 'Review',
                  count: review.length,
                  color:
                    review.length > 0
                      ? 'var(--color-warning, #ff9800)'
                      : 'var(--color-text-disabled)',
                },
                {
                  label: 'Matched',
                  count: matched.length,
                  color: 'var(--color-positive, #4caf50)',
                },
              ].map(({ label, count, color }) => (
                <div key={label}>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-body)',
                      fontWeight: 700,
                      color,
                    }}
                  >
                    {count}
                  </div>
                </div>
              ))}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Vendor', 'Category', 'Pre-Tax', 'GST', 'Total', 'Status', ''].map(
                    (h) => (
                      <th key={h} style={{ ...s.th, textAlign: h === '' ? 'right' : 'left' }}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={{ ...s.td, fontFamily: 'var(--font-mono)' }}>
                        {r.receipt_date ?? r.upload_date}
                      </td>
                      <td style={s.td}>{r.vendor || '—'}</td>
                      <td
                        style={{
                          ...s.td,
                          color: 'var(--color-text-muted)',
                          maxWidth: 140,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.category || '—'}
                      </td>
                      <td style={s.tdMono}>${fmt(r.pretax)}</td>
                      <td style={{ ...s.tdMono, color: 'var(--color-text-muted)' }}>
                        ${fmt(r.tax_amount)}
                      </td>
                      <td style={{ ...s.tdMono, fontWeight: 700 }}>${fmt(r.total)}</td>
                      <td style={{ ...s.td, paddingLeft: 8 }}>
                        <StatusBadge status={r.match_status} />
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.match_status !== 'matched' && (
                          <button
                            onClick={() => setMatchingId(matchingId === r.id ? null : r.id)}
                            style={{
                              ...s.btnSecondary,
                              fontSize: 'var(--text-nano)',
                              padding: '3px 8px',
                              marginRight: 4,
                            }}
                          >
                            {matchingId === r.id ? 'Cancel' : 'Link'}
                          </button>
                        )}
                        {r.match_status === 'matched' && (
                          <button
                            onClick={async () => {
                              const res = await fetch(`/api/receipts/${r.id}/match`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ expenseId: null }),
                              })
                              if (res.ok) setRefetchKey((k) => k + 1)
                            }}
                            style={{
                              ...s.btnSecondary,
                              fontSize: 'var(--text-nano)',
                              padding: '3px 8px',
                              marginRight: 4,
                            }}
                          >
                            Unlink
                          </button>
                        )}
                        <button onClick={() => handleDelete(r.id)} style={s.btnDanger}>
                          Delete
                        </button>
                      </td>
                    </tr>

                    {/* Inline match picker */}
                    {matchingId === r.id && (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            padding: '0 0 8px 0',
                            borderBottom: '1px solid var(--color-border)',
                          }}
                        >
                          <MatchPicker
                            receiptId={r.id}
                            month={month}
                            onMatched={() => {
                              setMatchingId(null)
                              setRefetchKey((k) => k + 1)
                            }}
                            onCancel={() => setMatchingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
