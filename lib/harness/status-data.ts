import { createServiceClient } from '@/lib/supabase/service'

export interface Incident {
  id: string
  occurred_at: string
  domain: string
  action: string
  actor: string | null
  status: 'error' | 'warning'
  error_message: string | null
}

export interface DayBar {
  date: string // YYYY-MM-DD in America/Edmonton
  status: 'green' | 'amber' | 'red' | 'none'
  successCount: number
  errorCount: number
}

const TZ = 'America/Edmonton'

function toEdmontonDate(isoString: string): string {
  // en-CA gives YYYY-MM-DD natively
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoString))
}

export async function getIncidentLog(limit = 50): Promise<Incident[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('agent_events')
    .select('id, occurred_at, domain, action, actor, status, error_message')
    .in('status', ['error', 'warning'])
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data as Incident[]
}

export async function get90DayBars(): Promise<DayBar[]> {
  const db = createServiceClient()
  const since = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString()

  const { data } = await db
    .from('agent_events')
    .select('occurred_at, status')
    .eq('domain', 'harness')
    .gte('occurred_at', since)

  // Aggregate by Edmonton date in memory
  const dayMap = new Map<string, { success: number; error: number }>()
  for (const ev of data ?? []) {
    const date = toEdmontonDate(ev.occurred_at as string)
    const entry = dayMap.get(date) ?? { success: 0, error: 0 }
    if (ev.status === 'success') entry.success++
    else if (ev.status === 'error' || ev.status === 'warning') entry.error++
    dayMap.set(date, entry)
  }

  // Build 90 slots oldest → newest
  const bars: DayBar[] = []
  const now = new Date()
  for (let i = 89; i >= 0; i--) {
    const date = toEdmontonDate(new Date(now.getTime() - i * 24 * 3_600_000).toISOString())
    const counts = dayMap.get(date)
    let status: DayBar['status'] = 'none'
    if (counts) {
      if (counts.error === 0) status = 'green'
      else if (counts.success === 0) status = 'red'
      else status = 'amber'
    }
    bars.push({ date, status, successCount: counts?.success ?? 0, errorCount: counts?.error ?? 0 })
  }

  return bars
}
