'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BiomarkerRow, BiomarkerStatus } from '@/lib/diet/types'
import { latestBiomarkerByMarker } from '@/lib/diet/helpers'
import {
  buttonDanger,
  buttonPrimary,
  cardStyle,
  Disclosure,
  EmptyState,
  inputStyle,
  labelStyle,
  sectionTitle,
  StatusLine,
  tableCell,
  tableHeaderCell,
} from './DietCommon'

const today = () => new Date().toISOString().slice(0, 10)

const STATUS_COLORS: Record<BiomarkerStatus, string> = {
  low: 'var(--color-pillar-money)',
  normal: 'var(--color-positive)',
  high: 'var(--color-critical)',
  unknown: 'var(--color-text-disabled)',
}

function StatusPill({ status }: { status: BiomarkerStatus }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '2px 8px',
        background: 'transparent',
        color: STATUS_COLORS[status],
        border: `1px solid ${STATUS_COLORS[status]}`,
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {status}
    </span>
  )
}

export function BiomarkersTab({ biomarkers }: { biomarkers: BiomarkerRow[] }) {
  const router = useRouter()
  const [recordedOn, setRecordedOn] = useState(today())
  const [marker, setMarker] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [refLow, setRefLow] = useState('')
  const [refHigh, setRefHigh] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)

  const latest = latestBiomarkerByMarker(biomarkers)

  function asNum(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!marker.trim()) {
      setSubmitStatus({ tone: 'error', message: 'Enter a marker name' })
      return
    }
    const v = Number(value)
    if (!Number.isFinite(v)) {
      setSubmitStatus({ tone: 'error', message: 'Value must be numeric' })
      return
    }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const res = await fetch('/api/diet/biomarkers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recorded_on: recordedOn,
          marker,
          value: v,
          unit,
          ref_low: asNum(refLow),
          ref_high: asNum(refHigh),
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setSubmitStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setMarker('')
        setValue('')
        setUnit('')
        setRefLow('')
        setRefHigh('')
        setNotes('')
        setSubmitStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setSubmitStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteBiomarker(id: string) {
    if (!confirm('Delete this biomarker entry?')) return
    const res = await fetch(`/api/diet/biomarkers/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Biomarker">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={recordedOn}
                onChange={(e) => setRecordedOn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Marker</div>
              <input
                type="text"
                value={marker}
                onChange={(e) => setMarker(e.target.value)}
                placeholder="e.g. Vitamin D, HbA1c, LDL, TSH"
                style={inputStyle}
                required
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Value</div>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Unit</div>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="ng/mL, %, mg/dL"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Ref Low</div>
              <input
                type="text"
                inputMode="decimal"
                value={refLow}
                onChange={(e) => setRefLow(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Ref High</div>
              <input
                type="text"
                inputMode="decimal"
                value={refHigh}
                onChange={(e) => setRefHigh(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <label>
            <div style={labelStyle}>Notes</div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Biomarker'}
            </button>
            <StatusLine status={submitStatus} />
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              Status (low/normal/high) auto-derives from value vs ref range.
            </span>
          </div>
        </form>
      </Disclosure>

      {latest.length > 0 && (
        <div style={cardStyle}>
          <span style={sectionTitle}>Latest by Marker</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {latest.map((b) => (
              <div
                key={b.id}
                style={{
                  background: 'var(--color-base)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ ...labelStyle, fontSize: 'var(--text-small)' }}>{b.marker}</span>
                  <StatusPill status={b.status} />
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-pillar-value)',
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {b.value}
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                      marginLeft: 4,
                    }}
                  >
                    {b.unit}
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  {b.recorded_on}
                  {(b.ref_low != null || b.ref_high != null) && (
                    <>
                      {' '}
                      · ref {b.ref_low != null ? b.ref_low : '—'}–
                      {b.ref_high != null ? b.ref_high : '—'}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {biomarkers.length === 0 ? (
        <EmptyState message="No biomarkers logged yet." />
      ) : (
        <div style={cardStyle}>
          <span style={sectionTitle}>All Entries ({biomarkers.length})</span>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderCell}>Date</th>
                  <th style={tableHeaderCell}>Marker</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>Value</th>
                  <th style={tableHeaderCell}>Unit</th>
                  <th style={tableHeaderCell}>Ref</th>
                  <th style={tableHeaderCell}>Status</th>
                  <th style={tableHeaderCell}>Notes</th>
                  <th style={tableHeaderCell}></th>
                </tr>
              </thead>
              <tbody>
                {biomarkers.map((b) => (
                  <tr key={b.id}>
                    <td style={tableCell}>{b.recorded_on}</td>
                    <td style={{ ...tableCell, fontWeight: 600 }}>{b.marker}</td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {b.value}
                    </td>
                    <td style={tableCell}>{b.unit}</td>
                    <td style={tableCell}>
                      {b.ref_low ?? '—'}–{b.ref_high ?? '—'}
                    </td>
                    <td style={tableCell}>
                      <StatusPill status={b.status} />
                    </td>
                    <td style={tableCell}>{b.notes || '—'}</td>
                    <td style={tableCell}>
                      <button onClick={() => deleteBiomarker(b.id)} style={buttonDanger}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
