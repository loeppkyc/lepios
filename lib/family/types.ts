export interface CleaningClient {
  id: string
  name: string
  address: string | null
  frequency: 'Weekly' | 'Biweekly' | 'Monthly' | 'One-time'
  rate: number
  status: 'Active' | 'Inactive' | 'Paused'
  notes: string | null
  created_at: string
}

export interface CoraActivity {
  id: string
  name: string
  day_of_week: string | null
  time_of_day: string | null
  monthly_cost: number
  notes: string | null
  active: boolean
  created_at: string
}

export interface FamilyDate {
  id: string
  event: string
  date: string
  recurring: boolean
  notes: string | null
  created_at: string
}

export interface FamilyResponse {
  clients: CleaningClient[]
  activities: CoraActivity[]
  dates: FamilyDate[]
  household_monthly: number
  household_source: 'recurring' | 'hardcoded'
}
