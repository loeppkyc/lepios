'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PetRow, PetMedicationRow } from '../_lib/queries'
import { isMedActive } from '../_lib/queries'
import {
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
} from './PetCommon'

const today = () => new Date().toISOString().slice(0, 10)

const FREQUENCY_OPTIONS = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'Every other day',
  'Weekly',
  'As needed',
  'Other',
]

export function MedsTab({
  pets,
  medications,
}: {
  pets: PetRow[]
  medications: PetMedicationRow[]
}) {
  const router = useRouter()
  const [petId, setPetId] = useState(pets[0]?.id ?? '')
  const [medication, setMedication] = useState('')
  const [dosage, setDosage] = useState('')
  const [frequency, setFrequency] = useState('Once daily')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState('')
  const [prescribingVet, setPrescribingVet] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  if (pets.length === 0) {
    return <EmptyState message="Add a pet first before logging medications." />
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!petId) {
      setStatus({ tone: 'error', message: 'Select a pet' })
      return
    }
    if (!medication.trim()) {
      setStatus({ tone: 'error', message: 'Enter a medication name' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/pet/medications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pet_id: petId,
          medication: medication.trim(),
          dosage,
          frequency,
          start_date: startDate,
          end_date: endDate || null,
          prescribing_vet: prescribingVet,
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
        setPrescribingVet('')
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

  const todayStr = today()
  const petMap = new Map(pets.map((p) => [p.id, p]))

  // Split into active/inactive
  const active = medications.filter((m) => isMedActive(m.end_date, todayStr))
  const inactive = medications.filter((m) => !isMedActive(m.end_date, todayStr))

  function renderMedTable(rows: PetMedicationRow[]) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderCell}>Pet</th>
              <th style={tableHeaderCell}>Medication</th>
              <th style={tableHeaderCell}>Dosage</th>
              <th style={tableHeaderCell}>Frequency</th>
              <th style={tableHeaderCell}>Start</th>
              <th style={tableHeaderCell}>End</th>
              <th style={tableHeaderCell}>Prescribing Vet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td style={tableCell}>{petMap.get(m.pet_id)?.name ?? '—'}</td>
                <td style={{ ...tableCell, fontWeight: 600 }}>{m.medication}</td>
                <td style={tableCell}>{m.dosage || '—'}</td>
                <td style={tableCell}>{m.frequency || '—'}</td>
                <td style={tableCell}>{m.start_date}</td>
                <td style={tableCell}>{m.end_date || '—'}</td>
                <td style={tableCell}>{m.prescribing_vet || '—'}</td>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Pet</div>
              <select
                value={petId}
                onChange={(e) => setPetId(e.target.value)}
                style={inputStyle}
                required
              >
                {pets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={labelStyle}>Medication / Supplement</div>
              <input
                type="text"
                value={medication}
                onChange={(e) => setMedication(e.target.value)}
                placeholder="e.g. Apoquel, Heartworm Prevention"
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
                placeholder="e.g. 16mg, 1 tablet"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Frequency</div>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                style={inputStyle}
              >
                {FREQUENCY_OPTIONS.map((f) => (
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
            <label>
              <div style={labelStyle}>Prescribing Vet (optional)</div>
              <input
                type="text"
                value={prescribingVet}
                onChange={(e) => setPrescribingVet(e.target.value)}
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
              placeholder="Give with food, side effects to watch, etc."
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
              <span style={sectionTitle}>Active Medications ({active.length})</span>
              {renderMedTable(active)}
            </div>
          )}
          {inactive.length > 0 && (
            <Disclosure title={`Past medications (${inactive.length})`}>
              <div style={{ marginTop: 8 }}>{renderMedTable(inactive)}</div>
            </Disclosure>
          )}
        </>
      )}
    </div>
  )
}
