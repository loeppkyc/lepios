'use client'

import type { HealthBundle } from '@/lib/health/queries'
import { PERSON_LABELS, type PersonHandle } from '@/lib/health/types'
import { dashboardCounts, splitActiveResolved, splitActiveInactive } from '@/lib/health/helpers'
import { cardStyle, labelStyle, sectionTitle, tableCell, tableHeaderCell } from './HealthCommon'

function CountCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={cardStyle}>
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-pillar-value)',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function HealthDashboard({
  person,
  bundle,
}: {
  person: PersonHandle
  bundle: HealthBundle
}) {
  const counts = dashboardCounts({
    symptoms: bundle.symptoms,
    medications: bundle.medications,
    visits: bundle.doctorVisits,
    vitals: bundle.vitals,
    workouts: bundle.workouts,
  })
  const { active: activeSymptoms } = splitActiveResolved(bundle.symptoms)
  const { active: activeMeds } = splitActiveInactive(bundle.medications)

  const everythingEmpty =
    counts.activeMedications +
      counts.activeSymptoms +
      counts.doctorVisits +
      counts.vitalsCount +
      counts.workouts ===
    0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        Overview · {PERSON_LABELS[person]}
      </span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
        }}
      >
        <CountCell label="Active Meds" value={counts.activeMedications} />
        <CountCell label="Active Symptoms" value={counts.activeSymptoms} />
        <CountCell label="Doctor Visits" value={counts.doctorVisits} />
        <CountCell label="Workouts" value={counts.workouts} />
        <CountCell label="Vitals Logged" value={counts.vitalsCount} />
        <CountCell label="Upcoming Follow-ups" value={counts.upcomingFollowUps} />
      </div>

      {everythingEmpty && (
        <div style={{ ...cardStyle, color: 'var(--color-text-disabled)' }}>
          No health records yet for {PERSON_LABELS[person]}. Use the tabs above to start logging.
        </div>
      )}

      {activeMeds.length > 0 && (
        <div style={cardStyle}>
          <span style={sectionTitle}>Current Medications ({activeMeds.length})</span>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={tableHeaderCell}>Medication</th>
                <th style={tableHeaderCell}>Dosage</th>
                <th style={tableHeaderCell}>Frequency</th>
                <th style={tableHeaderCell}>Started</th>
              </tr>
            </thead>
            <tbody>
              {activeMeds.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...tableCell, fontWeight: 600 }}>{m.medication}</td>
                  <td style={tableCell}>{m.dosage || '—'}</td>
                  <td style={tableCell}>{m.frequency || '—'}</td>
                  <td style={tableCell}>{m.start_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSymptoms.length > 0 && (
        <div style={cardStyle}>
          <span style={sectionTitle}>Active Symptoms ({activeSymptoms.length})</span>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={tableHeaderCell}>Started</th>
                <th style={tableHeaderCell}>Symptom</th>
                <th style={tableHeaderCell}>Severity</th>
                <th style={tableHeaderCell}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {activeSymptoms.map((s) => (
                <tr key={s.id}>
                  <td style={tableCell}>{s.started_on}</td>
                  <td style={{ ...tableCell, fontWeight: 600 }}>{s.symptom}</td>
                  <td style={tableCell}>
                    <strong>{s.severity}</strong>/10
                  </td>
                  <td style={tableCell}>{s.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
