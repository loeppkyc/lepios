// Tier classifier for PageProfit scanner.
// Source of truth: Colin's Q-002 decision (2026-05-09).
// Priority: tier_override > COLLECTIBLE (authors + series + Herbert+Dune) > HIGH_DEMAND > STANDARD.

export type BookTier = 'COLLECTIBLE' | 'HIGH_DEMAND' | 'STANDARD'
export type BookFormat = 'paperback' | 'hardcover' | 'unknown'

// ── Author pattern matching ───────────────────────────────────────────────
// Normalize: lowercase, strip periods, split on whitespace.
// Single-char tokens (initials) prefix-match any author token.
// Multi-char tokens require exact match in the author's token list.

function normTokens(s: string): string[] {
  return s.toLowerCase().replace(/\./g, '').trim().split(/\s+/).filter(Boolean)
}

function authorMatchesPattern(author: string, pattern: string): boolean {
  const aTokens = normTokens(author)
  const pTokens = normTokens(pattern)
  return pTokens.every((pt) =>
    pt.length === 1 ? aTokens.some((at) => at.startsWith(pt)) : aTokens.includes(pt)
  )
}

function authorMatchesAny(author: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => authorMatchesPattern(author, p))
}

// ── Author lists ──────────────────────────────────────────────────────────
// Quoted entries in Colin's spec are disambiguated via full-name patterns.
// "Herbert" excluded here — handled by the Frank Herbert edge case below.

const HIGH_DEMAND_AUTHORS = [
  'Adams',
  'Angelou',
  'Arendt',
  'Asimov',
  'Aurelius',
  'Bradbury',
  'Edgar Burroughs', // Edgar Rice Burroughs (ER Burroughs)
  'Octavia Butler', // Octavia E. Butler (O Butler)
  'Camus',
  'Capote',
  'Carter',
  'Castaneda',
  'Christie',
  'Clavell',
  'Colette',
  'Dostoevsky',
  'Delany',
  'Ellison',
  'Faulkner',
  'Fleming',
  'Freud',
  'Gaiman',
  'Gibran',
  'Heinlein',
  'Heller',
  'Hemingway',
  'Hesse',
  'Huxley',
  'Kafka',
  'Kerouac',
  'Kesey',
  'Stephen King', // S King — disambiguated from other Kings
  'Harper Lee', // H Lee — disambiguated from other Lees
  'LeGuin',
  'Lem',
  'CS Lewis', // C.S. Lewis — normalises to "cs lewis" correctly
  'Marquez',
  'Orwell',
  'Plath',
  'Pratchett',
  'Pynchon',
  'Rand',
  'Salinger',
  'Solzhenitsyn',
  'Steinbeck',
  'Vonnegut',
  'Wodehouse',
] as const

const COLLECTIBLE_AUTHORS = [
  'James Baldwin', // "Baldwin James" in spec — normal name order
  'Peter Beagle', // Peter S. Beagle
  'Brautigan',
  'Bukowski',
  'William Burroughs', // William S. Burroughs (disambiguated from Edgar above)
  'Philip Dick', // Philip K. Dick
  'Fanon', // Frantz Fanon
  'Gygax',
  // Frank Herbert + Dune handled by frankHerbertCollectible() below
  'Jung', // Carl Jung
  'Lovecraft',
  'Selby', // Hubert Selby Jr.
  'Alan Watts',
] as const

// ── Series / franchise detection ──────────────────────────────────────────
// Match against title OR series metadata (case-insensitive substring).

const COLLECTIBLE_SERIES_TAGS = [
  'choose your own adventure',
  'warhammer',
  'dark sun',
  'greyhawk',
  'ravenloft',
  'spelljammer',
] as const

function titleMatchesSeries(title: string): boolean {
  const lower = title.toLowerCase()
  return COLLECTIBLE_SERIES_TAGS.some((tag) => lower.includes(tag))
}

// ── Frank Herbert edge case ───────────────────────────────────────────────

function isHerbertDune(author: string, title: string): boolean {
  return (
    normTokens(author).includes('herbert') &&
    normTokens(author).includes('frank') !== false &&
    title.toLowerCase().includes('dune')
  )
}

function isHerbertNonDune(author: string, title: string): boolean {
  const aTokens = normTokens(author)
  return aTokens.includes('herbert') && !title.toLowerCase().includes('dune')
}

// ── Public API ────────────────────────────────────────────────────────────

export function classifyTier(
  author: string,
  title: string,
  tierOverride?: string | null
): BookTier {
  if (
    tierOverride === 'COLLECTIBLE' ||
    tierOverride === 'HIGH_DEMAND' ||
    tierOverride === 'STANDARD'
  ) {
    return tierOverride
  }

  // COLLECTIBLE checks (higher priority)
  if (isHerbertDune(author, title)) return 'COLLECTIBLE'
  if (titleMatchesSeries(title)) return 'COLLECTIBLE'
  if (authorMatchesAny(author, COLLECTIBLE_AUTHORS)) return 'COLLECTIBLE'

  // HIGH_DEMAND checks
  if (isHerbertNonDune(author, title)) return 'HIGH_DEMAND'
  if (authorMatchesAny(author, HIGH_DEMAND_AUTHORS)) return 'HIGH_DEMAND'

  return 'STANDARD'
}

// Floor prices per tier and format.
// STANDARD has no floor (returns null — market-priced).
export function getFloorPrice(tier: BookTier, format: BookFormat): number | null {
  if (tier === 'STANDARD') return null
  const isHardcover = format === 'hardcover'
  if (tier === 'COLLECTIBLE') return isHardcover ? 14.95 : 10.0
  if (tier === 'HIGH_DEMAND') return isHardcover ? 9.95 : 6.0
  return null
}

// Derive format from SP-API binding string.
export function parseFormat(binding: string): BookFormat {
  const lower = binding.toLowerCase()
  if (lower.includes('hardcover') || lower.includes('hard cover')) return 'hardcover'
  if (lower.includes('paperback') || lower.includes('mass market')) return 'paperback'
  return 'unknown'
}
