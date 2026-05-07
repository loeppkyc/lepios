import { describe, it, expect } from 'vitest'
import {
  cycleAverages,
  dashboardCounts,
  distinctVitalTypes,
  rowsToCsv,
  splitActiveInactive,
  splitActiveResolved,
  upcomingFollowUps,
  vitalSeries,
  workoutSummary,
} from '@/lib/health/helpers'
import type {
  CycleEntryRow,
  DoctorVisitRow,
  MedicationRow,
  SymptomRow,
  VitalRow,
  WorkoutRow,
} from '@/lib/health/types'

function vital(over: Partial<VitalRow> = {}): VitalRow {
  return {
    id: 'v1',
    person_handle: 'colin',
    recorded_on: '2026-05-01',
    vital_type: 'Weight',
    value: 197,
    unit: 'lbs',
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function symptom(over: Partial<SymptomRow> = {}): SymptomRow {
  return {
    id: 's1',
    person_handle: 'colin',
    started_on: '2026-05-01',
    symptom: 'Headache',
    severity: 5,
    duration: '',
    resolved_on: null,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function med(over: Partial<MedicationRow> = {}): MedicationRow {
  return {
    id: 'm1',
    person_handle: 'colin',
    medication: 'Metformin',
    dosage: '500mg',
    frequency: 'Daily',
    start_date: '2026-04-01',
    end_date: null,
    prescribing_doctor: '',
    pharmacy: '',
    active: true,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function visit(over: Partial<DoctorVisitRow> = {}): DoctorVisitRow {
  return {
    id: 'd1',
    person_handle: 'colin',
    visit_date: '2026-05-01',
    doctor_name: 'Dr. Singh',
    specialty: '',
    clinic: '',
    reason: '',
    diagnosis: '',
    outcome: '',
    follow_up_date: null,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function workout(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 'w1',
    person_handle: 'colin',
    workout_date: '2026-05-01',
    exercise: 'Push-ups',
    muscle_groups: ['Chest', 'Arms'],
    intensity: 7,
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function cycleEntry(over: Partial<CycleEntryRow> = {}): CycleEntryRow {
  return {
    id: 'c1',
    person_handle: 'megan',
    entry_date: '2026-05-01',
    cycle_day: 5,
    pain_level: 4,
    pain_locations: [],
    bloating: 3,
    energy: 6,
    mood: 'Okay',
    sleep_quality: 7,
    bowel_status: 'Normal',
    foods: '',
    supplements: '',
    notes: '',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

describe('splitActiveResolved', () => {
  it('splits by resolved_on null/non-null', () => {
    const a = symptom({ id: 'a', resolved_on: null })
    const b = symptom({ id: 'b', resolved_on: '2026-05-02' })
    const { active, resolved } = splitActiveResolved([a, b])
    expect(active).toEqual([a])
    expect(resolved).toEqual([b])
  })
})

describe('splitActiveInactive', () => {
  it('splits by active flag', () => {
    const a = med({ id: 'a', active: true })
    const b = med({ id: 'b', active: false })
    const { active, inactive } = splitActiveInactive([a, b])
    expect(active).toEqual([a])
    expect(inactive).toEqual([b])
  })
})

describe('upcomingFollowUps', () => {
  it('returns only visits whose follow_up_date is today or later', () => {
    const today = '2026-05-07'
    const past = visit({ id: 'p', follow_up_date: '2026-04-01' })
    const todayVisit = visit({ id: 't', follow_up_date: today })
    const future = visit({ id: 'f', follow_up_date: '2026-06-01' })
    const none = visit({ id: 'n', follow_up_date: null })
    const out = upcomingFollowUps([past, todayVisit, future, none], today)
    expect(out.map((v) => v.id)).toEqual(['t', 'f'])
  })
})

describe('distinctVitalTypes', () => {
  it('dedupes and sorts', () => {
    const vs = [
      vital({ vital_type: 'Weight' }),
      vital({ vital_type: 'Heart Rate' }),
      vital({ vital_type: 'Weight' }),
    ]
    expect(distinctVitalTypes(vs)).toEqual(['Heart Rate', 'Weight'])
  })
})

describe('vitalSeries', () => {
  it('filters by type and sorts ascending by date', () => {
    const vs = [
      vital({ recorded_on: '2026-05-03', value: 197, vital_type: 'Weight' }),
      vital({ recorded_on: '2026-05-01', value: 200, vital_type: 'Weight' }),
      vital({ recorded_on: '2026-05-02', value: 65, vital_type: 'Heart Rate' }),
    ]
    expect(vitalSeries(vs, 'Weight')).toEqual([
      { date: '2026-05-01', value: 200 },
      { date: '2026-05-03', value: 197 },
    ])
  })
})

describe('cycleAverages', () => {
  it('returns nulls + 0 count when no entries in window', () => {
    const out = cycleAverages([], 30, new Date('2026-05-07'))
    expect(out).toEqual({ pain: null, bloating: null, energy: null, count: 0 })
  })

  it('averages entries within the trailing N days, rounded to 1 decimal', () => {
    const asOf = new Date('2026-05-07')
    const recent = [
      cycleEntry({ entry_date: '2026-05-01', pain_level: 4, bloating: 2, energy: 6 }),
      cycleEntry({ entry_date: '2026-05-05', pain_level: 6, bloating: 4, energy: 4 }),
    ]
    const stale = cycleEntry({ entry_date: '2026-01-01', pain_level: 10, bloating: 10, energy: 10 })
    const out = cycleAverages([...recent, stale], 30, asOf)
    expect(out).toEqual({ pain: 5, bloating: 3, energy: 5, count: 2 })
  })
})

describe('workoutSummary', () => {
  it('counts sessions and aggregates muscle hits', () => {
    const out = workoutSummary([
      workout({
        id: 'a',
        workout_date: '2026-05-05',
        muscle_groups: ['Chest', 'Arms'],
        intensity: 7,
      }),
      workout({ id: 'b', workout_date: '2026-05-01', muscle_groups: ['Legs'], intensity: 5 }),
    ])
    expect(out.totalSessions).toBe(2)
    expect(out.lastSessionDate).toBe('2026-05-05')
    expect(out.lastIntensity).toBe(7)
    expect(out.byMuscle).toEqual({ Chest: 1, Arms: 1, Legs: 1 })
  })

  it('handles empty array', () => {
    const out = workoutSummary([])
    expect(out.totalSessions).toBe(0)
    expect(out.lastSessionDate).toBeNull()
    expect(out.lastIntensity).toBeNull()
    expect(out.byMuscle).toEqual({})
  })
})

describe('dashboardCounts', () => {
  it('counts active rows correctly', () => {
    const today = '2026-05-07'
    const out = dashboardCounts({
      symptoms: [symptom({ resolved_on: null }), symptom({ resolved_on: '2026-05-02' })],
      medications: [med({ active: true }), med({ active: false })],
      visits: [visit({ follow_up_date: '2026-05-08' }), visit({ follow_up_date: '2026-04-01' })],
      vitals: [vital(), vital()],
      workouts: [workout()],
      today,
    })
    expect(out).toEqual({
      activeMedications: 1,
      activeSymptoms: 1,
      doctorVisits: 2,
      workouts: 1,
      vitalsCount: 2,
      upcomingFollowUps: 1,
    })
  })
})

describe('rowsToCsv', () => {
  it('returns empty string for empty', () => {
    expect(rowsToCsv([])).toBe('')
  })

  it('emits header + body, escaping commas and quotes', () => {
    const csv = rowsToCsv([{ a: 1, b: 'hello, "world"' }])
    expect(csv).toBe('a,b\n1,"hello, ""world"""')
  })

  it('joins arrays with semicolons', () => {
    const csv = rowsToCsv([{ tags: ['x', 'y'] }])
    expect(csv).toBe('tags\nx; y')
  })
})
