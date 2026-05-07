import { describe, it, expect } from 'vitest'
import { buildRows } from '@/lib/oura/sync'

describe('buildRows — Oura aggregator', () => {
  it('returns empty array when all inputs are empty', () => {
    expect(buildRows([], [], [], [])).toEqual([])
  })

  it('merges single-day rows from all 4 endpoints into one OuraDailyRow', () => {
    const day = '2026-04-20'
    const result = buildRows(
      [{ day, score: 78 }],
      [{ day, score: 84, contributors: { resting_heart_rate: 56 } }],
      [{ day, score: 91, steps: 12_345 }],
      [
        {
          day,
          total_sleep_duration: 27_000, // 7.5 hrs
          deep_sleep_duration: 3_600, // 60 min
          rem_sleep_duration: 5_400, // 90 min
          light_sleep_duration: 18_000, // 300 min
          average_hrv: 42,
          lowest_heart_rate: 54,
        },
      ]
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      date: day,
      sleep_score: 78,
      readiness_score: 84,
      activity_score: 91,
      steps: 12_345,
      total_sleep_hours: 7.5,
      deep_sleep_min: 60,
      rem_sleep_min: 90,
      light_sleep_min: 300,
      hrv: 42,
      // sleep-detail RHR wins over readiness-contributor RHR
      resting_hr: 54,
    })
  })

  it('sleep-detail HRV wins over hrv_balance fallback', () => {
    const day = '2026-04-20'
    const [row] = buildRows(
      [{ day, score: 70, contributors: { hrv_balance: 30 } }],
      [],
      [],
      [{ day, total_sleep_duration: 28_800, average_hrv: 50 }]
    )
    expect(row.hrv).toBe(50)
  })

  it('uses hrv_balance fallback when no sleep detail provides average_hrv', () => {
    const day = '2026-04-20'
    const [row] = buildRows([{ day, score: 70, contributors: { hrv_balance: 30 } }], [], [], [])
    expect(row.hrv).toBe(30)
  })

  it('longest-session rule: when multiple sleep sessions on a day, longest wins', () => {
    const day = '2026-04-20'
    const [row] = buildRows(
      [{ day, score: 80 }],
      [],
      [],
      [
        // Nap: short, but listed first
        {
          day,
          total_sleep_duration: 1_800, // 30 min
          deep_sleep_duration: 600,
          rem_sleep_duration: 0,
          light_sleep_duration: 1_200,
          average_hrv: 25,
          lowest_heart_rate: 70,
        },
        // Main sleep: longer — should win
        {
          day,
          total_sleep_duration: 28_800, // 8 hrs
          deep_sleep_duration: 5_400, // 90 min
          rem_sleep_duration: 7_200, // 120 min
          light_sleep_duration: 16_200, // 270 min
          average_hrv: 45,
          lowest_heart_rate: 52,
        },
      ]
    )

    expect(row.total_sleep_hours).toBe(8)
    expect(row.deep_sleep_min).toBe(90)
    expect(row.rem_sleep_min).toBe(120)
    expect(row.light_sleep_min).toBe(270)
    expect(row.hrv).toBe(45)
    expect(row.resting_hr).toBe(52)
  })

  it('rounds total_sleep_hours to 1 decimal and minutes to nearest int', () => {
    const day = '2026-04-20'
    const [row] = buildRows(
      [],
      [],
      [],
      [
        {
          day,
          total_sleep_duration: 27_059, // 7.5163… → 7.5
          deep_sleep_duration: 3_629, // 60.48 → 60
          rem_sleep_duration: 5_430, // 90.5 → 91
          light_sleep_duration: 18_005, // 300.08 → 300
        },
      ]
    )
    expect(row.total_sleep_hours).toBe(7.5)
    expect(row.deep_sleep_min).toBe(60)
    expect(row.rem_sleep_min).toBe(91)
    expect(row.light_sleep_min).toBe(300)
  })

  it('handles missing fields gracefully (null instead of undefined/0)', () => {
    const day = '2026-04-20'
    const [row] = buildRows([{ day }], [], [], [])
    expect(row).toMatchObject({
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
    })
  })

  it('produces date-ascending output across multiple days', () => {
    const result = buildRows(
      [
        { day: '2026-04-22', score: 80 },
        { day: '2026-04-20', score: 78 },
        { day: '2026-04-21', score: 79 },
      ],
      [],
      [],
      []
    )
    expect(result.map((r) => r.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22'])
  })

  it('produces one row per day even when only one endpoint has data for it', () => {
    const result = buildRows(
      [{ day: '2026-04-20', score: 78 }],
      [{ day: '2026-04-21', score: 84 }],
      [{ day: '2026-04-22', score: 91 }],
      []
    )
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22'])
    expect(result[0].sleep_score).toBe(78)
    expect(result[1].readiness_score).toBe(84)
    expect(result[2].activity_score).toBe(91)
  })
})
