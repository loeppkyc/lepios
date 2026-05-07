// Pure shaping helpers for the Oura cockpit page.
// All exports are pure functions so they can be unit-tested without React.

import type { OuraDailyRow } from './sync'

export interface OuraLatest {
  date: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  hrv: number | null
  resting_hr: number | null
}

// Most recent row by date. Returns null if no rows have any score data.
export function pickLatest(rows: OuraDailyRow[]): OuraLatest | null {
  if (rows.length === 0) return null
  // Sort descending by date (ISO strings sort lexicographically).
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  // Find the most recent row that has at least one score populated, so we
  // don't show a row that's mid-sync (Oura sometimes has activity but not
  // sleep yet).
  const latest = sorted.find(
    (r) =>
      r.sleep_score != null ||
      r.readiness_score != null ||
      r.activity_score != null ||
      r.hrv != null ||
      r.resting_hr != null
  )
  if (!latest) return null
  return {
    date: latest.date,
    sleep_score: latest.sleep_score,
    readiness_score: latest.readiness_score,
    activity_score: latest.activity_score,
    hrv: latest.hrv,
    resting_hr: latest.resting_hr,
  }
}

export interface ScoreTrendPoint {
  date: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  hrv: number | null
  resting_hr: number | null
}

// Ascending-by-date series for line charts.
export function buildScoreTrend(rows: OuraDailyRow[]): ScoreTrendPoint[] {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      sleep_score: r.sleep_score,
      readiness_score: r.readiness_score,
      activity_score: r.activity_score,
      hrv: r.hrv,
      resting_hr: r.resting_hr,
    }))
}

export interface SleepBreakdownPoint {
  date: string
  deep_sleep_min: number
  rem_sleep_min: number
  light_sleep_min: number
  total_sleep_hours: number | null
}

// Stacked bars need numeric (not nullable) values to render — coerce nulls to 0.
export function buildSleepBreakdown(rows: OuraDailyRow[]): SleepBreakdownPoint[] {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      deep_sleep_min: r.deep_sleep_min ?? 0,
      rem_sleep_min: r.rem_sleep_min ?? 0,
      light_sleep_min: r.light_sleep_min ?? 0,
      total_sleep_hours: r.total_sleep_hours,
    }))
}

// Average of populated total_sleep_hours, rounded to 1 decimal. Null if none.
export function averageSleepHours(rows: OuraDailyRow[]): number | null {
  const populated = rows.map((r) => r.total_sleep_hours).filter((v): v is number => v != null)
  if (populated.length === 0) return null
  const sum = populated.reduce((a, b) => a + b, 0)
  return Math.round((sum / populated.length) * 10) / 10
}
