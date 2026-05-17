/**
 * Eventbrite events client — optional data source
 *
 * Only called when EVENTBRITE_API_KEY env var is present.
 * If the key is absent, returns an empty array (no error).
 *
 * API docs: https://www.eventbrite.com/platform/api
 * Endpoint: GET /v3/events/search
 *
 * "Free" definition: is_free=true on Eventbrite (includes $0-price events
 * that may still require free registration). This is the strict definition
 * per coordinator Q5 answer: $0 price only, is_free=true flag.
 *
 * F18 surface: caller logs agent_events action='events_fetched' meta.eventbrite_count
 */

const EVENTBRITE_BASE_URL = 'https://www.eventbriteapi.com/v3'
const FETCH_TIMEOUT_MS = 8_000

export interface EventbriteEvent {
  id: string
  title: string
  startDate: string
  endDate: string | null
  location: string | null
  description: string | null
  url: string
  isFree: true
  source: 'eventbrite'
}

interface EBVenueAddress {
  localized_address_display?: string
  city?: string
}

interface EBVenue {
  address?: EBVenueAddress
  name?: string
}

interface EBDatetime {
  local?: string
  utc?: string
}

interface EBEventRaw {
  id: string
  name?: { text?: string }
  description?: { text?: string }
  start?: EBDatetime
  end?: EBDatetime
  url?: string
  is_free?: boolean
  venue?: EBVenue
}

interface EBSearchResponse {
  events?: EBEventRaw[]
  pagination?: {
    page_number?: number
    page_count?: number
  }
  error?: string
  error_description?: string
}

function extractVenueDisplay(venue: EBVenue | undefined): string | null {
  if (!venue) return null
  const addr = venue.address?.localized_address_display ?? null
  if (addr) return addr
  const parts: string[] = []
  if (venue.name) parts.push(venue.name)
  if (venue.address?.city) parts.push(venue.address.city)
  return parts.length > 0 ? parts.join(', ') : null
}

function normalizeEvent(raw: EBEventRaw): EventbriteEvent {
  return {
    id: `eb-${raw.id}`,
    title: raw.name?.text?.trim() ?? 'Untitled Event',
    startDate: raw.start?.local ?? raw.start?.utc ?? '',
    endDate: raw.end?.local ?? raw.end?.utc ?? null,
    location: extractVenueDisplay(raw.venue),
    description: raw.description?.text?.trim() ?? null,
    url: raw.url ?? '',
    isFree: true,
    source: 'eventbrite',
  }
}

/**
 * Fetch upcoming free Edmonton events from Eventbrite.
 *
 * Returns empty array if:
 * - EVENTBRITE_API_KEY is not set
 * - API returns an error
 * - Network fails
 *
 * @param windowDays  Look-ahead window in days (default 14)
 */
export async function fetchEventbriteEvents(windowDays = 14): Promise<EventbriteEvent[]> {
  const apiKey = process.env.EVENTBRITE_API_KEY?.trim()
  if (!apiKey) {
    // Key absent — Eventbrite source disabled, not an error
    return []
  }

  const now = new Date()
  const future = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000)

  // Format as Eventbrite expects: "2026-05-16T00:00:00"
  const startMin = now.toISOString().replace('Z', '')
  const startMax = future.toISOString().replace('Z', '')

  const params = new URLSearchParams({
    'location.address': 'Edmonton, AB',
    'location.within': '20km',
    is_free: 'true',
    'start_date.range_start': startMin,
    'start_date.range_end': startMax,
    expand: 'venue',
    page_size: '50',
    sort_by: 'date',
  })

  const url = `${EVENTBRITE_BASE_URL}/events/search?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      // Graceful fallback — API error but not a hard failure
      return []
    }

    const json: EBSearchResponse = await res.json()

    if (json.error) {
      // API returned structured error
      return []
    }

    const events = (json.events ?? [])
      .filter((e) => e.is_free === true)
      .map(normalizeEvent)
      .filter((e) => e.startDate !== '')

    // Sort ascending by start date
    events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())

    return events
  } catch {
    return []
  }
}
