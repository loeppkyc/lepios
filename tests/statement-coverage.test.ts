import { describe, it, expect } from 'vitest'
import { utcToEdmontonYearMonth, get2025Months, get2026YtdMonths } from '@/app/api/business-review/statement-coverage/route'

// ── Required timezone boundary tests (from acceptance doc) ────────────────────

describe('utcToEdmontonYearMonth — timezone boundary cases', () => {
  it('test 1: 2026-05-01T05:30:00Z → Edmonton = Apr 30 → April 2026 bucket', () => {
    // MDT is UTC-6, so 05:30 UTC = 23:30 MDT on Apr 30
    const result = utcToEdmontonYearMonth('2026-05-01T05:30:00Z')
    expect(result.year).toBe(2026)
    expect(result.month).toBe(4)
  })

  it('test 2: 2026-05-01T07:00:00Z → Edmonton = May 1 01:00 MDT → May 2026 bucket', () => {
    // MDT is UTC-6, so 07:00 UTC = 01:00 MDT on May 1
    const result = utcToEdmontonYearMonth('2026-05-01T07:00:00Z')
    expect(result.year).toBe(2026)
    expect(result.month).toBe(5)
  })

  it('test 3: Dec 31 23:30 MT upload (= Jan 1 UTC) → December bucket, not January', () => {
    // MST is UTC-7 in December (no daylight saving)
    // Dec 31 23:30 MST = Jan 1 06:30 UTC
    const result = utcToEdmontonYearMonth('2026-01-01T06:30:00Z')
    expect(result.year).toBe(2025)
    expect(result.month).toBe(12)
  })
})

// ── Additional boundary cases ─────────────────────────────────────────────────

describe('utcToEdmontonYearMonth — additional cases', () => {
  it('handles mid-month UTC timestamp correctly', () => {
    const result = utcToEdmontonYearMonth('2025-06-15T12:00:00Z')
    expect(result.year).toBe(2025)
    expect(result.month).toBe(6)
  })

  it('handles Jan 1 00:00 UTC → still December in Edmonton (MST = UTC-7)', () => {
    // Jan 1 00:00 UTC = Dec 31 17:00 MST
    const result = utcToEdmontonYearMonth('2026-01-01T00:00:00Z')
    expect(result.year).toBe(2025)
    expect(result.month).toBe(12)
  })

  it('handles timestamp well past midnight UTC in January', () => {
    // Jan 1 08:00 UTC = Jan 1 01:00 MST (UTC-7)
    const result = utcToEdmontonYearMonth('2026-01-01T08:00:00Z')
    expect(result.year).toBe(2026)
    expect(result.month).toBe(1)
  })
})

// ── Band generation tests ─────────────────────────────────────────────────────

describe('get2025Months', () => {
  it('returns exactly 12 months', () => {
    const months = get2025Months()
    expect(months).toHaveLength(12)
  })

  it('starts at 2025-01 and ends at 2025-12', () => {
    const months = get2025Months()
    expect(months[0]).toBe('2025-01')
    expect(months[11]).toBe('2025-12')
  })

  it('contains all 12 months with zero-padded numbers', () => {
    const months = get2025Months()
    expect(months).toEqual([
      '2025-01', '2025-02', '2025-03', '2025-04',
      '2025-05', '2025-06', '2025-07', '2025-08',
      '2025-09', '2025-10', '2025-11', '2025-12',
    ])
  })
})

describe('get2026YtdMonths', () => {
  it('returns months starting at 2026-01', () => {
    const months = get2026YtdMonths()
    expect(months[0]).toBe('2026-01')
  })

  it('all months are in 2026 format', () => {
    const months = get2026YtdMonths()
    for (const m of months) {
      expect(m).toMatch(/^2026-\d{2}$/)
    }
  })

  it('returns at least 1 month (Jan 2026 has passed)', () => {
    const months = get2026YtdMonths()
    expect(months.length).toBeGreaterThanOrEqual(1)
  })
})
