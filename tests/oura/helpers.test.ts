import { describe, it, expect } from 'vitest'
import type { OuraDailyRow } from '@/lib/oura/sync'
import {
  pickLatest,
  buildScoreTrend,
  buildSleepBreakdown,
  averageSleepHours,
} from '@/lib/oura/helpers'

function row(overrides: Partial<OuraDailyRow> = {}): OuraDailyRow {
  return {
    date: '2026-04-20',
    sleep_score: 80,
    readiness_score: 80,
    activity_score: 80,
    total_sleep_hours: 7.5,
    deep_sleep_min: 90,
    rem_sleep_min: 90,
    light_sleep_min: 270,
    hrv: 40,
    resting_hr: 55,
    steps: 8_000,
    ...overrides,
  }
}

describe('pickLatest', () => {
  it('returns null when no rows', () => {
    expect(pickLatest([])).toBeNull()
  })

  it('returns null when all rows have entirely null score data', () => {
    const r = row({
      sleep_score: null,
      readiness_score: null,
      activity_score: null,
      hrv: null,
      resting_hr: null,
    })
    expect(pickLatest([r])).toBeNull()
  })

  it('picks the most recent row by ISO date', () => {
    const rows = [
      row({ date: '2026-04-20', sleep_score: 78 }),
      row({ date: '2026-04-22', sleep_score: 82 }),
      row({ date: '2026-04-21', sleep_score: 80 }),
    ]
    const latest = pickLatest(rows)
    expect(latest?.date).toBe('2026-04-22')
    expect(latest?.sleep_score).toBe(82)
  })

  it('skips a most-recent row that has no score data, falls back to next', () => {
    const rows = [
      row({
        date: '2026-04-22',
        sleep_score: null,
        readiness_score: null,
        activity_score: null,
        hrv: null,
        resting_hr: null,
      }),
      row({ date: '2026-04-21', sleep_score: 80 }),
    ]
    const latest = pickLatest(rows)
    expect(latest?.date).toBe('2026-04-21')
  })
})

describe('buildScoreTrend', () => {
  it('returns date-ascending series with all 5 score fields', () => {
    const rows = [
      row({ date: '2026-04-22', sleep_score: 82 }),
      row({ date: '2026-04-20', sleep_score: 78 }),
      row({ date: '2026-04-21', sleep_score: 80 }),
    ]
    const out = buildScoreTrend(rows)
    expect(out.map((r) => r.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22'])
    expect(out[0]).toMatchObject({
      date: '2026-04-20',
      sleep_score: 78,
      readiness_score: 80,
      activity_score: 80,
      hrv: 40,
      resting_hr: 55,
    })
  })
})

describe('buildSleepBreakdown', () => {
  it('coerces null sleep stage values to 0 (so stacked bars render)', () => {
    const rows = [
      row({
        date: '2026-04-20',
        deep_sleep_min: null,
        rem_sleep_min: null,
        light_sleep_min: null,
      }),
    ]
    const out = buildSleepBreakdown(rows)
    expect(out[0]).toMatchObject({
      deep_sleep_min: 0,
      rem_sleep_min: 0,
      light_sleep_min: 0,
    })
  })

  it('preserves total_sleep_hours as null (used for line chart caption only)', () => {
    const rows = [row({ date: '2026-04-20', total_sleep_hours: null })]
    const out = buildSleepBreakdown(rows)
    expect(out[0].total_sleep_hours).toBeNull()
  })
})

describe('averageSleepHours', () => {
  it('returns null for empty', () => {
    expect(averageSleepHours([])).toBeNull()
  })

  it('returns null when no row has total_sleep_hours', () => {
    expect(averageSleepHours([row({ total_sleep_hours: null })])).toBeNull()
  })

  it('rounds to 1 decimal', () => {
    const rows = [
      row({ total_sleep_hours: 7.0 }),
      row({ total_sleep_hours: 8.0 }),
      row({ total_sleep_hours: 7.5 }),
    ]
    expect(averageSleepHours(rows)).toBe(7.5)
  })

  it('skips null entries when averaging', () => {
    const rows = [
      row({ total_sleep_hours: 6.0 }),
      row({ total_sleep_hours: null }),
      row({ total_sleep_hours: 8.0 }),
    ]
    expect(averageSleepHours(rows)).toBe(7.0)
  })
})
