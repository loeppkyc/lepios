// Shared types + constants for the Health module.
// Mirrors streamlit_app/pages/8_Health.py constants verbatim where applicable.

export const PERSON_HANDLES = ['colin', 'megan', 'cora', 'sharon'] as const
export type PersonHandle = (typeof PERSON_HANDLES)[number]

export const PERSON_LABELS: Record<PersonHandle, string> = {
  colin: 'Colin',
  megan: 'Megan',
  cora: 'Cora',
  sharon: 'Sharon',
}

export function isPersonHandle(v: unknown): v is PersonHandle {
  return typeof v === 'string' && (PERSON_HANDLES as readonly string[]).includes(v)
}

// ── Vitals ──────────────────────────────────────────────────────────────────

// Streamlit reference: pages/8_Health.py:123-135 (VITAL_TYPES) + line 141-152 (_UNIT_MAP).
// BP is split into Systolic + Diastolic so values are always single NUMERIC.
export const VITAL_TYPES = [
  'Blood Pressure Systolic',
  'Blood Pressure Diastolic',
  'Weight',
  'Temperature',
  'Heart Rate',
  'Blood Sugar',
  'Oxygen Saturation',
  'Other',
] as const
export type VitalType = (typeof VITAL_TYPES)[number]

export const VITAL_DEFAULT_UNITS: Record<VitalType, string> = {
  'Blood Pressure Systolic': 'mmHg',
  'Blood Pressure Diastolic': 'mmHg',
  Weight: 'lbs',
  Temperature: '°C',
  'Heart Rate': 'bpm',
  'Blood Sugar': 'mmol/L',
  'Oxygen Saturation': '%',
  Other: '',
}

export interface VitalRow {
  id: string
  person_handle: PersonHandle
  recorded_on: string
  vital_type: string
  value: number
  unit: string
  notes: string
  created_at: string
  updated_at: string
}

// ── Symptoms ────────────────────────────────────────────────────────────────

export interface SymptomRow {
  id: string
  person_handle: PersonHandle
  started_on: string
  symptom: string
  severity: number
  duration: string
  resolved_on: string | null
  notes: string
  created_at: string
  updated_at: string
}

// ── Medications ─────────────────────────────────────────────────────────────

// Streamlit reference: pages/8_Health.py:137 (FREQUENCIES).
export const FREQUENCIES = [
  'Daily',
  'Twice daily',
  'Three times daily',
  'Weekly',
  'As needed',
  'Other',
] as const
export type Frequency = (typeof FREQUENCIES)[number]

export interface MedicationRow {
  id: string
  person_handle: PersonHandle
  medication: string
  dosage: string
  frequency: string
  start_date: string
  end_date: string | null
  prescribing_doctor: string
  pharmacy: string
  active: boolean
  notes: string
  created_at: string
  updated_at: string
}

// ── Doctor Visits ───────────────────────────────────────────────────────────

// Streamlit reference: pages/8_Health.py:138 (SPECIALTIES).
export const SPECIALTIES = [
  'Family Doctor / GP',
  'Specialist',
  'Emergency / Walk-in',
  'Dentist',
  'Optometrist',
  'Other',
] as const
export type Specialty = (typeof SPECIALTIES)[number]

export interface DoctorVisitRow {
  id: string
  person_handle: PersonHandle
  visit_date: string
  doctor_name: string
  specialty: string
  clinic: string
  reason: string
  diagnosis: string
  outcome: string
  follow_up_date: string | null
  notes: string
  created_at: string
  updated_at: string
}

// ── Workouts ────────────────────────────────────────────────────────────────

// Streamlit reference: pages/8_Health.py:75 (MUSCLE_GROUPS) + 77-111 (EXERCISE_MAP).
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Legs',
  'Shoulders',
  'Arms',
  'Core',
  'Cardio',
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

export const EXERCISE_MAP: Record<string, readonly MuscleGroup[]> = {
  'Push-ups': ['Chest', 'Arms', 'Core'],
  'Bench Press': ['Chest', 'Arms', 'Shoulders'],
  'Incline Press': ['Chest', 'Arms', 'Shoulders'],
  Dips: ['Chest', 'Arms', 'Shoulders'],
  'Pull-ups': ['Back', 'Arms'],
  'Chin-ups': ['Back', 'Arms'],
  Rows: ['Back', 'Arms'],
  'Lat Pulldown': ['Back', 'Arms'],
  Deadlift: ['Back', 'Legs', 'Core'],
  Squats: ['Legs', 'Core'],
  Lunges: ['Legs', 'Core'],
  'Leg Press': ['Legs'],
  'Leg Curls': ['Legs'],
  'Leg Extensions': ['Legs'],
  'Calf Raises': ['Legs'],
  'Overhead Press': ['Shoulders', 'Arms'],
  'Lateral Raises': ['Shoulders'],
  'Face Pulls': ['Shoulders', 'Back'],
  'Bicep Curls': ['Arms'],
  'Tricep Extensions': ['Arms'],
  'Hammer Curls': ['Arms'],
  Planks: ['Core'],
  Crunches: ['Core'],
  'Russian Twists': ['Core'],
  'Leg Raises': ['Core'],
  Running: ['Legs', 'Cardio', 'Core'],
  Cycling: ['Legs', 'Cardio'],
  Swimming: ['Cardio', 'Back', 'Shoulders'],
  Walking: ['Legs', 'Cardio'],
  'Jump Rope': ['Cardio', 'Legs', 'Core'],
  'Rowing Machine': ['Cardio', 'Back', 'Arms'],
  Elliptical: ['Cardio', 'Legs'],
  HIIT: ['Cardio', 'Legs', 'Core'],
}

export const EXERCISE_NAMES = Object.keys(EXERCISE_MAP).sort()

export interface WorkoutRow {
  id: string
  person_handle: PersonHandle
  workout_date: string
  exercise: string
  muscle_groups: string[]
  intensity: number
  notes: string
  created_at: string
  updated_at: string
}

// ── Cycle & Endo ────────────────────────────────────────────────────────────

// Streamlit reference: pages/8_Health.py:1430-1436.
export const ENDO_PAIN_LOCATIONS = [
  'Lower abdomen',
  'Pelvis',
  'Lower back',
  'Legs',
  'Ovaries (left)',
  'Ovaries (right)',
  'Rectum',
  'Bladder',
  'Upper abdomen',
  'Full body',
  'Other',
] as const
export type EndoPainLocation = (typeof ENDO_PAIN_LOCATIONS)[number]

export const ENDO_MOODS = [
  'Good',
  'Okay',
  'Low',
  'Anxious',
  'Irritable',
  'Weepy',
  'Brain fog',
  'Energetic',
] as const
export type EndoMood = (typeof ENDO_MOODS)[number]

export const ENDO_BOWEL_STATUSES = [
  'Normal',
  'Constipation',
  'Diarrhea',
  'Bloating only',
  'Nausea',
  'Mixed',
] as const
export type EndoBowelStatus = (typeof ENDO_BOWEL_STATUSES)[number]

export interface CycleEntryRow {
  id: string
  person_handle: PersonHandle
  entry_date: string
  cycle_day: number | null
  pain_level: number
  pain_locations: string[]
  bloating: number
  energy: number
  mood: string
  sleep_quality: number
  bowel_status: string
  foods: string
  supplements: string
  notes: string
  created_at: string
  updated_at: string
}
