// Nightly NHL Elo rebuild cron — fetches NHL schedule from season start,
// replays all completed games day-by-day, upserts elo_ratings table.
// Schedule: 0 7 * * * (1:00 AM MDT = 7:00 UTC) — runs after sports-results cron
// F22: auth via requireCronSecret

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { updateElo, ELO_START } from '@/lib/sports/elo'

export const dynamic = 'force-dynamic'

// NHL season start 2025-2026
// TODO: tune — update each season start; could be derived from NHL API if needed
const NHL_SEASON_START = '2025-10-04'
const NHL_API_BASE = 'https://api-web.nhle.com/v1'

interface NhlGame {
  id: number
  homeTeam: { abbrev: string; score?: number }
  awayTeam: { abbrev: string; score?: number }
  gameState: string
}

interface NhlScheduleDay {
  games: NhlGame[]
}

interface NhlScheduleResponse {
  gameWeek?: NhlScheduleDay[]
}

async function fetchNhlSchedule(date: string): Promise<NhlGame[]> {
  try {
    const resp = await fetch(`${NHL_API_BASE}/schedule/${date}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (resp.status !== 200) return []
    const data = (await resp.json()) as NhlScheduleResponse
    return data.gameWeek?.flatMap((day) => day.games ?? []) ?? []
  } catch {
    return []
  }
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const current = new Date(start)
  const last = new Date(end)
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export async function POST(request: NextRequest) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = await createClient()

  // Fetch all dates from season start to yesterday
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const endDate = yesterday.toISOString().slice(0, 10)

  const dates = dateRange(NHL_SEASON_START, endDate)

  // Build in-memory Elo map: team → { elo, wins, losses, games_played, last_game_at }
  const eloMap: Map<
    string,
    { elo: number; wins: number; losses: number; games_played: number; last_game_at: string }
  > = new Map()

  function getElo(team: string): number {
    return eloMap.get(team)?.elo ?? ELO_START
  }

  let gamesProcessed = 0

  // Fetch schedule in batches of 7 days to avoid rate limits
  // NHL API returns a week of games per call, so we step by 7
  for (let i = 0; i < dates.length; i += 7) {
    const date = dates[i]
    const games = await fetchNhlSchedule(date)

    for (const game of games) {
      // gameState "OFF" = final
      if (game.gameState !== 'OFF') continue
      const homeScore = game.homeTeam.score
      const awayScore = game.awayTeam.score
      if (homeScore === undefined || awayScore === undefined) continue
      if (homeScore === awayScore) continue // shootout handled as win/loss in NHL

      const home = game.homeTeam.abbrev
      const away = game.awayTeam.abbrev
      const homeWon = homeScore > awayScore

      const homeElo = getElo(home)
      const awayElo = getElo(away)

      const { newWinner, newLoser } = updateElo(
        homeWon ? homeElo : awayElo,
        homeWon ? awayElo : homeElo,
        homeWon
      )

      const gameDate = dates[Math.min(i, dates.length - 1)]

      const homeEntry = eloMap.get(home) ?? {
        elo: ELO_START,
        wins: 0,
        losses: 0,
        games_played: 0,
        last_game_at: gameDate,
      }
      const awayEntry = eloMap.get(away) ?? {
        elo: ELO_START,
        wins: 0,
        losses: 0,
        games_played: 0,
        last_game_at: gameDate,
      }

      if (homeWon) {
        eloMap.set(home, {
          elo: newWinner,
          wins: homeEntry.wins + 1,
          losses: homeEntry.losses,
          games_played: homeEntry.games_played + 1,
          last_game_at: gameDate,
        })
        eloMap.set(away, {
          elo: newLoser,
          wins: awayEntry.wins,
          losses: awayEntry.losses + 1,
          games_played: awayEntry.games_played + 1,
          last_game_at: gameDate,
        })
      } else {
        eloMap.set(away, {
          elo: newWinner,
          wins: awayEntry.wins + 1,
          losses: awayEntry.losses,
          games_played: awayEntry.games_played + 1,
          last_game_at: gameDate,
        })
        eloMap.set(home, {
          elo: newLoser,
          wins: homeEntry.wins,
          losses: homeEntry.losses + 1,
          games_played: homeEntry.games_played + 1,
          last_game_at: gameDate,
        })
      }

      gamesProcessed++
    }
  }

  // Upsert all teams into elo_ratings
  const upsertRows = Array.from(eloMap.entries()).map(([team, stats]) => ({
    sport: 'nhl',
    team,
    elo: stats.elo,
    wins: stats.wins,
    losses: stats.losses,
    games_played: stats.games_played,
    last_game_at: stats.last_game_at,
    updated_at: new Date().toISOString(),
  }))

  let teamsUpdated = 0
  if (upsertRows.length) {
    const { error: upsertErr } = await supabase
      .from('elo_ratings')
      .upsert(upsertRows, { onConflict: 'sport,team' })

    if (upsertErr) {
      await logEvent(supabase, 'elo_rebuild', {
        games_processed: gamesProcessed,
        teams_updated: 0,
        error: upsertErr.message,
      })
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }
    teamsUpdated = upsertRows.length
  }

  await logEvent(supabase, 'elo_rebuild', {
    games_processed: gamesProcessed,
    teams_updated: teamsUpdated,
  })

  return NextResponse.json({ games_processed: gamesProcessed, teams_updated: teamsUpdated })
}

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  meta: Record<string, unknown>
) {
  await supabase.from('agent_events').insert({
    domain: 'sports',
    action,
    meta,
    created_at: new Date().toISOString(),
  })
}
