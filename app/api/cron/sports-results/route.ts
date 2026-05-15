// Nightly settlement cron — fetches scores from The Odds API and settles
// unsettled sports_picks. Triggers AI debrief for each settled pick.
// Schedule: 0 6 * * * (midnight MDT = 6:00 UTC)
// F22: auth via requireCronSecret

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { oddsToPayout } from '@/lib/sports/odds'
import { generateDebrief } from '@/lib/sports/debrief'
import type { SportsPick } from '@/lib/sports/picks'

export const dynamic = 'force-dynamic'

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

interface OddsApiScore {
  id: string
  sport_key: string
  completed: boolean
  scores: { name: string; score: string }[] | null
}

async function fetchScores(sportKey: string, apiKey: string): Promise<OddsApiScore[]> {
  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/scores/`)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('daysFrom', '2')
  try {
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
    if (resp.status === 200) return (await resp.json()) as OddsApiScore[]
    return []
  } catch {
    return []
  }
}

function getWinner(game: OddsApiScore): string | null {
  if (!game.completed || !game.scores || game.scores.length < 2) return null
  const [a, b] = game.scores
  const scoreA = parseInt(a.score, 10)
  const scoreB = parseInt(b.score, 10)
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA === scoreB) return null
  return scoreA > scoreB ? a.name : b.name
}

export async function POST(request: NextRequest) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = await createClient()
  const apiKey = process.env.ODDS_API_KEY ?? ''

  // 1. Fetch unsettled picks from yesterday or earlier
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const cutoff = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  const { data: unsettled, error: fetchErr } = await supabase
    .from('sports_picks')
    .select('*')
    .is('winner', null)
    .lte('picked_on', cutoff)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const picks = (unsettled ?? []) as SportsPick[]
  if (!picks.length) {
    await logEvent(supabase, 'nightly_settlement', {
      settled_count: 0,
      skipped_count: 0,
      errors: 0,
    })
    return NextResponse.json({ settled: 0, skipped: 0 })
  }

  // 2. Group by sport_key and fetch scores per sport
  const sportKeys = [...new Set(picks.map((p) => p.sport_key))]
  const scoresByGameId: Map<string, string> = new Map()

  await Promise.all(
    sportKeys.map(async (sportKey) => {
      if (!apiKey) return
      const scores = await fetchScores(sportKey, apiKey)
      for (const game of scores) {
        const winner = getWinner(game)
        if (winner) scoresByGameId.set(game.id, winner)
      }
    })
  )

  // 3. Settle each matched pick
  let settledCount = 0
  let skippedCount = 0
  let errorCount = 0
  const settledIds: string[] = []

  await Promise.all(
    picks.map(async (pick) => {
      const winner = scoresByGameId.get(pick.game_id)
      if (!winner) {
        skippedCount++
        return
      }

      const favWon = winner === pick.favorite
      const pnl = favWon ? oddsToPayout(pick.fav_odds, 100) : -100

      const { error: updateErr } = await supabase
        .from('sports_picks')
        .update({
          winner,
          fav_won: favWon,
          pnl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pick.id)

      if (updateErr) {
        errorCount++
      } else {
        settledCount++
        settledIds.push(pick.id)
      }
    })
  )

  // 4. Trigger debrief for each settled pick — call lib directly (avoids HTTP auth complexity)
  // Matches the settled picks from our in-memory settlement pass above
  const settledPickObjects = picks
    .filter((p) => settledIds.includes(p.id))
    .map((p) => ({
      ...p,
      winner: scoresByGameId.get(p.game_id) ?? null,
      fav_won: scoresByGameId.get(p.game_id) === p.favorite,
      pnl: scoresByGameId.get(p.game_id) === p.favorite ? oddsToPayout(p.fav_odds, 100) : -100,
    }))

  if (settledPickObjects.length) {
    await Promise.all(
      settledPickObjects.map(async (pick) => {
        try {
          const debrief = await generateDebrief(pick as SportsPick)
          await supabase
            .from('sports_picks')
            .update({ ai_debrief: debrief, updated_at: new Date().toISOString() })
            .eq('id', pick.id)
        } catch {
          // debrief failure is non-blocking
        }
      })
    )
  }

  // 5. Log to agent_events
  await logEvent(supabase, 'nightly_settlement', {
    settled_count: settledCount,
    skipped_count: skippedCount,
    errors: errorCount,
  })

  // 6. Drain notifications
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
    await fetch(`${base}/api/harness/notifications-drain`, { method: 'POST' })
  } catch {
    // non-blocking
  }

  return NextResponse.json({ settled: settledCount, skipped: skippedCount, errors: errorCount })
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
