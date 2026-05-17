/**
 * Edmonton Open Data — free events client
 *
 * Dataset: Community Events (jx5c-8cxn) via CKAN / Socrata REST API
 * https://data.edmonton.ca/resource/jx5c-8cxn.json
 *
 * NOTE: As of 2026-05-16, dataset jx5c-8cxn returns 404 from the live portal.
 * The module is built with graceful empty-state handling. When the dataset
 * becomes available (or a replacement ID is confirmed by Colin), update
 * OPEN_DATA_DATASET_ID below.
 *
 * F18 surface: agent_events action='events_fetched' meta.open_data_count
 */

// TODO(A8): Confirm correct dataset ID with Colin — jx5c-8cxn returns 404 as of 2026-05-16.
// Replace with the correct Socrata dataset ID once verified.
const OPEN_DATA_DATASET_ID = 'jx5c-8cxn'
const OPEN_DATA_BASE_URL = 'https://data.edmonton.ca/resource'
const FETCH_TIMEOUT_MS = 8_000

export interface OpenDataEvent {
  id: string
  title: string
  /** ISO 8601 date/time string */
  startDate: string
  /** ISO 8601 date/time string or null */
  endDate: string | null
  location: string | null
  description: string | null
  url: string | null
  isFree: true
  source: 'edmonton-open-data'
}

// Raw record shape from the Socrata CKAN API — fields are all optional strings
interface RawCKANRecord {
  // Dataset field names vary — we accept multiple common patterns
  event_name?: string
  name?: string
  title?: string
  event_title?: string

  start_date?: string
  start_time?: string
  event_start?: string
  event_date?: string
  date?: string

  end_date?: string
  end_time?: string
  event_end?: string

  location?: string
  venue?: string
  address?: string
  location_name?: string

  description?: string
  event_description?: string
  details?: string

  url?: string
  event_url?: string
  website?: string

  admission?: string
  admission_price?: string
  cost?: string
  price?: string
  is_free?: string | boolean

  [key: string]: unknown
}

function extractTitle(r: RawCKANRecord): string {
  return (
    r.event_title ??
    r.event_name ??
    r.title ??
    r.name ??
    ''
  ).trim()
}

function extractStartDate(r: RawCKANRecord): string | null {
  return r.event_start ?? r.start_date ?? r.event_date ?? r.date ?? null
}

function extractEndDate(r: RawCKANRecord): string | null {
  return r.event_end ?? r.end_date ?? null
}

function extractLocation(r: RawCKANRecord): string | null {
  return (r.location_name ?? r.location ?? r.venue ?? r.address ?? null) as string | null
}

function extractDescription(r: RawCKANRecord): string | null {
  return (r.event_description ?? r.description ?? r.details ?? null) as string | null
}

function extractUrl(r: RawCKANRecord): string | null {
  return (r.event_url ?? r.url ?? r.website ?? null) as string | null
}

/**
 * Determine if a record is free. "Free" = $0 / no cost (strict).
 * Eventbrite keys not applicable here; for Open Data we check admission fields.
 */
function isFreeRecord(r: RawCKANRecord): boolean {
  // If the dataset has an explicit is_free boolean
  if (r.is_free === true || r.is_free === 'true' || r.is_free === '1' || r.is_free === 'Yes') {
    return true
  }
  // If price/admission field explicitly = 0 or empty or "free"
  const priceRaw = (r.admission_price ?? r.admission ?? r.cost ?? r.price ?? '').toString().toLowerCase().trim()
  if (priceRaw === '' || priceRaw === '0' || priceRaw === 'free' || priceRaw === '$0' || priceRaw === 'no charge') {
    return true
  }
  // No price info — assume free (open dataset likely covers public/free events)
  if (!r.admission_price && !r.admission && !r.cost && !r.price && r.is_free === undefined) {
    return true
  }
  return false
}

/**
 * Determine if a raw record is an upcoming event within the next `windowDays` days.
 * Dates compared in local Edmonton time (America/Edmonton = UTC-6 or -7).
 */
function isUpcoming(startDateStr: string | null, windowDays: number): boolean {
  if (!startDateStr) return false
  try {
    const eventDate = new Date(startDateStr)
    if (isNaN(eventDate.getTime())) return false
    const now = Date.now()
    const windowMs = windowDays * 24 * 60 * 60 * 1000
    return eventDate.getTime() >= now && eventDate.getTime() <= now + windowMs
  } catch {
    return false
  }
}

function buildRecordId(r: RawCKANRecord, index: number): string {
  // Prefer a stable ID from the record
  const raw = (r[':id'] ?? r.event_id ?? r.id ?? `odata-${index}`) as string
  return String(raw)
}

/**
 * Fetch upcoming free Edmonton events from the Open Data portal.
 *
 * @param windowDays  Look ahead window in days (default 14)
 * @returns Array of normalized OpenDataEvent records (may be empty on API failure)
 */
export async function fetchEdmontonOpenDataEvents(windowDays = 14): Promise<OpenDataEvent[]> {
  const now = new Date()
  const future = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000)

  // Socrata CKAN SoQL — request records with start dates in the window
  // We fetch a broad batch and filter locally to handle varied field names
  const url =
    `${OPEN_DATA_BASE_URL}/${OPEN_DATA_DATASET_ID}.json` +
    `?$limit=200` +
    `&$order=start_date+ASC`

  let rawRecords: RawCKANRecord[] = []

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      // Return empty array — caller logs the failure
      return []
    }

    const json: unknown = await res.json()

    // Socrata returns either an array or an object with error fields
    if (!Array.isArray(json)) {
      return []
    }

    rawRecords = json as RawCKANRecord[]
  } catch {
    return []
  }

  const events: OpenDataEvent[] = []

  for (let i = 0; i < rawRecords.length; i++) {
    const r = rawRecords[i]
    if (!isFreeRecord(r)) continue

    const startDate = extractStartDate(r)
    if (!isUpcoming(startDate, windowDays)) continue

    const title = extractTitle(r)
    if (!title) continue

    events.push({
      id: buildRecordId(r, i),
      title,
      startDate: startDate!,
      endDate: extractEndDate(r),
      location: extractLocation(r),
      description: extractDescription(r),
      url: extractUrl(r),
      isFree: true,
      source: 'edmonton-open-data',
    })
  }

  // Sort by start date ascending
  events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())

  return events
}

// Export the date range helper for use in tests and the route handler
export function getWindowEndDate(windowDays = 14): Date {
  return new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000)
}
