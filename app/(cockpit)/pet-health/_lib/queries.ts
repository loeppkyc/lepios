// Server-side queries for the Pet Health module.
// Kept within app/(cockpit)/pet-health/_lib/ to stay within window scope.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PetRow {
  id: string
  person_handle: string
  name: string
  species: 'cat' | 'dog' | 'other'
  breed: string
  dob: string | null
  weight_lbs: number | null
  colour: string
  microchip: string
  fixed: 'yes' | 'no' | 'unknown'
  notes: string
  created_at: string
}

export interface VetVisitRow {
  id: string
  pet_id: string
  visit_date: string
  clinic: string
  vet_name: string
  reason: string
  diagnosis: string
  treatment: string
  follow_up_date: string | null
  cost_cad: number | null
  notes: string
  created_at: string
}

export interface PetVaccinationRow {
  id: string
  pet_id: string
  given_date: string
  vaccine: string
  next_due_date: string | null
  clinic: string
  notes: string
  created_at: string
}

export interface PetMedicationRow {
  id: string
  pet_id: string
  medication: string
  dosage: string
  frequency: string
  start_date: string
  end_date: string | null
  prescribing_vet: string
  notes: string
  created_at: string
}

export interface PetBundle {
  pets: PetRow[]
  vetVisits: VetVisitRow[]
  vaccinations: PetVaccinationRow[]
  medications: PetMedicationRow[]
}

export async function fetchPetBundle(supabase: SupabaseClient): Promise<PetBundle> {
  const [pets, vetVisits, vaccinations, medications] = await Promise.all([
    supabase.from('pets').select('*').order('name', { ascending: true }),
    supabase.from('vet_visits').select('*').order('visit_date', { ascending: false }),
    supabase.from('pet_vaccinations').select('*').order('given_date', { ascending: false }),
    supabase.from('pet_medications').select('*').order('start_date', { ascending: false }),
  ])

  return {
    pets: (pets.data ?? []) as PetRow[],
    vetVisits: (vetVisits.data ?? []) as VetVisitRow[],
    vaccinations: (vaccinations.data ?? []) as PetVaccinationRow[],
    medications: (medications.data ?? []) as PetMedicationRow[],
  }
}

// Vaccine status bucket logic — pure function, testable
export type VaccineStatus = 'overdue' | 'due-soon' | 'current'

export function vaccineStatus(nextDueDate: string | null, today: string): VaccineStatus {
  if (!nextDueDate) return 'current'
  if (nextDueDate < today) return 'overdue'
  // days until due
  const due = new Date(nextDueDate)
  const now = new Date(today)
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 30) return 'due-soon'
  return 'current'
}

// Active medication check — end_date null or in the future
export function isMedActive(endDate: string | null, today: string): boolean {
  if (!endDate) return true
  return endDate >= today
}
