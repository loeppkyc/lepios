// Server-side queries for the Health module.
// All queries scope to a single person_handle (the page's selected person).

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CycleEntryRow,
  DoctorVisitRow,
  MedicationRow,
  PersonHandle,
  SymptomRow,
  VitalRow,
  WorkoutRow,
} from './types'

const VITALS_COLUMNS =
  'id, person_handle, recorded_on, vital_type, value, unit, notes, created_at, updated_at'
const SYMPTOMS_COLUMNS =
  'id, person_handle, started_on, symptom, severity, duration, resolved_on, notes, created_at, updated_at'
const MEDICATIONS_COLUMNS =
  'id, person_handle, medication, dosage, frequency, start_date, end_date, prescribing_doctor, pharmacy, active, notes, created_at, updated_at'
const DOCTOR_VISITS_COLUMNS =
  'id, person_handle, visit_date, doctor_name, specialty, clinic, reason, diagnosis, outcome, follow_up_date, notes, created_at, updated_at'
const WORKOUTS_COLUMNS =
  'id, person_handle, workout_date, exercise, muscle_groups, intensity, notes, created_at, updated_at'
const CYCLE_ENTRIES_COLUMNS =
  'id, person_handle, entry_date, cycle_day, pain_level, pain_locations, bloating, energy, mood, sleep_quality, bowel_status, foods, supplements, notes, created_at, updated_at'

export interface HealthBundle {
  vitals: VitalRow[]
  symptoms: SymptomRow[]
  medications: MedicationRow[]
  doctorVisits: DoctorVisitRow[]
  workouts: WorkoutRow[]
  cycleEntries: CycleEntryRow[]
}

export async function fetchHealthBundle(
  supabase: SupabaseClient,
  person: PersonHandle
): Promise<HealthBundle> {
  const [vitals, symptoms, medications, doctorVisits, workouts, cycleEntries] = await Promise.all([
    supabase
      .from('vitals')
      .select(VITALS_COLUMNS)
      .eq('person_handle', person)
      .order('recorded_on', { ascending: false }),
    supabase
      .from('symptoms')
      .select(SYMPTOMS_COLUMNS)
      .eq('person_handle', person)
      .order('started_on', { ascending: false }),
    supabase
      .from('medications')
      .select(MEDICATIONS_COLUMNS)
      .eq('person_handle', person)
      .order('start_date', { ascending: false }),
    supabase
      .from('doctor_visits')
      .select(DOCTOR_VISITS_COLUMNS)
      .eq('person_handle', person)
      .order('visit_date', { ascending: false }),
    supabase
      .from('workouts')
      .select(WORKOUTS_COLUMNS)
      .eq('person_handle', person)
      .order('workout_date', { ascending: false }),
    supabase
      .from('cycle_entries')
      .select(CYCLE_ENTRIES_COLUMNS)
      .eq('person_handle', person)
      .order('entry_date', { ascending: false }),
  ])

  return {
    vitals: ((vitals.data ?? []) as VitalRow[]) ?? [],
    symptoms: ((symptoms.data ?? []) as SymptomRow[]) ?? [],
    medications: ((medications.data ?? []) as MedicationRow[]) ?? [],
    doctorVisits: ((doctorVisits.data ?? []) as DoctorVisitRow[]) ?? [],
    workouts: ((workouts.data ?? []) as WorkoutRow[]) ?? [],
    cycleEntries: ((cycleEntries.data ?? []) as CycleEntryRow[]) ?? [],
  }
}
