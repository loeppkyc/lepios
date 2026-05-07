// Oura Ring v2 sync — fetches daily metrics across 4 endpoints, aggregates per
// calendar date using the longest-sleep-session rule for sleep stages, and
// upserts into oura_daily by date.
//
// Mirrors the Streamlit baseline (pages/82_Oura_Health.py): same 4 endpoints,
// same HRV primary + fallback, same longest-session rule for sleep detail.
// The `heartrate` endpoint is intentionally not fetched — it is unused in the
// final row in the Streamlit reference (grounding doc decision §3).

import type { SupabaseClient } from '@supabase/supabase-js'

export const OURA_BASE = 'https://api.ouraring.com/v2/usercollection'

interface OuraDailySleep {
  day: string
  score?: number
  contributors?: { hrv_balance?: number }
}

interface OuraDailyReadiness {
  day: string
  score?: number
  contributors?: { resting_heart_rate?: number }
}

interface OuraDailyActivity {
  day: string
  score?: number
  steps?: number
}

interface OuraSleep {
  day: string
  total_sleep_duration?: number
  deep_sleep_duration?: number
  rem_sleep_duration?: number
  light_sleep_duration?: number
  average_hrv?: number
  lowest_heart_rate?: number
}

export interface OuraDailyRow {
  date: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  total_sleep_hours: number | null
  deep_sleep_min: number | null
  rem_sleep_min: number | null
  light_sleep_min: number | null
  hrv: number | null
  resting_hr: number | null
  steps: number | null
  synced_at?: string
}

async function fetchOura<T>(
  endpoint: string,
  token: string,
  startDate: string,
  endDate: string
): Promise<T[]> {
  const url = `${OURA_BASE}/${endpoint}?start_date=${startDate}&end_date=${endDate}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Oura ${endpoint} returned ${res.status}`)
  const body = (await res.json()) as { data: T[] }
  return body.data ?? []
}

// Pure aggregator — exported for test coverage.
export function buildRows(
  sleepDaily: OuraDailySleep[],
  readiness: OuraDailyReadiness[],
  activity: OuraDailyActivity[],
  sleepDetail: OuraSleep[]
): OuraDailyRow[] {
  const byDate = new Map<string, OuraDailyRow>()

  function getOrInit(day: string): OuraDailyRow {
    const existing = byDate.get(day)
    if (existing) return existing
    const fresh: OuraDailyRow = {
      date: day,
      sleep_score: null,
      readiness_score: null,
      activity_score: null,
      total_sleep_hours: null,
      deep_sleep_min: null,
      rem_sleep_min: null,
      light_sleep_min: null,
      hrv: null,
      resting_hr: null,
      steps: null,
    }
    byDate.set(day, fresh)
    return fresh
  }

  for (const r of sleepDaily) {
    const row = getOrInit(r.day)
    row.sleep_score = r.score ?? null
    // HRV fallback (Streamlit parity): hrv_balance from sleep contributors.
    if (row.hrv == null && r.contributors?.hrv_balance != null) {
      row.hrv = r.contributors.hrv_balance
    }
  }

  for (const r of readiness) {
    const row = getOrInit(r.day)
    row.readiness_score = r.score ?? null
    if (row.resting_hr == null && r.contributors?.resting_heart_rate != null) {
      row.resting_hr = r.contributors.resting_heart_rate
    }
  }

  for (const r of activity) {
    const row = getOrInit(r.day)
    row.activity_score = r.score ?? null
    row.steps = r.steps ?? null
  }

  // Longest-session rule: when a calendar day has multiple sleep sessions,
  // the row with the highest total_sleep_duration wins. Streamlit reference
  // line 73–76.
  const longestByDay = new Map<string, OuraSleep>()
  for (const s of sleepDetail) {
    const prev = longestByDay.get(s.day)
    const prevTotal = prev?.total_sleep_duration ?? 0
    const thisTotal = s.total_sleep_duration ?? 0
    if (!prev || thisTotal > prevTotal) longestByDay.set(s.day, s)
  }

  for (const [day, s] of longestByDay.entries()) {
    const row = getOrInit(day)
    if (s.total_sleep_duration != null) {
      row.total_sleep_hours = Math.round((s.total_sleep_duration / 3600) * 10) / 10
    }
    if (s.deep_sleep_duration != null) {
      row.deep_sleep_min = Math.round(s.deep_sleep_duration / 60)
    }
    if (s.rem_sleep_duration != null) {
      row.rem_sleep_min = Math.round(s.rem_sleep_duration / 60)
    }
    if (s.light_sleep_duration != null) {
      row.light_sleep_min = Math.round(s.light_sleep_duration / 60)
    }
    // HRV primary: average_hrv from longest sleep session (Streamlit parity).
    if (s.average_hrv != null) row.hrv = s.average_hrv
    if (s.lowest_heart_rate != null) row.resting_hr = s.lowest_heart_rate
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchOuraDays(
  token: string,
  days: number,
  now: Date = new Date()
): Promise<OuraDailyRow[]> {
  const endDate = now.toISOString().slice(0, 10)
  const startDate = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)

  const [sleepDaily, readiness, activity, sleepDetail] = await Promise.all([
    fetchOura<OuraDailySleep>('daily_sleep', token, startDate, endDate),
    fetchOura<OuraDailyReadiness>('daily_readiness', token, startDate, endDate),
    fetchOura<OuraDailyActivity>('daily_activity', token, startDate, endDate),
    fetchOura<OuraSleep>('sleep', token, startDate, endDate),
  ])

  return buildRows(sleepDaily, readiness, activity, sleepDetail)
}

export async function syncOura(
  db: SupabaseClient,
  token: string,
  days: number,
  now: Date = new Date()
): Promise<{ rowsUpserted: number; startDate: string; endDate: string }> {
  const endDate = now.toISOString().slice(0, 10)
  const startDate = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)

  const rows = await fetchOuraDays(token, days, now)

  if (rows.length > 0) {
    const stamped = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }))
    const { error } = await db.from('oura_daily').upsert(stamped, { onConflict: 'date' })
    if (error) throw new Error(`upsert: ${error.message}`)
  }

  return { rowsUpserted: rows.length, startDate, endDate }
}
