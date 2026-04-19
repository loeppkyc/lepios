import { describe, it, expect } from 'vitest'
import { extractBsrPoints } from '@/lib/keepa/history'

// Keepa epoch: 2011-01-01T00:00:00Z = 1293840000000 ms
const KEEPA_EPOCH_MS = Date.UTC(2011, 0, 1)

// Convert a JS Date to Keepa minutes
function toKeepaMinutes(date: Date): number {
  return Math.floor((date.getTime() - KEEPA_EPOCH_MS) / 60_000)
}

const now = new Date()
const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
const oldDate = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000) // 120 days ago (outside 90d)

const recentT = toKeepaMinutes(recentDate)
const oldT = toKeepaMinutes(oldDate)

describe('extractBsrPoints', () => {
  it('converts Keepa minutes to Unix epoch seconds correctly', () => {
    const points = extractBsrPoints([recentT, 50000])
    expect(points).toHaveLength(1)
    // Verify the converted timestamp is within 60 seconds of the original (rounding)
    expect(Math.abs(points[0].t - Math.floor(recentDate.getTime() / 1000))).toBeLessThan(60)
  })

  it('filters out points older than 90 days', () => {
    const raw = [oldT, 100000, recentT, 50000]
    const points = extractBsrPoints(raw)
    expect(points).toHaveLength(1)
    expect(points[0].rank).toBe(50000)
  })

  it('skips rank = -1 (out of stock)', () => {
    const raw = [recentT, -1, recentT + 1440, 75000]
    const points = extractBsrPoints(raw)
    expect(points).toHaveLength(1)
    expect(points[0].rank).toBe(75000)
  })

  it('skips rank = 0', () => {
    const raw = [recentT, 0, recentT + 1440, 42000]
    const points = extractBsrPoints(raw)
    expect(points).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(extractBsrPoints([])).toEqual([])
  })

  it('returns points sorted by input order (ascending time)', () => {
    const t1 = recentT
    const t2 = recentT + 1440 // +1 day in Keepa minutes
    const raw = [t1, 200000, t2, 100000]
    const points = extractBsrPoints(raw)
    expect(points[0].rank).toBe(200000)
    expect(points[1].rank).toBe(100000)
    expect(points[0].t).toBeLessThan(points[1].t)
  })

  it('handles a flat line (all same rank)', () => {
    const t1 = recentT
    const t2 = recentT + 2880
    const raw = [t1, 55000, t2, 55000]
    const points = extractBsrPoints(raw)
    expect(points).toHaveLength(2)
    expect(points[0].rank).toBe(55000)
    expect(points[1].rank).toBe(55000)
  })
})
