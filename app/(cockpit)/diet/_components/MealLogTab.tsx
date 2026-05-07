'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MEALS, type Meal, type MealRow } from '@/lib/diet/types'
import { todaysTotals } from '@/lib/diet/helpers'
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
  tableCell,
  tableHeaderCell,
} from './DietCommon'

const today = () => new Date().toISOString().slice(0, 10)

function MacroCell({ label, value, unit }: { label: string; value: number; unit: string }) {
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
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            marginLeft: 4,
          }}
        >
          {unit}
        </span>
      </span>
    </div>
  )
}

export function MealLogTab({ meals }: { meals: MealRow[] }) {
  const router = useRouter()
  const [mealDate, setMealDate] = useState(today())
  const [meal, setMeal] = useState<Meal>('Breakfast')
  const [description, setDescription] = useState('')
  const [calories, setCalories] = useState<string>('')
  const [protein, setProtein] = useState<string>('')
  const [carbs, setCarbs] = useState<string>('')
  const [fat, setFat] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'ok' | 'error'
    message: string
  } | null>(null)

  const todayStr = today()
  const totals = todaysTotals(meals, todayStr)

  function asInt(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) {
      setSubmitStatus({ tone: 'error', message: 'Enter a description' })
      return
    }
    setSubmitting(true)
    setSubmitStatus(null)
    try {
      const res = await fetch('/api/diet/meals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          meal_date: mealDate,
          meal,
          description,
          calories: asInt(calories),
          protein_g: asInt(protein),
          carbs_g: asInt(carbs),
          fat_g: asInt(fat),
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setSubmitStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setDescription('')
        setCalories('')
        setProtein('')
        setCarbs('')
        setFat('')
        setNotes('')
        setSubmitStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setSubmitStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteMeal(id: string) {
    if (!confirm('Delete this meal entry?')) return
    const res = await fetch(`/api/diet/meals/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Meal">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Meal</div>
              <select
                value={meal}
                onChange={(e) => setMeal(e.target.value as Meal)}
                style={inputStyle}
              >
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <div style={labelStyle}>Description</div>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 2 eggs, 1 banana, oats with berries"
              style={inputStyle}
              required
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Calories</div>
              <input
                type="text"
                inputMode="numeric"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Protein (g)</div>
              <input
                type="text"
                inputMode="numeric"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Carbs (g)</div>
              <input
                type="text"
                inputMode="numeric"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Fat (g)</div>
              <input
                type="text"
                inputMode="numeric"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
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
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Log Meal'}
            </button>
            <StatusLine status={submitStatus} />
          </div>
        </form>
      </Disclosure>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
        }}
      >
        <MacroCell label={`Today · ${totals.count} meals`} value={totals.calories} unit="cal" />
        <MacroCell label="Protein" value={totals.protein_g} unit="g" />
        <MacroCell label="Carbs" value={totals.carbs_g} unit="g" />
        <MacroCell label="Fat" value={totals.fat_g} unit="g" />
      </div>

      {meals.length === 0 ? (
        <EmptyState message="No meals logged yet. v1.1 will add AI nutrition estimation." />
      ) : (
        <div style={cardStyle}>
          <span style={sectionTitle}>Recent Meals</span>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderCell}>Date</th>
                  <th style={tableHeaderCell}>Meal</th>
                  <th style={tableHeaderCell}>Description</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>Cal</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>P</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>C</th>
                  <th style={{ ...tableHeaderCell, textAlign: 'right' }}>F</th>
                  <th style={tableHeaderCell}></th>
                </tr>
              </thead>
              <tbody>
                {meals.map((m) => (
                  <tr key={m.id}>
                    <td style={tableCell}>{m.meal_date}</td>
                    <td style={tableCell}>{m.meal}</td>
                    <td style={{ ...tableCell, fontWeight: 600 }}>{m.description}</td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.calories ?? '—'}
                    </td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.protein_g ?? '—'}
                    </td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.carbs_g ?? '—'}
                    </td>
                    <td
                      style={{
                        ...tableCell,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.fat_g ?? '—'}
                    </td>
                    <td style={tableCell}>
                      <button onClick={() => deleteMeal(m.id)} style={buttonDanger}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
