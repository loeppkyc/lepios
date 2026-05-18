/**
 * lib/competitive-intel/scraper.ts
 *
 * Fetches AI research papers from three sources:
 *   - arXiv (Atom XML feed)
 *   - Papers With Code (JSON API)
 *   - OpenReview (JSON API, NeurIPS 2025)
 *
 * Each fetch has a 15s timeout and returns [] on failure (non-fatal).
 * Uses fetch() directly — same pattern as lib/scraper/rfd.ts.
 * NOT the arms-legs httpRequest gate (that's for coordinator sandbox).
 */

export interface RawIntelItem {
  source: 'arxiv' | 'paperswithcode' | 'openreview'
  url: string
  title: string
  abstract_snippet: string
}

const FETCH_TIMEOUT_MS = 15_000

function withTimeout(promise: Promise<Response>): Promise<Response> {
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('fetch timeout')), FETCH_TIMEOUT_MS)
    ),
  ])
}

/** Extract text from first matching XML tag. Strips CDATA if present. */
function extractXmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = xml.match(re)
  if (!m) return ''
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

/** Extract all <entry>...</entry> blocks from Atom XML. */
function extractAtomEntries(xml: string): string[] {
  const entries: string[] = []
  const re = /<entry>([\s\S]*?)<\/entry>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    entries.push(m[1])
  }
  return entries
}

/** Extract the href from <link href="..."/> (Atom link element). */
function extractAtomLink(entry: string): string {
  const m = entry.match(/<link[^>]+href="([^"]+)"/)
  return m ? m[1] : ''
}

/**
 * Fetch arXiv cs.AI + cs.MA papers (newest first, up to 50).
 * API: http://export.arxiv.org/api/query
 */
export async function fetchArxiv(): Promise<RawIntelItem[]> {
  const url =
    'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.MA&sortBy=submittedDate&max_results=50'
  let xml: string
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)',
          Accept: 'application/atom+xml, application/xml, text/xml',
        },
        cache: 'no-store',
      })
    )
    if (!res.ok) {
      console.warn(`[competitive-intel/arxiv] HTTP ${res.status}`)
      return []
    }
    xml = await res.text()
  } catch (err) {
    console.warn(
      '[competitive-intel/arxiv] fetch error:',
      err instanceof Error ? err.message : String(err)
    )
    return []
  }

  const entries = extractAtomEntries(xml)
  const items: RawIntelItem[] = []

  for (const entry of entries) {
    try {
      const title = extractXmlTag(entry, 'title').replace(/\s+/g, ' ')
      const summary = extractXmlTag(entry, 'summary').replace(/\s+/g, ' ')
      const link = extractAtomLink(entry)

      if (!title || !link) continue

      items.push({
        source: 'arxiv',
        url: link,
        title,
        abstract_snippet: summary.slice(0, 500),
      })
    } catch {
      // Skip malformed entries
    }
  }

  return items
}

/**
 * Fetch recent Papers With Code papers (newest first, page 1).
 * API: https://paperswithcode.com/api/v1/papers/
 */
export async function fetchPapersWithCode(): Promise<RawIntelItem[]> {
  const url = 'https://paperswithcode.com/api/v1/papers/?ordering=-published&page=1'
  let json: unknown
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)',
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
    )
    if (!res.ok) {
      console.warn(`[competitive-intel/pwc] HTTP ${res.status}`)
      return []
    }
    json = await res.json()
  } catch (err) {
    console.warn(
      '[competitive-intel/pwc] fetch error:',
      err instanceof Error ? err.message : String(err)
    )
    return []
  }

  const results = (json as { results?: unknown[] })?.results
  if (!Array.isArray(results)) return []

  const items: RawIntelItem[] = []
  for (const r of results) {
    try {
      const row = r as { name?: string; url?: string; abstract?: string }
      const title = (row.name ?? '').trim()
      const paperUrl = (row.url ?? '').trim()
      const abstract = (row.abstract ?? '').trim()

      if (!title || !paperUrl) continue

      // Normalize relative URLs
      const fullUrl = paperUrl.startsWith('http')
        ? paperUrl
        : `https://paperswithcode.com${paperUrl}`

      items.push({
        source: 'paperswithcode',
        url: fullUrl,
        title,
        abstract_snippet: abstract.slice(0, 500),
      })
    } catch {
      // Skip malformed entries
    }
  }

  return items
}

/**
 * Fetch OpenReview NeurIPS 2025 submissions (up to 50).
 * API: https://api2.openreview.net/notes
 */
export async function fetchOpenReview(): Promise<RawIntelItem[]> {
  const url =
    'https://api2.openreview.net/notes?content.venue=NeurIPS+2025&offset=0&limit=50'
  let json: unknown
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)',
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
    )
    if (!res.ok) {
      console.warn(`[competitive-intel/openreview] HTTP ${res.status}`)
      return []
    }
    json = await res.json()
  } catch (err) {
    console.warn(
      '[competitive-intel/openreview] fetch error:',
      err instanceof Error ? err.message : String(err)
    )
    return []
  }

  const notes = (json as { notes?: unknown[] })?.notes
  if (!Array.isArray(notes)) return []

  const items: RawIntelItem[] = []
  for (const n of notes) {
    try {
      const note = n as { id?: string; content?: { title?: unknown; abstract?: unknown } }
      const id = (note.id ?? '').trim()
      const content = note.content ?? {}
      // title can be a string or { value: string } in newer API responses
      const titleRaw = content.title
      const title =
        typeof titleRaw === 'string'
          ? titleRaw.trim()
          : typeof (titleRaw as { value?: string })?.value === 'string'
            ? ((titleRaw as { value: string }).value).trim()
            : ''
      const abstractRaw = content.abstract
      const abstract =
        typeof abstractRaw === 'string'
          ? abstractRaw.trim()
          : typeof (abstractRaw as { value?: string })?.value === 'string'
            ? ((abstractRaw as { value: string }).value).trim()
            : ''

      if (!title || !id) continue

      items.push({
        source: 'openreview',
        url: `https://openreview.net/forum?id=${id}`,
        title,
        abstract_snippet: abstract.slice(0, 500),
      })
    } catch {
      // Skip malformed entries
    }
  }

  return items
}
