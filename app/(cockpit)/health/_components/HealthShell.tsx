'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { HealthBundle } from '@/lib/health/queries'
import { PERSON_HANDLES, PERSON_LABELS, type PersonHandle } from '@/lib/health/types'
import { HealthDashboard } from './HealthDashboard'
import { VitalsTab } from './VitalsTab'
import { SymptomsTab } from './SymptomsTab'
import { MedsTab } from './MedsTab'
import { VisitsTab } from './VisitsTab'
import { WorkoutsTab } from './WorkoutsTab'
import { CycleTab } from './CycleTab'
import { ExportTab } from './ExportTab'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'symptoms', label: 'Symptoms' },
  { id: 'meds', label: 'Medications' },
  { id: 'visits', label: 'Doctor Visits' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'cycle', label: 'Cycle & Endo' },
  { id: 'export', label: 'Export' },
] as const

type TabId = (typeof TABS)[number]['id']

export function HealthShell({
  person,
  initialTab,
  bundle,
}: {
  person: PersonHandle
  initialTab: string
  bundle: HealthBundle
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const validInitial = TABS.some((t) => t.id === initialTab) ? (initialTab as TabId) : 'dashboard'
  const [activeTab, setActiveTab] = useState<TabId>(validInitial)

  function setPerson(p: PersonHandle) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('p', p)
    params.set('tab', activeTab)
    startTransition(() => router.push(`/health?${params.toString()}`))
  }

  function setTab(t: TabId) {
    setActiveTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('p', person)
    params.set('tab', t)
    router.replace(`/health?${params.toString()}`, { scroll: false })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Person picker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-disabled)',
          }}
        >
          Viewing
        </span>
        {PERSON_HANDLES.map((p) => {
          const active = p === person
          return (
            <button
              key={p}
              onClick={() => setPerson(p)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.04em',
                padding: '6px 14px',
                background: active ? 'var(--color-pillar-health)' : 'var(--color-surface)',
                color: active ? 'var(--color-base)' : 'var(--color-text-muted)',
                border: `1px solid ${active ? 'var(--color-pillar-health)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {PERSON_LABELS[p]}
            </button>
          )
        })}
      </div>

      {/* Tab nav */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.04em',
                padding: '10px 16px',
                background: 'none',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--color-pillar-health)'
                  : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Active tab content */}
      <div>
        {activeTab === 'dashboard' && <HealthDashboard person={person} bundle={bundle} />}
        {activeTab === 'vitals' && <VitalsTab person={person} vitals={bundle.vitals} />}
        {activeTab === 'symptoms' && <SymptomsTab person={person} symptoms={bundle.symptoms} />}
        {activeTab === 'meds' && <MedsTab person={person} medications={bundle.medications} />}
        {activeTab === 'visits' && <VisitsTab person={person} visits={bundle.doctorVisits} />}
        {activeTab === 'workouts' && <WorkoutsTab person={person} workouts={bundle.workouts} />}
        {activeTab === 'cycle' && <CycleTab person={person} entries={bundle.cycleEntries} />}
        {activeTab === 'export' && <ExportTab person={person} bundle={bundle} />}
      </div>
    </div>
  )
}
