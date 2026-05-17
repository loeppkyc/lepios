'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DietBundle } from '@/lib/diet/queries'
import { InventoryTab } from './InventoryTab'
import { ReceiptsTab } from './ReceiptsTab'
import { MealLogTab } from './MealLogTab'
import { WeightTab } from './WeightTab'
import { BiomarkersTab } from './BiomarkersTab'
import { ExportTab } from './ExportTab'
import { FoodCatalogTab } from './FoodCatalogTab'

const TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'meals', label: 'Meal Log' },
  { id: 'weight', label: 'Weight' },
  { id: 'biomarkers', label: 'Biomarkers' },
  { id: 'catalog', label: 'Food Catalog' },
  { id: 'export', label: 'Export' },
] as const

type TabId = (typeof TABS)[number]['id']

export function DietShell({ initialTab, bundle }: { initialTab: string; bundle: DietBundle }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const validInitial = TABS.some((t) => t.id === initialTab) ? (initialTab as TabId) : 'inventory'
  const [activeTab, setActiveTab] = useState<TabId>(validInitial)

  function setTab(t: TabId) {
    setActiveTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.replace(`/diet?${params.toString()}`, { scroll: false })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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

      <div>
        {activeTab === 'inventory' && <InventoryTab inventory={bundle.inventory} />}
        {activeTab === 'receipts' && <ReceiptsTab receipts={bundle.receipts} />}
        {activeTab === 'meals' && <MealLogTab meals={bundle.meals} />}
        {activeTab === 'weight' && <WeightTab weights={bundle.weights} />}
        {activeTab === 'biomarkers' && <BiomarkersTab biomarkers={bundle.biomarkers} />}
        {activeTab === 'catalog' && <FoodCatalogTab catalog={bundle.catalog} />}
        {activeTab === 'export' && <ExportTab bundle={bundle} />}
      </div>
    </div>
  )
}
