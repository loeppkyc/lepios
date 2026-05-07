'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PersonHandle, SymptomRow } from '@/lib/health/types'
import { splitActiveResolved } from '@/lib/health/helpers'
import {
  buttonGhost,
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
} from './HealthCommon'

const today = () => new Date().toISOString().slice(0, 10)

export function SymptomsTab({
  person,
  symptoms,
}: {
  person: PersonHandle
  symptoms: SymptomRow[]
}) {
  const router = useRouter()
  const [startedOn, setStartedOn] = useState(today())
  const [symptom, setSymptom] = useState('')
  const [severity, setSeverity] = useState(5)
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  const { active, resolved } = splitActiveResolved(symptoms)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!symptom.trim()) {
      setStatus({ tone: 'error', message: 'Enter a symptom' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/symptoms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          started_on: startedOn,
          symptom,
          severity,
          duration,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setSymptom('')
        setDuration('')
        setNotes('')
        setStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function markResolved(id: string) {
    const res = await fetch(`/api/health/symptoms/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolved_on: today() }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Symptom">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Symptom</div>
              <input
                type="text"
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                placeholder="e.g. Headache, Fatigue, Chest pain"
                style={inputStyle}
                required
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Severity ({severity}/10)</div>
              <input
                type="range"
                min={1}
                max={10}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div style={labelStyle}>Duration</div>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 2 hrs, ongoing"
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
              placeholder="Triggers, location, associated symptoms"
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Symptom'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {symptoms.length === 0 ? (
        <EmptyState message="No symptoms logged yet." />
      ) : (
        <>
          {active.length > 0 && (
            <div style={cardStyle}>
              <span style={sectionTitle}>Active ({active.length})</span>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCell}>Started</th>
                      <th style={tableHeaderCell}>Symptom</th>
                      <th style={tableHeaderCell}>Severity</th>
                      <th style={tableHeaderCell}>Duration</th>
                      <th style={tableHeaderCell}>Notes</th>
                      <th style={tableHeaderCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => (
                      <tr key={s.id}>
                        <td style={tableCell}>{s.started_on}</td>
                        <td style={{ ...tableCell, fontWeight: 600 }}>{s.symptom}</td>
                        <td style={tableCell}>
                          <strong>{s.severity}</strong>/10
                        </td>
                        <td style={tableCell}>{s.duration || '—'}</td>
                        <td style={tableCell}>{s.notes || '—'}</td>
                        <td style={tableCell}>
                          <button onClick={() => markResolved(s.id)} style={buttonGhost}>
                            Resolved
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <Disclosure title={`Resolved (${resolved.length})`}>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCell}>Started</th>
                      <th style={tableHeaderCell}>Symptom</th>
                      <th style={tableHeaderCell}>Severity</th>
                      <th style={tableHeaderCell}>Duration</th>
                      <th style={tableHeaderCell}>Resolved</th>
                      <th style={tableHeaderCell}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map((s) => (
                      <tr key={s.id}>
                        <td style={tableCell}>{s.started_on}</td>
                        <td style={tableCell}>{s.symptom}</td>
                        <td style={tableCell}>{s.severity}/10</td>
                        <td style={tableCell}>{s.duration || '—'}</td>
                        <td style={tableCell}>{s.resolved_on}</td>
                        <td style={tableCell}>{s.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          )}
        </>
      )}
    </div>
  )
}
