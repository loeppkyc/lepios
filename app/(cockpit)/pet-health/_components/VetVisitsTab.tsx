'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PetRow, VetVisitRow } from '../_lib/queries'
import {
  buttonPrimary,
  cardStyle,
  captionStyle,
  Disclosure,
  EmptyState,
  inputStyle,
  labelStyle,
  MetricRow,
  sectionTitle,
  StatusLine,
  tableCell,
  tableHeaderCell,
} from './PetCommon'

const today = () => new Date().toISOString().slice(0, 10)

function formatCad(value: number | null): string {
  if (value == null) return '—'
  return `$${value.toFixed(2)}`
}

// Per-pet cost summary: total spend + avg per visit (YTD based on visit_date)
function buildCostSummary(
  petId: string,
  visits: VetVisitRow[]
): { total: number; count: number; avg: number } {
  const currentYear = new Date().getFullYear().toString()
  const ytd = visits.filter(
    (v) => v.pet_id === petId && v.cost_cad != null && v.visit_date.startsWith(currentYear)
  )
  const total = ytd.reduce((sum, v) => sum + (v.cost_cad ?? 0), 0)
  const count = ytd.length
  return { total, count, avg: count > 0 ? total / count : 0 }
}

export function VetVisitsTab({
  pets,
  vetVisits,
}: {
  pets: PetRow[]
  vetVisits: VetVisitRow[]
}) {
  const router = useRouter()
  const [visitDate, setVisitDate] = useState(today())
  const [petId, setPetId] = useState(pets[0]?.id ?? '')
  const [clinic, setClinic] = useState('')
  const [vetName, setVetName] = useState('')
  const [reason, setReason] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [treatment, setTreatment] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [costCad, setCostCad] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  if (pets.length === 0) {
    return <EmptyState message="Add a pet first before logging vet visits." />
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!petId) {
      setStatus({ tone: 'error', message: 'Select a pet' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/pet/vet-visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pet_id: petId,
          visit_date: visitDate,
          clinic,
          vet_name: vetName,
          reason,
          diagnosis,
          treatment,
          follow_up_date: followUpDate || null,
          cost_cad: costCad ? parseFloat(costCad) : null,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setClinic('')
        setVetName('')
        setReason('')
        setDiagnosis('')
        setTreatment('')
        setFollowUpDate('')
        setCostCad('')
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

  // Group visits by pet
  const petMap = new Map(pets.map((p) => [p.id, p]))
  const visitsByPet = new Map<string, VetVisitRow[]>()
  for (const v of vetVisits) {
    const list = visitsByPet.get(v.pet_id) ?? []
    list.push(v)
    visitsByPet.set(v.pet_id, list)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Vet Visit">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                style={inputStyle}
              />
            </label>
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
              <div style={labelStyle}>Clinic</div>
              <input
                type="text"
                value={clinic}
                onChange={(e) => setClinic(e.target.value)}
                placeholder="e.g. Westside Animal Hospital"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Vet Name</div>
              <input
                type="text"
                value={vetName}
                onChange={(e) => setVetName(e.target.value)}
                placeholder="e.g. Dr. Patel"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Reason for Visit</div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Annual checkup, limping, etc."
                style={inputStyle}
              />
            </label>
          </div>
          <label>
            <div style={labelStyle}>Diagnosis / Findings</div>
            <textarea
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
            />
          </label>
          <label>
            <div style={labelStyle}>Treatment</div>
            <textarea
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Follow-up Date (optional)</div>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Cost (CAD)</div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costCad}
                onChange={(e) => setCostCad(e.target.value)}
                placeholder="e.g. 120.00"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Notes</div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Visit'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {vetVisits.length === 0 ? (
        <EmptyState message="No vet visits logged yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pets.map((pet) => {
            const visits = visitsByPet.get(pet.id) ?? []
            if (visits.length === 0) return null
            const summary = buildCostSummary(pet.id, vetVisits)
            return (
              <div key={pet.id} style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <span style={sectionTitle}>{pet.name}</span>
                  {summary.count > 0 && (
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                      <MetricRow
                        label="YTD spend"
                        value={formatCad(summary.total)}
                      />
                      <MetricRow
                        label="avg/visit"
                        value={formatCad(summary.avg)}
                      />
                      <MetricRow label="visits" value={summary.count} />
                    </div>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCell}>Date</th>
                        <th style={tableHeaderCell}>Clinic</th>
                        <th style={tableHeaderCell}>Vet</th>
                        <th style={tableHeaderCell}>Reason</th>
                        <th style={tableHeaderCell}>Cost (CAD)</th>
                        <th style={tableHeaderCell}>Follow-up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visits.map((v) => (
                        <tr key={v.id}>
                          <td style={tableCell}>{v.visit_date}</td>
                          <td style={tableCell}>{v.clinic || '—'}</td>
                          <td style={tableCell}>{v.vet_name || '—'}</td>
                          <td style={tableCell}>{v.reason || '—'}</td>
                          <td style={{ ...tableCell, fontWeight: 600 }}>
                            {formatCad(v.cost_cad)}
                          </td>
                          <td style={tableCell}>{v.follow_up_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
