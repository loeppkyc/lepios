export interface CoraFutureItem {
  id: string
  category: 'program' | 'scholarship' | 'note'
  name: string
  provider: string | null
  eligibility: string | null
  value: string | null
  timeline: 'Grade 11' | 'Grade 12' | 'Post-secondary' | null
  dates: string | null
  url: string | null
  status: 'upcoming' | 'open' | 'applied' | 'accepted' | 'missed' | 'rejected'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CorasFutureResponse {
  items: CoraFutureItem[]
}
