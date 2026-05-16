'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PetRow, PetVaccinationRow } from '../_lib/queries'
import { vaccineStatus, type VaccineStatus } from '../_lib/queries'
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

// Species-appropriate vaccine lists (20% better: correct by species)
const CAT_VACCINES = [
  'FVRCP (Core)',
  'Rabies',
  'FeLV (Feline Leukemia)',
  'FIV',
  'Bordetella',
  'Other',
]

const DOG_VACCINES = [
  'DHPP (Core)',
  'Rabies',
  'Bordetella',
  'Leptospirosis',
  'Lyme (Borrelia)',
  'Influenza (H3N2/H3N8)',
  'Other',
]

function getVaccineOptions(species: 'cat' | 'dog' | 'other'): string[] {
  if (species === 'cat') return CAT_VACCINES
  if (species === 'dog') return DOG_VACCINES
  return [...CAT_VACCINES, ...DOG_VACCINES]
}

const STATUS_COLORS: Record<VaccineStatus, string> = {
  overdue: 'var(--color-critical)',
  'due-soon': '#f59e0b',
  current: 'var(--color-pillar-health)',
}

const STATUS_LABELS: Record<VaccineStatus, string> = {
  overdue: 'OVERDUE',
  'due-soon': 'DUE SOON',
  current: 'Current',
}

function StatusBadge({ status }: { status: VaccineStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

export function VaccinesTab({
  pets,
  vaccinations,
}: {
  pets: PetRow[]
  vaccinations: PetVaccinationRow[]
}) {
  const router = useRouter()
  const [petId, setPetId] = useState(pets[0]?.id ?? '')
  const [givenDate, setGivenDate] = useState(today())
  const [vaccine, setVaccine] = useState('')
  const [nextDueDate, setNextDueDate] = useState('')
  const [clinic, setClinic] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  if (pets.length === 0) {
    return <EmptyState message="Add a pet first before logging vaccinations." />
  }

  const selectedPet = pets.find((p) => p.id === petId)
  const vaccineOptions = getVaccineOptions(selectedPet?.species ?? 'other')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!petId) {
      setStatus({ tone: 'error', message: 'Select a pet' })
      return
    }
    if (!vaccine.trim()) {
      setStatus({ tone: 'error', message: 'Select or enter a vaccine' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/pet/vaccinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pet_id: petId,
          given_date: givenDate,
          vaccine: vaccine.trim(),
          next_due_date: nextDueDate || null,
          clinic,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setVaccine('')
        setNextDueDate('')
        setClinic('')
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

  // Attach status to each vaccination and sort: overdue first, due-soon second, current last
  const todayStr = today()
  const withStatus = vaccinations.map((v) => ({
    ...v,
    status: vaccineStatus(v.next_due_date, todayStr),
  }))

  const overdue = withStatus.filter((v) => v.status === 'overdue')
  const dueSoon = withStatus.filter((v) => v.status === 'due-soon')
  const current = withStatus.filter((v) => v.status === 'current')
  const sorted = [...overdue, ...dueSoon, ...current]

  const petMap = new Map(pets.map((p) => [p.id, p]))

  function renderVaccineTable(rows: typeof sorted) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={tableHeaderCell}>Status</th>
              <th style={tableHeaderCell}>Pet</th>
              <th style={tableHeaderCell}>Vaccine</th>
              <th style={tableHeaderCell}>Given</th>
              <th style={tableHeaderCell}>Next Due</th>
              <th style={tableHeaderCell}>Clinic</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td style={tableCell}>
                  <StatusBadge status={v.status} />
                </td>
                <td style={{ ...tableCell, fontWeight: 600 }}>
                  {petMap.get(v.pet_id)?.name ?? '—'}
                </td>
                <td style={tableCell}>{v.vaccine}</td>
                <td style={tableCell}>{v.given_date}</td>
                <td style={tableCell}>{v.next_due_date ?? '—'}</td>
                <td style={tableCell}>{v.clinic || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Vaccination">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Pet</div>
              <select
                value={petId}
                onChange={(e) => {
                  setPetId(e.target.value)
                  setVaccine('')
                }}
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
              <div style={labelStyle}>Date Given</div>
              <input
                type="date"
                value={givenDate}
                onChange={(e) => setGivenDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Vaccine</div>
              <select
                value={vaccine}
                onChange={(e) => setVaccine(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="">— Select —</option>
                {vaccineOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Next Due Date (optional)</div>
              <input
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Clinic (optional)</div>
              <input
                type="text"
                value={clinic}
                onChange={(e) => setClinic(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Notes (optional)</div>
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
              {submitting ? 'Saving…' : 'Log Vaccination'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {vaccinations.length === 0 ? (
        <EmptyState message="No vaccinations logged yet." />
      ) : (
        <div style={cardStyle}>{renderVaccineTable(sorted)}</div>
      )}
    </div>
  )
}
