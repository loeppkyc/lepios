'use client'

import { useState, useMemo } from 'react'
import type { FoodCatalogRow } from '@/lib/diet/types'
import { INVENTORY_CATEGORIES } from '@/lib/diet/types'

const NUM = (v: number | null, unit = '') => (v != null ? `${Math.round(v)}${unit}` : '—')

const BADGE_COLORS: Record<string, string> = {
  open_food_facts: 'var(--color-pillar-money)',
  manual: 'var(--color-text-muted)',
  usda: 'var(--color-pillar-health)',
}

function NutritionBadge({ source }: { source: string }) {
  return (
    <span
      style={{
        fontSize: '0.6rem',
        fontFamily: 'var(--font-ui)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: BADGE_COLORS[source] ?? 'var(--color-text-muted)',
        border: `1px solid ${BADGE_COLORS[source] ?? 'var(--color-border)'}`,
        borderRadius: 3,
        padding: '1px 4px',
        whiteSpace: 'nowrap',
      }}
    >
      {source === 'open_food_facts' ? 'OFF' : source}
    </span>
  )
}

function NutritionRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 0',
        borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-small)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ExpandedPanel({ item }: { item: FoodCatalogRow }) {
  const serving = item.serving_size ? `${item.serving_size} ${item.serving_unit}` : 'per serving'

  return (
    <tr>
      <td
        colSpan={9}
        style={{
          background: 'var(--color-surface-2)',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px 24px',
            maxWidth: 480,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              marginBottom: 4,
              gridColumn: '1/-1',
            }}
          >
            Full nutrition — {serving}
          </div>
          <NutritionRow label="Calories" value={NUM(item.calories, ' kcal')} />
          <NutritionRow label="Protein" value={NUM(item.protein_g, 'g')} />
          <NutritionRow label="Total Fat" value={NUM(item.fat_g, 'g')} />
          <NutritionRow label="Saturated Fat" value={NUM(item.saturated_fat_g, 'g')} />
          <NutritionRow label="Carbohydrates" value={NUM(item.carbs_g, 'g')} />
          <NutritionRow label="Sugar" value={NUM(item.sugar_g, 'g')} />
          <NutritionRow label="Fiber" value={NUM(item.fiber_g, 'g')} />
          <NutritionRow label="Sodium" value={NUM(item.sodium_mg, ' mg')} />
          <NutritionRow label="Cholesterol" value={NUM(item.cholesterol_mg, ' mg')} />
        </div>
        {item.notes && (
          <div
            style={{
              marginTop: 8,
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
            }}
          >
            {item.notes}
          </div>
        )}
      </td>
    </tr>
  )
}

export function FoodCatalogTab({ catalog }: { catalog: FoodCatalogRow[] }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [staplesOnly, setStaplesOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return catalog.filter((item) => {
      if (staplesOnly && !item.is_household_staple) return false
      if (category !== 'All' && item.category !== category) return false
      if (search) {
        const q = search.toLowerCase()
        return item.name.toLowerCase().includes(q) || (item.brand ?? '').toLowerCase().includes(q)
      }
      return true
    })
  }, [catalog, search, category, staplesOnly])

  const inputStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    background: 'var(--color-surface-2)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 10px',
  }

  const thStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    padding: '8px 10px',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid var(--color-border)',
  }

  const tdStyle = {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-small)',
    color: 'var(--color-text-primary)',
    padding: '8px 10px',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search food or brand…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
          <option value="All">All categories</option>
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
          }}
        >
          <input
            type="checkbox"
            checked={staplesOnly}
            onChange={(e) => setStaplesOnly(e.target.checked)}
            style={{ accentColor: 'var(--color-pillar-health)', cursor: 'pointer' }}
          />
          Household staples only
        </label>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
          }}
        >
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {catalog.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            padding: '32px 0',
            textAlign: 'center',
          }}
        >
          No foods yet — run <code>node scripts/seed-food-catalog.mjs</code> to seed from Open Food
          Facts
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Brand</th>
                <th style={thStyle}>Category</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Cal</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Protein</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Carbs</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Sugar</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Fat</th>
                <th style={thStyle}>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isExpanded = expandedId === item.id
                return (
                  <>
                    <tr
                      key={item.id}
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? 'var(--color-surface-2)' : 'transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{item.name}</span>
                          {item.is_household_staple && (
                            <span
                              title="Household staple"
                              style={{ fontSize: '0.6rem', color: 'var(--color-pillar-health)' }}
                            >
                              ●
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                        {item.brand ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                        {item.category}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{NUM(item.calories)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{NUM(item.protein_g, 'g')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{NUM(item.carbs_g, 'g')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{NUM(item.sugar_g, 'g')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{NUM(item.fat_g, 'g')}</td>
                      <td style={tdStyle}>
                        <NutritionBadge source={item.source} />
                      </td>
                    </tr>
                    {isExpanded && <ExpandedPanel key={`${item.id}-panel`} item={item} />}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
