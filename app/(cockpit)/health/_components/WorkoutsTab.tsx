'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  EXERCISE_MAP,
  EXERCISE_NAMES,
  MUSCLE_GROUPS,
  type MuscleGroup,
  type PersonHandle,
  type WorkoutRow,
} from '@/lib/health/types'
import { workoutSummary } from '@/lib/health/helpers'
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
} from './HealthCommon'

const today = () => new Date().toISOString().slice(0, 10)

export function WorkoutsTab({
  person,
  workouts,
}: {
  person: PersonHandle
  workouts: WorkoutRow[]
}) {
  const router = useRouter()
  const [workoutDate, setWorkoutDate] = useState(today())
  const [exercise, setExercise] = useState<string>(EXERCISE_NAMES[0] ?? 'Push-ups')
  const [customExercise, setCustomExercise] = useState('')
  const [selectedMuscles, setSelectedMuscles] = useState<Set<MuscleGroup>>(
    () => new Set(EXERCISE_MAP[EXERCISE_NAMES[0] ?? 'Push-ups'] ?? [])
  )
  const [intensity, setIntensity] = useState(7)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  const summary = workoutSummary(workouts)
  const isCustom = exercise === 'Other (type below)'

  function pickExercise(e: string) {
    setExercise(e)
    if (EXERCISE_MAP[e]) {
      setSelectedMuscles(new Set(EXERCISE_MAP[e]))
    } else {
      setSelectedMuscles(new Set())
    }
  }

  function toggleMuscle(m: MuscleGroup) {
    setSelectedMuscles((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const exerciseName = isCustom ? customExercise.trim() : exercise
    if (!exerciseName) {
      setStatus({ tone: 'error', message: 'Enter an exercise name' })
      return
    }
    if (selectedMuscles.size === 0) {
      setStatus({ tone: 'error', message: 'Select at least one muscle group' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/health/workouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          person_handle: person,
          workout_date: workoutDate,
          exercise: exerciseName,
          muscle_groups: Array.from(selectedMuscles),
          intensity,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setNotes('')
        setCustomExercise('')
        setStatus({ tone: 'ok', message: 'Logged.' })
        router.refresh()
      }
    } catch (err) {
      setStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteWorkout(id: string) {
    if (!confirm('Delete this workout?')) return
    const res = await fetch(`/api/health/workouts/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Log Workout">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date</div>
              <input
                type="date"
                value={workoutDate}
                onChange={(e) => setWorkoutDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Exercise</div>
              <select
                value={exercise}
                onChange={(e) => pickExercise(e.target.value)}
                style={inputStyle}
              >
                {EXERCISE_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="Other (type below)">Other (type below)</option>
              </select>
            </label>
          </div>
          {isCustom && (
            <label>
              <div style={labelStyle}>Custom exercise name</div>
              <input
                type="text"
                value={customExercise}
                onChange={(e) => setCustomExercise(e.target.value)}
                style={inputStyle}
              />
            </label>
          )}
          <div>
            <div style={labelStyle}>Muscle Groups</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {MUSCLE_GROUPS.map((m) => {
                const active = selectedMuscles.has(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMuscle(m)}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      padding: '6px 12px',
                      background: active ? 'var(--color-pillar-health)' : 'var(--color-base)',
                      color: active ? 'var(--color-base)' : 'var(--color-text-muted)',
                      border: `1px solid ${
                        active ? 'var(--color-pillar-health)' : 'var(--color-border)'
                      }`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Intensity ({intensity}/10)</div>
              <input
                type="range"
                min={1}
                max={10}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                style={{ width: '100%' }}
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
              {submitting ? 'Saving…' : 'Log Workout'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {workouts.length === 0 ? (
        <EmptyState message="No workouts logged yet." />
      ) : (
        <>
          <div style={cardStyle}>
            <span style={sectionTitle}>Summary</span>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={labelStyle}>Total Sessions</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-pillar-value)',
                    color: 'var(--color-text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {summary.totalSessions}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Last Session</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-pillar-value)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {summary.lastSessionDate ?? '—'}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Last Intensity</div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-pillar-value)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {summary.lastIntensity != null ? `${summary.lastIntensity}/10` : '—'}
                </div>
              </div>
            </div>
            {Object.keys(summary.byMuscle).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {MUSCLE_GROUPS.map((m) => {
                  const count = summary.byMuscle[m] ?? 0
                  return (
                    <span
                      key={m}
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-nano)',
                        padding: '4px 10px',
                        background: 'var(--color-base)',
                        color:
                          count > 0 ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {m} · {count}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <span style={sectionTitle}>History</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderCell}>Date</th>
                    <th style={tableHeaderCell}>Exercise</th>
                    <th style={tableHeaderCell}>Muscle Groups</th>
                    <th style={tableHeaderCell}>Intensity</th>
                    <th style={tableHeaderCell}>Notes</th>
                    <th style={tableHeaderCell}></th>
                  </tr>
                </thead>
                <tbody>
                  {workouts.map((w) => (
                    <tr key={w.id}>
                      <td style={tableCell}>{w.workout_date}</td>
                      <td style={{ ...tableCell, fontWeight: 600 }}>{w.exercise}</td>
                      <td style={tableCell}>{(w.muscle_groups ?? []).join(', ')}</td>
                      <td style={tableCell}>{w.intensity}/10</td>
                      <td style={tableCell}>{w.notes || '—'}</td>
                      <td style={tableCell}>
                        <button onClick={() => deleteWorkout(w.id)} style={buttonDanger}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
