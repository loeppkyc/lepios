'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FREQUENCIES,
  type Frequency,
  type MedicationRow,
  type PersonHandle,
} from '@/lib/health/types'
import { splitActiveInactive } from '@/lib/health/helpers'
import {
  buttonDanger,
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

export function MedsTab({
  person,
  medications,
}: {
  person: PersonHandle
  medications: MedicationRow[]
}) {
  const router = useRouter()
  const [medication, setMedication] = useState('')
  const [dosage, setDosage] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('Daily')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState('')
  const [doctor, setDoctor] = useState('')
  const [pharmacy, setPharmacy] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  const { active, inactive } = splitActiveInactive(medications)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!medication.trim()) {
      setStatus({ tone: 'error', message: 'Enter a medication' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/medications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          medication,
          dosage,
          frequency,
          start_date: startDate,
          end_date: endDate || null,
          prescribing_doctor: doctor,
          pharmacy,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setMedication('')
        setDosage('')
        setEndDate('')
        setNotes('')
        setStatus({ tone: 'ok', message: 'Saved.' })
        router.refresh()
      }
    } catch (err) {
      setStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function stopMed(id: string) {
    const res = await fetch(`/api/health/medications/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: false, end_date: today() }),
    })
    if (res.ok) router.refresh()
  }

  async function deleteMed(id: string) {
    if (!confirm('Delete this medication entry?')) return
    const res = await fetch(`/api/health/medications/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  function renderMedTable(rows: MedicationRow[], kind: 'active' | 'inactive') {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderCell}>Medication</th>
              <th style={tableHeaderCell}>Dosage</th>
              <th style={tableHeaderCell}>Frequency</th>
              <th style={tableHeaderCell}>Start</th>
              <th style={tableHeaderCell}>End</th>
              <th style={tableHeaderCell}>Doctor</th>
              <th style={tableHeaderCell}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td style={{ ...tableCell, fontWeight: 600 }}>{m.medication}</td>
                <td style={tableCell}>{m.dosage || '—'}</td>
                <td style={tableCell}>{m.frequency || '—'}</td>
                <td style={tableCell}>{m.start_date}</td>
                <td style={tableCell}>{m.end_date || '—'}</td>
                <td style={tableCell}>{m.prescribing_doctor || '—'}</td>
                <td style={{ ...tableCell, display: 'flex', gap: 6 }}>
                  {kind === 'active' && (
                    <button onClick={() => stopMed(m.id)} style={buttonGhost}>
                      Stop
                    </button>
                  )}
                  <button onClick={() => deleteMed(m.id)} style={buttonDanger}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Add Medication">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Medication / Supplement</div>
              <input
                type="text"
                value={medication}
                onChange={(e) => setMedication(e.target.value)}
                placeholder="e.g. Metformin, Vitamin D3"
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Dosage</div>
              <input
                type="text"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 500mg, 2000 IU"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Frequency</div>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                style={inputStyle}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={labelStyle}>Start Date</div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>End Date (optional)</div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Prescribing Doctor (optional)</div>
              <input
                type="text"
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Pharmacy (optional)</div>
              <input
                type="text"
                value={pharmacy}
                onChange={(e) => setPharmacy(e.target.value)}
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
              placeholder="Reason, side effects, food interactions"
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Add Medication'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {medications.length === 0 ? (
        <EmptyState message="No medications logged yet." />
      ) : (
        <>
          {active.length > 0 && (
            <div style={cardStyle}>
              <span style={sectionTitle}>Current ({active.length})</span>
              {renderMedTable(active, 'active')}
            </div>
          )}
          {inactive.length > 0 && (
            <Disclosure title={`Past medications (${inactive.length})`}>
              <div style={{ marginTop: 8 }}>{renderMedTable(inactive, 'inactive')}</div>
            </Disclosure>
          )}
        </>
      )}
    </div>
  )
}
