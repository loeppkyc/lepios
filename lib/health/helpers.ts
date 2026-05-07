// Pure shaping helpers for the Health page — exported for unit-test coverage.

import type {
  CycleEntryRow,
  DoctorVisitRow,
  MedicationRow,
  SymptomRow,
  VitalRow,
  WorkoutRow,
} from './types'

// ── Symptoms ────────────────────────────────────────────────────────────────

export function splitActiveResolved(symptoms: SymptomRow[]): {
  active: SymptomRow[]
  resolved: SymptomRow[]
} {
  const active: SymptomRow[] = []
  const resolved: SymptomRow[] = []
  for (const s of symptoms) {
    if (s.resolved_on) resolved.push(s)
    else active.push(s)
  }
  return { active, resolved }
}

// ── Medications ─────────────────────────────────────────────────────────────

export function splitActiveInactive(meds: MedicationRow[]): {
  active: MedicationRow[]
  inactive: MedicationRow[]
} {
  const active: MedicationRow[] = []
  const inactive: MedicationRow[] = []
  for (const m of meds) {
    if (m.active) active.push(m)
    else inactive.push(m)
  }
  return { active, inactive }
}

// ── Doctor Visits ───────────────────────────────────────────────────────────

export function upcomingFollowUps(
  visits: DoctorVisitRow[],
  today: string = new Date().toISOString().slice(0, 10)
): DoctorVisitRow[] {
  return visits
    .filter((v) => v.follow_up_date && v.follow_up_date >= today)
    .sort((a, b) => (a.follow_up_date ?? '').localeCompare(b.follow_up_date ?? ''))
}

// ── Vitals ──────────────────────────────────────────────────────────────────

export function distinctVitalTypes(vitals: VitalRow[]): string[] {
  const set = new Set<string>()
  for (const v of vitals) if (v.vital_type) set.add(v.vital_type)
  return Array.from(set).sort()
}

export interface VitalChartPoint {
  date: string
  value: number
}

export function vitalSeries(vitals: VitalRow[], type: string): VitalChartPoint[] {
  return vitals
    .filter((v) => v.vital_type === type)
    .map((v) => ({ date: v.recorded_on, value: v.value }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Cycle & Endo ────────────────────────────────────────────────────────────

export interface CycleAvg {
  pain: number | null
  bloating: number | null
  energy: number | null
  count: number
}

export function cycleAverages(
  entries: CycleEntryRow[],
  days: number,
  asOf: Date = new Date()
): CycleAvg {
  const cutoff = new Date(asOf.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const recent = entries.filter((e) => e.entry_date >= cutoff)
  if (recent.length === 0) return { pain: null, bloating: null, energy: null, count: 0 }
  const avg = (col: keyof CycleEntryRow): number => {
    const nums = recent.map((e) => e[col]).filter((v): v is number => typeof v === 'number')
    if (nums.length === 0) return 0
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
  }
  return {
    pain: avg('pain_level'),
    bloating: avg('bloating'),
    energy: avg('energy'),
    count: recent.length,
  }
}

// ── Workouts ────────────────────────────────────────────────────────────────

export interface WorkoutSummary {
  totalSessions: number
  lastSessionDate: string | null
  lastIntensity: number | null
  byMuscle: Record<string, number>
}

export function workoutSummary(workouts: WorkoutRow[]): WorkoutSummary {
  const byMuscle: Record<string, number> = {}
  for (const w of workouts) {
    for (const m of w.muscle_groups ?? []) {
      byMuscle[m] = (byMuscle[m] ?? 0) + 1
    }
  }
  // workouts already ordered by workout_date DESC from query
  const last = workouts[0]
  return {
    totalSessions: workouts.length,
    lastSessionDate: last?.workout_date ?? null,
    lastIntensity: last?.intensity ?? null,
    byMuscle,
  }
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardCounts {
  activeMedications: number
  activeSymptoms: number
  doctorVisits: number
  workouts: number
  vitalsCount: number
  upcomingFollowUps: number
}

export function dashboardCounts(args: {
  symptoms: SymptomRow[]
  medications: MedicationRow[]
  visits: DoctorVisitRow[]
  vitals: VitalRow[]
  workouts: WorkoutRow[]
  today?: string
}): DashboardCounts {
  const today = args.today ?? new Date().toISOString().slice(0, 10)
  return {
    activeMedications: args.medications.filter((m) => m.active).length,
    activeSymptoms: args.symptoms.filter((s) => !s.resolved_on).length,
    doctorVisits: args.visits.length,
    workouts: args.workouts.length,
    vitalsCount: args.vitals.length,
    upcomingFollowUps: args.visits.filter((v) => v.follow_up_date && v.follow_up_date >= today)
      .length,
  }
}

// ── CSV export ──────────────────────────────────────────────────────────────

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k))
      return acc
    }, new Set())
  )

  const escape = (v: unknown): string => {
    if (v == null) return ''
    let s = String(v)
    if (Array.isArray(v)) s = v.join('; ')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      s = `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const headerLine = headers.map(escape).join(',')
  const bodyLines = rows.map((r) => headers.map((h) => escape(r[h])).join(','))
  return [headerLine, ...bodyLines].join('\n')
}
