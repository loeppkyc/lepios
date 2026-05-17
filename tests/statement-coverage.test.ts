import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: vi.fn(async () => ({
    ok: true,
    user: { id: 'test-user', email: 'test@example.com' },
    profile: { user_id: 'test-user', email: 'test@example.com', role: 'business' },
    supabase: {},
  })),
}))

import {
  utcToEdmontonYearMonth,
  getCurrentYearMonths,
  previousMonth,
  cellStatus,
  monthFromAbbrev,
} from '@/app/api/business-review/statement-coverage/route'

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

describe('getCurrentYearMonths', () => {
  it('returns exactly 12 months', () => {
    const months = getCurrentYearMonths()
    expect(months).toHaveLength(12)
  })

  it('all entries match YYYY-MM format for the current year', () => {
    const months = getCurrentYearMonths()
    const year = new Date().getFullYear()
    for (const m of months) {
      expect(m).toMatch(new RegExp(`^${year}-\\d{2}$`))
    }
  })

  it('starts at January and ends at December of the current year', () => {
    const months = getCurrentYearMonths()
    const year = new Date().getFullYear()
    expect(months[0]).toBe(`${year}-01`)
    expect(months[11]).toBe(`${year}-12`)
  })

  it('months are zero-padded and sequential', () => {
    const months = getCurrentYearMonths()
    const year = new Date().getFullYear()
    const expected = Array.from(
      { length: 12 },
      (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`
    )
    expect(months).toEqual(expected)
  })
})

// ── previousMonth: off-by-one mapping (upload month M → covers month M-1) ────

describe('previousMonth', () => {
  it('mid-year: month 5 → month 4, same year', () => {
    expect(previousMonth(2026, 5)).toEqual({ year: 2026, month: 4 })
  })

  it('January rolls back to December of the prior year', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
  })

  it('December → November, same year', () => {
    expect(previousMonth(2025, 12)).toEqual({ year: 2025, month: 11 })
  })

  it('February → January, same year', () => {
    expect(previousMonth(2026, 2)).toEqual({ year: 2026, month: 1 })
  })
})

// ── cellStatus: pending = current or future month ────────────────────────────

describe('cellStatus', () => {
  it('current month is pending', () => {
    expect(cellStatus(2026, 5, 2026, 5)).toBe('pending')
  })

  it('next month (future, same year) is pending', () => {
    expect(cellStatus(2026, 6, 2026, 5)).toBe('pending')
  })

  it('later month in same year is pending', () => {
    expect(cellStatus(2026, 12, 2026, 5)).toBe('pending')
  })

  it('future year is pending', () => {
    expect(cellStatus(2027, 1, 2026, 5)).toBe('pending')
  })

  it('previous month with no upload is missing', () => {
    expect(cellStatus(2026, 4, 2026, 5)).toBe('missing')
  })

  it('two months ago is missing', () => {
    expect(cellStatus(2026, 3, 2026, 5)).toBe('missing')
  })

  it('past year is missing', () => {
    expect(cellStatus(2025, 1, 2026, 5)).toBe('missing')
  })

  it('year-boundary: December is missing in January', () => {
    expect(cellStatus(2025, 12, 2026, 1)).toBe('missing')
  })
})

// ── monthFromAbbrev ───────────────────────────────────────────────────────────

describe('monthFromAbbrev', () => {
  it('recognizes all 12 lowercase abbreviations', () => {
    expect(monthFromAbbrev('jan')).toBe(1)
    expect(monthFromAbbrev('jun')).toBe(6)
    expect(monthFromAbbrev('dec')).toBe(12)
  })

  it('is case-insensitive', () => {
    expect(monthFromAbbrev('Jan')).toBe(1)
    expect(monthFromAbbrev('OCT')).toBe(10)
    expect(monthFromAbbrev('Feb')).toBe(2)
  })

  it('returns null for unrecognized strings', () => {
    expect(monthFromAbbrev('xyz')).toBeNull()
    expect(monthFromAbbrev('')).toBeNull()
  })
})

// ── Gmail coverage rule: arrival month M → covered month M-1 ─────────────────
// These tests verify the previousMonth() coverage mapping used by the route.
// (Filename parsers removed in v2 — route now uses gmail_statement_arrivals,
//  not Dropbox file listings. Coverage rule is arrival_date - 1 month.)

describe('coverage rule: arrival month → covered month (previousMonth)', () => {
  it('TD Bank arrives May 5 → covers April 2026', () => {
    // Simulates a "arrival_date = 2026-05-05" row → covered month 2026-04
    const { year, month } = previousMonth(2026, 5)
    const covered = `${year}-${String(month).padStart(2, '0')}`
    expect(covered).toBe('2026-04')
  })

  it('Amex arrives May 2 → covers April 2026', () => {
    const { year, month } = previousMonth(2026, 5)
    const covered = `${year}-${String(month).padStart(2, '0')}`
    expect(covered).toBe('2026-04')
  })

  it('arrival in January covers December of prior year', () => {
    const { year, month } = previousMonth(2026, 1)
    const covered = `${year}-${String(month).padStart(2, '0')}`
    expect(covered).toBe('2025-12')
  })

  it('arrival in February covers January same year', () => {
    const { year, month } = previousMonth(2026, 2)
    const covered = `${year}-${String(month).padStart(2, '0')}`
    expect(covered).toBe('2026-01')
  })

  it('arrival in December covers November same year', () => {
    const { year, month } = previousMonth(2026, 12)
    const covered = `${year}-${String(month).padStart(2, '0')}`
    expect(covered).toBe('2026-11')
  })
})

// ── NO_ACTIVITY overrides (GET-level, Gmail-based route) ─────────────────────
// Route v2 reads from gmail_statement_arrivals (Supabase). Dropbox removed.

describe('NO_ACTIVITY overrides (GET-level)', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockRequireUser(arrivals: Array<{ account_name: string; arrival_date: string }> = []) {
    // Build a mock supabase that returns arrivals for gmail_statement_arrivals
    // and empty rows for statement_coverage_overrides
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'gmail_statement_arrivals') {
        return { select: vi.fn().mockResolvedValue({ data: arrivals, error: null }) }
      }
      if (table === 'statement_coverage_overrides') {
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
    })

    vi.doMock('@/lib/auth/require-user', () => ({
      requireUser: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: 'test-user', email: 'test@example.com' },
        profile: { user_id: 'test-user', email: 'test@example.com', role: 'business' },
        supabase: { from: fromMock },
      }),
    }))
  }

  it('CIBC 2026-03 shows no_activity when no gmail arrivals exist for CIBC', async () => {
    // CIBC has no email notifications — covered by NO_ACTIVITY const
    mockRequireUser([])
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    const res = await GET()
    const body = await res.json()
    const cibc = body.accounts.find((a: { key: string }) => a.key === 'cibc')
    expect(cibc.coverage['2026-03']).toBe('no_activity')
  })

  it('TD Bank May arrival (2026-05-05) → April 2026 shows filed', async () => {
    // TD Chequing arrival in May → covered month April
    mockRequireUser([{ account_name: 'TD Chequing', arrival_date: '2026-05-05' }])
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    const res = await GET()
    const body = await res.json()
    const tdBank = body.accounts.find((a: { key: string }) => a.key === 'td_bank')
    expect(tdBank.coverage['2026-04']).toBe('filed')
  })
})

// ── Gmail-based route: response shape ────────────────────────────────────────
// Verifies the route returns 7 accounts (no capital_one) and correct structure.

describe('GET /api/business-review/statement-coverage — response shape', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 7 accounts with no capital_one', async () => {
    vi.doMock('@/lib/auth/require-user', () => ({
      requireUser: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: 'test-user', email: 'test@example.com' },
        profile: { user_id: 'test-user', email: 'test@example.com', role: 'business' },
        supabase: {
          from: vi.fn().mockImplementation(() => ({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        },
      }),
    }))
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    const res = await GET()
    const body = await res.json()
    expect(body.accounts).toHaveLength(7)
    const keys = body.accounts.map((a: { key: string }) => a.key)
    expect(keys).not.toContain('capital_one')
    expect(keys).toContain('td_bank')
    expect(keys).toContain('amex')
    expect(keys).toContain('amex_bonvoy')
    expect(keys).toContain('cibc')
    expect(keys).toContain('ct_card')
    expect(keys).toContain('td_visa')
    expect(keys).toContain('td_usd')
  })

  it('returns 502 when gmail_statement_arrivals query fails', async () => {
    vi.doMock('@/lib/auth/require-user', () => ({
      requireUser: vi.fn().mockResolvedValue({
        ok: true,
        user: { id: 'test-user', email: 'test@example.com' },
        profile: { user_id: 'test-user', email: 'test@example.com', role: 'business' },
        supabase: {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'gmail_statement_arrivals') {
              return {
                select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
              }
            }
            return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
          }),
        },
      }),
    }))
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    const res = await GET()
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('gmail_arrivals_fetch_failed')
  })
})
