// lib/scraper/rfd.ts
// Fetches RedFlagDeals Hot Deals RSS feed and matches against watch keywords.
// RSS URL: https://forums.redflagdeals.com/feed/forum/9
// Returns structured deals with matched keywords.

const RFD_RSS_URL = 'https://forums.redflagdeals.com/feed/forum/9'

export interface RfdDeal {
  guid: string
  title: string
  description: string
  rfdUrl: string
  dealUrl: string | null
  store: string | null
  postedAt: Date | null
  keywordsMatched: string[]
  category: string
}

interface WatchKeyword {
  keyword: string
  category: string
}

/** Extract text content from a single XML tag (first match). */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = xml.match(re)
  if (!m) return ''
  // Strip CDATA wrapper if present
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

/** Extract all <item>...</item> blocks from RSS XML. */
function extractItems(xml: string): string[] {
  const items: string[] = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1])
  }
  return items
}

/** Parse store name from RFD title: many titles end with [StoreName]. */
function parseStore(title: string): string | null {
  const m = title.match(/\[([^\]]+)\]\s*$/)
  return m ? m[1].trim() : null
}

/** Extract the first external (non-RFD) link from description HTML. */
function extractDealUrl(description: string): string | null {
  const re = /href="([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(description)) !== null) {
    const url = m[1]
    if (!url.includes('redflagdeals.com') && url.startsWith('http')) {
      return url
    }
  }
  return null
}

/**
 * Match keywords against title + first 200 chars of description.
 * Returns the keyword objects that matched (case-insensitive).
 */
function matchKeywords(
  title: string,
  description: string,
  keywords: WatchKeyword[]
): WatchKeyword[] {
  const haystack = (title + ' ' + description.slice(0, 200)).toLowerCase()
  return keywords.filter((kw) => haystack.includes(kw.keyword.toLowerCase()))
}

/** Resolve category from matched keywords (first-match wins: resale > grocery > personal > general). */
function resolveCategory(matched: WatchKeyword[]): string {
  if (matched.some((k) => k.category === 'resale')) return 'resale'
  if (matched.some((k) => k.category === 'grocery')) return 'grocery'
  if (matched.some((k) => k.category === 'personal')) return 'personal'
  return 'general'
}

/**
 * Fetch and parse RedFlagDeals Hot Deals RSS, matching against provided keywords.
 * Returns [] on fetch or parse failure — never throws.
 */
export async function fetchRfdHotDeals(keywords: WatchKeyword[]): Promise<RfdDeal[]> {
  let xml: string
  try {
    const res = await fetch(RFD_RSS_URL, {
      headers: {
        'User-Agent': 'LepiOS/1.0 (loeppkycolin@gmail.com)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`[rfd] RSS fetch failed: HTTP ${res.status}`)
      return []
    }
    xml = await res.text()
  } catch (err) {
    console.warn('[rfd] RSS fetch error:', err instanceof Error ? err.message : String(err))
    return []
  }

  const items = extractItems(xml)
  const deals: RfdDeal[] = []

  for (const item of items) {
    try {
      const title = extractTag(item, 'title')
      const description = extractTag(item, 'description')
      const link = extractTag(item, 'link')
      const guid = extractTag(item, 'guid') || link
      const pubDate = extractTag(item, 'pubDate')

      if (!guid || !link) continue

      const matched = matchKeywords(title, description, keywords)
      const keywordsMatched = matched.map((k) => k.keyword)
      const category = matched.length > 0 ? resolveCategory(matched) : 'general'

      let postedAt: Date | null = null
      if (pubDate) {
        const parsed = new Date(pubDate)
        postedAt = isNaN(parsed.getTime()) ? null : parsed
      }

      deals.push({
        guid,
        title,
        description,
        rfdUrl: link,
        dealUrl: extractDealUrl(description),
        store: parseStore(title),
        postedAt,
        keywordsMatched,
        category,
      })
    } catch {
      // Skip malformed items
    }
  }

  return deals
}
