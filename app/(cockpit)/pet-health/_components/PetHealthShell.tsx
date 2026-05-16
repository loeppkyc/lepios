'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PetBundle } from '../_lib/queries'
import { ProfilesTab } from './ProfilesTab'
import { VetVisitsTab } from './VetVisitsTab'
import { VaccinesTab } from './VaccinesTab'
import { MedsTab } from './MedsTab'
import { FoodSafetyTab } from './FoodSafetyTab'

const TABS = [
  { id: 'profiles', label: 'Profiles' },
  { id: 'vet-visits', label: 'Vet Visits' },
  { id: 'vaccines', label: 'Vaccines' },
  { id: 'meds', label: 'Medications' },
  { id: 'food-safety', label: 'Food Safety' },
] as const

type TabId = (typeof TABS)[number]['id']

const PILLAR_COLOR = 'var(--color-pillar-health)'

export function PetHealthShell({
  initialTab,
  bundle,
}: {
  initialTab: string
  bundle: PetBundle
}) {
  const router = useRouter()
  const validInitial = TABS.some((t) => t.id === initialTab)
    ? (initialTab as TabId)
    : 'profiles'
  const [activeTab, setActiveTab] = useState<TabId>(validInitial)

  function setTab(t: TabId) {
    setActiveTab(t)
    router.replace(`/pet-health?tab=${t}`, { scroll: false })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
                  ? `2px solid ${PILLAR_COLOR}`
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
        {activeTab === 'profiles' && <ProfilesTab pets={bundle.pets} />}
        {activeTab === 'vet-visits' && (
          <VetVisitsTab pets={bundle.pets} vetVisits={bundle.vetVisits} />
        )}
        {activeTab === 'vaccines' && (
          <VaccinesTab pets={bundle.pets} vaccinations={bundle.vaccinations} />
        )}
        {activeTab === 'meds' && (
          <MedsTab pets={bundle.pets} medications={bundle.medications} />
        )}
        {activeTab === 'food-safety' && <FoodSafetyTab />}
      </div>
    </div>
  )
}
