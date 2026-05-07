'use client'

import type { HealthBundle } from '@/lib/health/queries'
import { PERSON_LABELS, type PersonHandle } from '@/lib/health/types'
import { rowsToCsv } from '@/lib/health/helpers'
import { buttonPrimary, cardStyle, EmptyState, sectionTitle } from './HealthCommon'

interface Section {
  label: string
  rows: readonly Record<string, unknown>[]
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ExportTab({ person, bundle }: { person: PersonHandle; bundle: HealthBundle }) {
  const asRows = (xs: readonly unknown[]): readonly Record<string, unknown>[] =>
    xs as readonly Record<string, unknown>[]

  const sections: Section[] = [
    { label: 'Vitals', rows: asRows(bundle.vitals) },
    { label: 'Symptoms', rows: asRows(bundle.symptoms) },
    { label: 'Medications', rows: asRows(bundle.medications) },
    { label: 'Doctor Visits', rows: asRows(bundle.doctorVisits) },
    { label: 'Workouts', rows: asRows(bundle.workouts) },
    { label: 'Cycle & Endo', rows: asRows(bundle.cycleEntries) },
  ]

  const total = sections.reduce((acc, s) => acc + s.rows.length, 0)
  if (total === 0) {
    return <EmptyState message={`No records to export for ${PERSON_LABELS[person]}.`} />
  }

  function exportSection(label: string, rows: readonly Record<string, unknown>[]) {
    const csv = rowsToCsv([...rows])
    downloadCsv(`${person}_${label.toLowerCase().replace(/\s+/g, '_')}.csv`, csv)
  }

  function exportAll() {
    const allRows: Record<string, unknown>[] = []
    for (const s of sections) {
      for (const r of s.rows) allRows.push({ Section: s.label, ...r })
    }
    const csv = rowsToCsv(allRows)
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadCsv(`${person}_health_records_${dateStr}.csv`, csv)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <span style={sectionTitle}>Export — {PERSON_LABELS[person]}</span>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
          }}
        >
          Download any section as a CSV — useful for printing, emailing a doctor, or backing up. All
          records are filtered to the selected person.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {sections.map((s) => (
          <button
            key={s.label}
            onClick={() => exportSection(s.label, s.rows)}
            disabled={s.rows.length === 0}
            style={{
              ...cardStyle,
              cursor: s.rows.length === 0 ? 'not-allowed' : 'pointer',
              opacity: s.rows.length === 0 ? 0.4 : 1,
              alignItems: 'flex-start',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            >
              {s.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              {s.rows.length} row{s.rows.length === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>

      <button onClick={exportAll} style={{ ...buttonPrimary, alignSelf: 'flex-start' }}>
        Export All Combined ({total} rows)
      </button>
    </div>
  )
}
