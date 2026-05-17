// Generic URL checker
// Checks a URL for presence or absence of a text pattern (case-insensitive).
// Pattern stored in watch_targets.notes field:
//   "MATCH:Add to Cart"  — alerts when text IS present
//   "ABSENT:Sold Out"    — alerts when text is NOT present
// Bare string (no prefix) defaults to MATCH behaviour.

export interface GenericStatus {
  matched: boolean
  raw_status: string
}

export async function checkGeneric(url: string, pattern: string): Promise<GenericStatus> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LepiOS-WatchBot/1.0)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  let matched: boolean
  if (pattern.startsWith('ABSENT:')) {
    const term = pattern.slice(7)
    matched = !html.toLowerCase().includes(term.toLowerCase())
  } else {
    const term = pattern.startsWith('MATCH:') ? pattern.slice(6) : pattern
    matched = html.toLowerCase().includes(term.toLowerCase())
  }

  return { matched, raw_status: matched ? 'match' : 'no_match' }
}
