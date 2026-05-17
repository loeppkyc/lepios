import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.stubGlobal('fetch', mockFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal CKAN/Socrata record for test fixtures.
 * Matches the RawCKANRecord shape from lib/edmonton-open-data/events.ts.
 */
function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const daysFromNow = (n: number): string => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d.toISOString()
  }
  return {
    event_title: 'Free Summer Festival',
    start_date: daysFromNow(3),
    end_date: daysFromNow(3),
    location: 'Churchill Square, Edmonton',
    description: 'A free outdoor festival for all ages.',
    url: 'https://data.edmonton.ca/events/summer',
    // No price fields → treated as free
    ...overrides,
  }
}

function mockOkResponse(records: unknown[]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => records,
  })
}

function mockErrorResponse(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: true, message: 'Not found' }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchEdmontonOpenDataEvents', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when API returns 404', async () => {
    mockErrorResponse(404)
    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toEqual([])
  })

  it('returns empty array when API returns malformed (non-array) JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 'dataset.missing', error: true }),
    })
    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toEqual([])
  })

  it('returns empty array when network fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toEqual([])
  })

  it('filters out paid events (admission_price set to non-zero)', async () => {
    const paidRecord = makeRecord({ admission_price: '25.00', event_title: 'Paid Gala' })
    const freeRecord = makeRecord({ event_title: 'Free Concert' })
    mockOkResponse([paidRecord, freeRecord])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Free Concert')
  })

  it('filters out events outside the 14-day window', async () => {
    const future30 = new Date()
    future30.setDate(future30.getDate() + 30)

    const past = new Date()
    past.setDate(past.getDate() - 1)

    const outsideWindow = makeRecord({
      start_date: future30.toISOString(),
      event_title: 'Far Future Event',
    })
    const pastEvent = makeRecord({
      start_date: past.toISOString(),
      event_title: 'Already Happened',
    })
    const goodRecord = makeRecord({ event_title: 'In Window Event' })

    mockOkResponse([outsideWindow, pastEvent, goodRecord])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('In Window Event')
  })

  it('returns upcoming free events sorted by start date', async () => {
    const d5 = new Date()
    d5.setDate(d5.getDate() + 5)
    const d2 = new Date()
    d2.setDate(d2.getDate() + 2)

    const late = makeRecord({ start_date: d5.toISOString(), event_title: 'Event B (day 5)' })
    const early = makeRecord({ start_date: d2.toISOString(), event_title: 'Event A (day 2)' })

    mockOkResponse([late, early])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result[0].title).toBe('Event A (day 2)')
    expect(result[1].title).toBe('Event B (day 5)')
  })

  it('accepts records with is_free=true flag', async () => {
    const record = makeRecord({
      is_free: true,
      admission_price: undefined,
      event_title: 'Flagged Free Event',
    })
    mockOkResponse([record])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
    expect(result[0].isFree).toBe(true)
    expect(result[0].source).toBe('edmonton-open-data')
  })

  it('accepts records with admission_price="free"', async () => {
    const record = makeRecord({ admission_price: 'free', event_title: 'Admission=free Event' })
    mockOkResponse([record])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
  })

  it('skips records with no title', async () => {
    const noTitle = makeRecord({ event_title: '', name: '', title: '', event_name: '' })
    const withTitle = makeRecord({ event_title: 'Has a Title' })
    mockOkResponse([noTitle, withTitle])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Has a Title')
  })

  it('normalizes fields correctly', async () => {
    const record = makeRecord({
      event_title: 'My Event',
      start_date: (() => {
        const d = new Date()
        d.setDate(d.getDate() + 2)
        return d.toISOString()
      })(),
      end_date: (() => {
        const d = new Date()
        d.setDate(d.getDate() + 2)
        d.setHours(d.getHours() + 3)
        return d.toISOString()
      })(),
      location: 'City Hall',
      description: 'Great event',
      url: 'https://example.com/event',
    })
    mockOkResponse([record])

    const { fetchEdmontonOpenDataEvents } = await import('@/lib/edmonton-open-data/events')
    const result = await fetchEdmontonOpenDataEvents(14)
    expect(result).toHaveLength(1)
    const ev = result[0]
    expect(ev.title).toBe('My Event')
    expect(ev.location).toBe('City Hall')
    expect(ev.description).toBe('Great event')
    expect(ev.url).toBe('https://example.com/event')
    expect(ev.isFree).toBe(true)
    expect(ev.source).toBe('edmonton-open-data')
  })
})

// ── Eventbrite client tests ───────────────────────────────────────────────────

describe('fetchEventbriteEvents', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    // Ensure EVENTBRITE_API_KEY is not set unless test sets it
    delete process.env.EVENTBRITE_API_KEY
  })

  afterEach(() => {
    delete process.env.EVENTBRITE_API_KEY
    vi.restoreAllMocks()
  })

  it('returns empty array when EVENTBRITE_API_KEY is not set', async () => {
    const { fetchEventbriteEvents } = await import('@/lib/eventbrite/events')
    const result = await fetchEventbriteEvents(14)
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty array when API returns non-ok status', async () => {
    process.env.EVENTBRITE_API_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    const { fetchEventbriteEvents } = await import('@/lib/eventbrite/events')
    const result = await fetchEventbriteEvents(14)
    expect(result).toEqual([])
  })

  it('returns empty array when network fails', async () => {
    process.env.EVENTBRITE_API_KEY = 'test-key'
    mockFetch.mockRejectedValueOnce(new Error('timeout'))
    const { fetchEventbriteEvents } = await import('@/lib/eventbrite/events')
    const result = await fetchEventbriteEvents(14)
    expect(result).toEqual([])
  })

  it('filters out non-free events from Eventbrite response', async () => {
    process.env.EVENTBRITE_API_KEY = 'test-key'
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 3)
    const localStr = futureDate.toISOString().replace('Z', '')

    const freeEvent = {
      id: 'eb-1',
      name: { text: 'Free Workshop' },
      start: { local: localStr },
      end: { local: localStr },
      url: 'https://eventbrite.com/e/1',
      is_free: true,
      venue: { address: { localized_address_display: 'Edmonton Convention Centre' } },
    }
    const paidEvent = {
      id: 'eb-2',
      name: { text: 'Paid Concert' },
      start: { local: localStr },
      end: { local: localStr },
      url: 'https://eventbrite.com/e/2',
      is_free: false,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [freeEvent, paidEvent] }),
    })

    const { fetchEventbriteEvents } = await import('@/lib/eventbrite/events')
    const result = await fetchEventbriteEvents(14)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Free Workshop')
    expect(result[0].source).toBe('eventbrite')
    expect(result[0].isFree).toBe(true)
  })
})
