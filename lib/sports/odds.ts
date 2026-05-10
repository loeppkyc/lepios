// Sports Odds — The Odds API client (ports utils/sports_odds.py)
// Alberta-focused leagues: NHL, CFL, NBA, NFL, MLB, MLS, EPL, UEFA, UFC, Tennis, Golf

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

export const ALBERTA_SPORTS: Record<string, string> = {
  icehockey_nhl: 'NHL',
  americanfootball_cfl: 'CFL',
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  baseball_mlb: 'MLB',
  soccer_usa_mls: 'MLS',
  soccer_epl: 'EPL',
  soccer_uefa_champs_league: 'UEFA CL',
  soccer_uefa_europa_league: 'UEFA EL',
  mma_mixed_martial_arts: 'UFC/MMA',
  tennis_atp_french_open: 'ATP Tennis',
  tennis_wta_french_open: 'WTA Tennis',
  golf_pga_championship: 'PGA Golf',
}

export interface Game {
  sport_key: string
  league: string
  game_id: string
  home: string
  away: string
  favorite: string
  fav_odds: number
  dog_odds: number
  home_odds: number
  away_odds: number
  implied_prob: number
  commence_iso: string
  commence_str: string
  num_books: number
  is_demo?: boolean
}

// ── Odds math ─────────────────────────────────────────────────────────────────

export function americanToImpliedProb(odds: number): number {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100)
  return 100 / (odds + 100)
}

export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds)
}

export function oddsToPayout(odds: number, stake: number): number {
  if (odds < 0) return Math.round(((stake * 100) / Math.abs(odds)) * 100) / 100
  return Math.round(((stake * odds) / 100) * 100) / 100
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function bestOddsForTeam(bookmakers: unknown[], teamName: string): number | null {
  const prices: number[] = []
  for (const bm of bookmakers as Record<string, unknown>[]) {
    for (const market of (bm.markets as Record<string, unknown>[]) ?? []) {
      if (market.key !== 'h2h') continue
      for (const outcome of (market.outcomes as Record<string, unknown>[]) ?? []) {
        if (outcome.name === teamName) prices.push(outcome.price as number)
      }
    }
  }
  if (!prices.length) return null
  return Math.round(Math.max(...prices))
}

function parseGame(raw: Record<string, unknown>, sportKey: string): Game | null {
  try {
    const home = raw.home_team as string
    const away = raw.away_team as string
    const bookmakers = (raw.bookmakers as unknown[]) ?? []
    if (!bookmakers.length) return null

    const homeOdds = bestOddsForTeam(bookmakers, home)
    const awayOdds = bestOddsForTeam(bookmakers, away)
    if (homeOdds === null || awayOdds === null) return null

    let favorite: string, favOdds: number, dogOdds: number
    if (homeOdds < awayOdds) {
      favorite = home
      favOdds = homeOdds
      dogOdds = awayOdds
    } else if (awayOdds < homeOdds) {
      favorite = away
      favOdds = awayOdds
      dogOdds = homeOdds
    } else {
      return null // pick-em
    }

    const commenceIso = raw.commence_time as string
    const commence = new Date(commenceIso)
    const mt = commence.toLocaleString('en-CA', {
      timeZone: 'America/Edmonton',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    return {
      sport_key: sportKey,
      league: ALBERTA_SPORTS[sportKey] ?? sportKey,
      game_id: (raw.id as string) ?? '',
      home,
      away,
      favorite,
      fav_odds: favOdds,
      dog_odds: dogOdds,
      home_odds: homeOdds,
      away_odds: awayOdds,
      implied_prob: Math.round(americanToImpliedProb(favOdds) * 1000) / 10,
      commence_iso: commenceIso,
      commence_str: mt + ' MT',
      num_books: bookmakers.length,
    }
  } catch {
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkApiConnection(
  apiKey: string
): Promise<{ status: string; message: string; remaining?: string }> {
  if (!apiKey) return { status: 'no_key', message: 'No API key configured' }
  try {
    const url = new URL(`${ODDS_API_BASE}/sports/icehockey_nhl/odds/`)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('regions', 'us')
    url.searchParams.set('markets', 'h2h')
    url.searchParams.set('oddsFormat', 'american')
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
    const remaining = resp.headers.get('x-requests-remaining') ?? '?'
    const used = resp.headers.get('x-requests-used') ?? '?'
    if (resp.status === 200) {
      const data = (await resp.json()) as unknown[]
      return {
        status: 'ok',
        message: `Key valid | ${remaining} requests remaining (${used} used) | NHL returned ${data.length} games`,
        remaining,
      }
    }
    if (resp.status === 401) return { status: 'invalid_key', message: 'API key invalid (401)' }
    if (resp.status === 429)
      return {
        status: 'quota_exceeded',
        message: `Monthly quota exceeded — ${remaining} remaining`,
      }
    return { status: 'error', message: `HTTP ${resp.status}` }
  } catch (e) {
    return { status: 'error', message: `Network error: ${String(e).slice(0, 80)}` }
  }
}

async function fetchSportOdds(
  sportKey: string,
  apiKey: string
): Promise<{ games: Record<string, unknown>[]; error: string }> {
  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/odds/`)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('regions', 'us,eu')
  url.searchParams.set('markets', 'h2h')
  url.searchParams.set('oddsFormat', 'american')
  url.searchParams.set('dateFormat', 'iso')
  try {
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
    if (resp.status === 200)
      return { games: (await resp.json()) as Record<string, unknown>[], error: '' }
    if (resp.status === 422) return { games: [], error: '' } // not in season
    return { games: [], error: `HTTP ${resp.status}` }
  } catch (e) {
    return { games: [], error: String(e).slice(0, 80) }
  }
}

export async function getTodaysGames(apiKey: string): Promise<Game[]> {
  if (!apiKey) return mockGames()

  const now = new Date()
  const todayEndMT = new Date(now.toLocaleString('en-CA', { timeZone: 'America/Edmonton' }))
  todayEndMT.setHours(23, 59, 59, 999)

  const allGames: Game[] = []
  let hadError = false

  await Promise.all(
    Object.keys(ALBERTA_SPORTS).map(async (sportKey) => {
      const { games: rawList, error } = await fetchSportOdds(sportKey, apiKey)
      if (error) hadError = true
      for (const raw of rawList) {
        const game = parseGame(raw, sportKey)
        if (!game) continue
        const commenceLocal = new Date(
          new Date(game.commence_iso).toLocaleString('en-CA', { timeZone: 'America/Edmonton' })
        )
        if (commenceLocal <= todayEndMT) allGames.push(game)
      }
    })
  )

  allGames.sort((a, b) => a.commence_iso.localeCompare(b.commence_iso))
  if (!allGames.length && hadError) return mockGames()
  return allGames
}

export function filterFavorites(games: Game[], maxOdds = -150): Game[] {
  return games.filter((g) => g.fav_odds <= maxOdds)
}

// ── Mock data (shown when no API key) ─────────────────────────────────────────

function mockGames(): Game[] {
  const now = new Date()
  const make = (
    home: string,
    away: string,
    hOdds: number,
    aOdds: number,
    sportKey: string
  ): Game => {
    const fav = hOdds < aOdds ? home : away
    const favOdds = hOdds < aOdds ? hOdds : aOdds
    const dogOdds = hOdds < aOdds ? aOdds : hOdds
    return {
      sport_key: sportKey,
      league: ALBERTA_SPORTS[sportKey] ?? sportKey,
      game_id: `demo_${home.slice(0, 3)}`,
      home,
      away,
      favorite: fav,
      fav_odds: favOdds,
      dog_odds: dogOdds,
      home_odds: hOdds,
      away_odds: aOdds,
      implied_prob: Math.round(americanToImpliedProb(favOdds) * 1000) / 10,
      commence_iso: now.toISOString(),
      commence_str: 'Today 7:00 PM MT (demo)',
      num_books: 8,
      is_demo: true,
    }
  }
  return [
    make('Edmonton Oilers', 'Calgary Flames', -165, 140, 'icehockey_nhl'),
    make('Toronto Maple Leafs', 'Ottawa Senators', -180, 155, 'icehockey_nhl'),
    make('Edmonton Elks', 'Calgary Stampeders', -130, 110, 'americanfootball_cfl'),
    make('Golden State Warriors', 'Portland Trail Blazers', -220, 185, 'basketball_nba'),
    make('Los Angeles Kings', 'Anaheim Ducks', -155, 130, 'icehockey_nhl'),
    make('Manchester City', 'Arsenal', -140, 380, 'soccer_epl'),
    make('New York Yankees', 'Boston Red Sox', -170, 145, 'baseball_mlb'),
  ]
}
