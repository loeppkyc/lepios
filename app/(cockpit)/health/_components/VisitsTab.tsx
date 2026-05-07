'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SPECIALTIES,
  type DoctorVisitRow,
  type PersonHandle,
  type Specialty,
} from '@/lib/health/types'
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
} from './HealthCommon'

const today = () => new Date().toISOString().slice(0, 10)

export function VisitsTab({ person, visits }: { person: PersonHandle; visits: DoctorVisitRow[] }) {
  const router = useRouter()
  const [visitDate, setVisitDate] = useState(today())
  const [doctorName, setDoctorName] = useState('')
  const [specialty, setSpecialty] = useState<Specialty>('Family Doctor / GP')
  const [clinic, setClinic] = useState('')
  const [reason, setReason] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [outcome, setOutcome] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!doctorName.trim()) {
      setStatus({ tone: 'error', message: 'Enter a doctor name' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/doctor-visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          visit_date: visitDate,
          doctor_name: doctorName,
          specialty,
          clinic,
          reason,
          diagnosis,
          outcome,
          follow_up_date: followUp || null,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setDoctorName('')
        setClinic('')
        setReason('')
        setDiagnosis('')
        setOutcome('')
        setFollowUp('')
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

  async function deleteVisit(id: string) {
    if (!confirm('Delete this visit?')) return
    const res = await fetch(`/api/health/doctor-visits/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Doctor Visit">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
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
              <div style={labelStyle}>Doctor Name</div>
              <input
                type="text"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="e.g. Dr. Singh"
                style={inputStyle}
                required
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Specialty</div>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value as Specialty)}
                style={inputStyle}
              >
                {SPECIALTIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={labelStyle}>Clinic / Hospital</div>
              <input
                type="text"
                value={clinic}
                onChange={(e) => setClinic(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <label>
            <div style={labelStyle}>Reason for Visit</div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Annual checkup, follow-up on bloodwork, etc."
              style={inputStyle}
            />
          </label>
          <label>
            <div style={labelStyle}>Diagnosis / Findings</div>
            <textarea
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
            />
          </label>
          <label>
            <div style={labelStyle}>Outcome / Treatment</div>
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: 'var(--font-ui)' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Follow-up Date (optional)</div>
              <input
                type="date"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
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

      {visits.length === 0 ? (
        <EmptyState message="No doctor visits logged yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visits.map((v) => (
            <div key={v.id} style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <span style={sectionTitle}>{v.visit_date}</span>{' '}
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      fontWeight: 600,
                    }}
                  >
                    {v.doctor_name}
                  </span>
                  {v.specialty && (
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-disabled)',
                        marginLeft: 8,
                      }}
                    >
                      ({v.specialty})
                    </span>
                  )}
                </div>
                <button onClick={() => deleteVisit(v.id)} style={buttonDanger}>
                  Delete
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <div>
                  <strong style={{ color: 'var(--color-text-disabled)' }}>Clinic:</strong>{' '}
                  {v.clinic || '—'}
                </div>
                <div>
                  <strong style={{ color: 'var(--color-text-disabled)' }}>Follow-up:</strong>{' '}
                  {v.follow_up_date || '—'}
                </div>
              </div>
              {v.reason && (
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <strong style={{ color: 'var(--color-text-disabled)' }}>Reason:</strong>{' '}
                  {v.reason}
                </div>
              )}
              {v.diagnosis && (
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    Diagnosis / Findings
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {v.diagnosis}
                  </p>
                </div>
              )}
              {v.outcome && (
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    Outcome / Treatment
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {v.outcome}
                  </p>
                </div>
              )}
              {v.notes && (
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  Notes: {v.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
