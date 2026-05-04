'use client'

import { useEffect, useState, useCallback } from 'react'
import type { MonthlyCloseResponse, MonthSummary } from '@/app/api/monthly-close/route'

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const s = {
  card: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
  } as React.CSSProperties,
}

function MonthCard({
  month,
  onClose,
  onReopen,
  saving,
}: {
  month: MonthSummary
  onClose: (m: MonthSummary) => void
  onReopen: (m: MonthSummary) => void
  saving: string | null
}) {
  const isCurrent = month.month === CURRENT_MONTH
  const isFuture = month.month > CURRENT_MONTH
  const hasData = month.expenseCount > 0 || month.revenue > 0
  const isSaving = saving === month.month

  const borderColor = month.closed
    ? 'rgba(63,185,80,0.5)'
    : isCurrent
      ? 'rgba(210,160,60,0.5)'
      : isFuture
        ? 'var(--color-border)'
        : hasData
          ? 'rgba(229,83,75,0.4)'
          : 'var(--color-border)'

  const statusLabel = month.closed ? 'Closed' : isFuture ? 'Upcoming' : isCurrent ? 'Open' : hasData ? 'Needs Close' : 'No Data'
  const statusColor = month.closed
    ? 'var(--color-pillar-health)'
    : isFuture
      ? 'var(--color-text-disabled)'
      : isCurrent
        ? 'var(--color-accent-gold)'
        : hasData
          ? '#e5534b'
          : 'var(--color-text-disabled)'

  return (
    <div
      style={{
        ...s.card,
        borderLeft: `3px solid ${borderColor}`,
        opacity: isFuture ? 0.5 : 1,
        padding: '14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {month.label.split(' ')[0]}
        </span>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Revenue</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: month.revenue > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)' }}>
            {month.revenue > 0 ? fmt(month.revenue) : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Expenses</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
            {month.expenseCount > 0 ? `${month.expenseCount} · ${fmt(month.expenseTotal)}` : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ITCs</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-accent-gold)' }}>
            {month.itcTotal > 0 ? fmt(month.itcTotal) : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Net</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', color: 'var(--color-text-primary)' }}>
            {(month.revenue > 0 || month.expenseTotal > 0) ? fmt(month.revenue - month.expenseTotal) : '—'}
          </div>
        </div>
      </div>

      {month.closed && month.closedAt && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginBottom: 8 }}>
          Closed {new Date(month.closedAt).toLocaleDateString('en-CA')}
          {month.closedNotes && ` · ${month.closedNotes}`}
        </div>
      )}

      {!isFuture && (
        <button
          onClick={() => month.closed ? onReopen(month) : onClose(month)}
          disabled={isSaving}
          style={{
            width: '100%',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            padding: '5px 0',
            background: month.closed ? 'none' : 'var(--color-pillar-health)',
            color: month.closed ? 'var(--color-text-disabled)' : '#000',
            border: month.closed ? '1px solid var(--color-border)' : 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? 'Saving…' : month.closed ? 'Reopen' : 'Close Month'}
        </button>
      )}
    </div>
  )
}

export function MonthlyClosePage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [data, setData] = useState<MonthlyCloseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [noteModal, setNoteModal] = useState<MonthSummary | null>(null)
  const [noteText, setNoteText] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/monthly-close?year=${year}`)
      .then(r => r.json())
      .then((d: MonthlyCloseResponse & { error?: string }) => {
        if (d.error) setError(d.error)
        else setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [year])

  useEffect(() => { load() }, [load])

  async function handleClose(month: MonthSummary) {
    setNoteModal(month)
    setNoteText('')
  }

  async function confirmClose() {
    if (!noteModal) return
    setSaving(noteModal.month)
    setNoteModal(null)
    await fetch('/api/monthly-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: noteModal.month, notes: noteText || undefined }),
    })
    setSaving(null)
    load()
  }

  async function handleReopen(month: MonthSummary) {
    setSaving(month.month)
    await fetch(`/api/monthly-close?month=${month.month}`, { method: 'DELETE' })
    setSaving(null)
    load()
  }

  const years = [CURRENT_YEAR, CURRENT_YEAR - 1]

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-pillar-money)' }}>
          Monthly Close
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)} style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-small)', padding: '4px 12px',
              background: y === year ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
              color: y === year ? '#000' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontWeight: y === year ? 700 : 400,
            }}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      {data && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Months Closed', value: data.closedCount, color: 'var(--color-pillar-health)' },
            { label: 'Months Open', value: data.openCount, color: '#e5534b' },
            { label: 'Months Remaining', value: 12 - data.closedCount - data.openCount, color: 'var(--color-text-disabled)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ ...s.card, flex: 1, padding: '12px 16px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
              <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-disabled)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: 'var(--color-text-disabled)' }}>Loading…</div>}
      {error && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', color: '#e5534b' }}>{error}</div>}

      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {data.months.map(month => (
            <MonthCard key={month.month} month={month} onClose={handleClose} onReopen={handleReopen} saving={saving} />
          ))}
        </div>
      )}

      {/* Note modal */}
      {noteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 24, width: 380 }}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              Close {noteModal.label}?
            </div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-nano)', color: 'var(--color-text-disabled)', marginBottom: 16 }}>
              This marks the month as reconciled. You can reopen it anytime.
            </div>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Optional notes (e.g. all receipts matched, statements filed)…"
              style={{
                width: '100%', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)',
                background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)',
                padding: '8px 10px', resize: 'vertical', minHeight: 72, marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setNoteModal(null)} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', padding: '6px 16px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmClose} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-small)', fontWeight: 700, padding: '6px 16px', background: 'var(--color-pillar-health)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', cursor: 'pointer' }}>
                Close Month
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
