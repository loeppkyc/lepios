import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  utcToEdmontonYearMonth,
  getCurrentYearMonths,
  previousMonth,
  cellStatus,
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
    const expected = Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
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

// ── cellStatus: pending / missing determination ────────────────────────────────

describe('cellStatus', () => {
  it('current month is pending', () => {
    expect(cellStatus(2026, 5, 2026, 5)).toBe('pending')
  })

  it('previous month with no upload is always missing', () => {
    expect(cellStatus(2026, 4, 2026, 5)).toBe('missing')
  })

  it('two months ago is missing', () => {
    expect(cellStatus(2026, 3, 2026, 5)).toBe('missing')
  })

  it('past year is missing', () => {
    expect(cellStatus(2025, 1, 2026, 5)).toBe('missing')
  })

  it('year-boundary: previous month (Dec) is missing in January', () => {
    expect(cellStatus(2025, 12, 2026, 1)).toBe('missing')
  })
})

// ── F15: Vercel CLI Windows CRLF trim test ────────────────────────────────────
// When Vercel CLI stdin adds on Windows, stored env values contain trailing \r\n
// (2 extra bytes). The route must trim before using creds — Dropbox rejects
// untrimmed values as invalid_client (HTTP 400).

describe('env var trimming (F15 — Vercel CLI Windows CRLF)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('GET returns 503 when DROPBOX_APP_KEY is whitespace-only after trim', async () => {
    vi.stubEnv('DROPBOX_APP_KEY', '   \r\n')
    vi.stubEnv('DROPBOX_APP_SECRET', 'secret')
    vi.stubEnv('DROPBOX_REFRESH_TOKEN', 'token')
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('dropbox_credentials_missing')
  })

  it('trimmed creds with trailing \\r\\n still attempt auth (no 503)', async () => {
    vi.stubEnv('DROPBOX_APP_KEY', 'validkey\r\n')
    vi.stubEnv('DROPBOX_APP_SECRET', 'validsecret\r\n')
    vi.stubEnv('DROPBOX_REFRESH_TOKEN', 'validtoken\r\n')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    )
    const { GET } = await import('@/app/api/business-review/statement-coverage/route')
    await GET()
    // fetch was called (credentials were not empty after trim → auth attempted)
    expect(fetchSpy).toHaveBeenCalled()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.dropboxapi.com/oauth2/token')
    // Body must NOT contain raw \r\n bytes inside the field values
    const body = new URLSearchParams(init.body as string)
    expect(body.get('client_id')).toBe('validkey')
    expect(body.get('client_secret')).toBe('validsecret')
    expect(body.get('refresh_token')).toBe('validtoken')
    vi.restoreAllMocks()
  })
})
