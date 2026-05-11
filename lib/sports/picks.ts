// Sports picks CRUD — Supabase replacement for Google Sheets Sports_Picks_Log
// Ports: tools/sports_predictions.py log_picks_to_sheet + results tracking

import { createClient } from '@/lib/supabase/server'
import type { Game } from '@/lib/sports/odds'
import { oddsToPayout } from '@/lib/sports/odds'

export interface SportsPick {
  id: string
  picked_on: string
  sport_key: string
  league: string
  game_id: string
  home: string
  away: string
  favorite: string
  fav_odds: number
  dog_odds: number
  implied_prob: number | null
  commence_str: string | null
  tier: 'green' | 'red'
  winner: string | null
  fav_won: boolean | null
  pnl: number | null
  updated_at: string | null
  created_at: string
}

export interface PicksSummary {
  total: number
  wins: number
  losses: number
  pnl: number
  win_rate: number
  roi: number
}

export async function logPicksForDay(games: Game[]): Promise<number> {
  if (!games.length) return 0
  const supabase = await createClient()

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

  const rows = games.map((g) => ({
    picked_on: today,
    sport_key: g.sport_key,
    league: g.league,
    game_id: g.game_id,
    home: g.home,
    away: g.away,
    favorite: g.favorite,
    fav_odds: g.fav_odds,
    dog_odds: g.dog_odds,
    implied_prob: g.implied_prob,
    commence_str: g.commence_str,
    tier: g.fav_odds <= -150 ? 'green' : 'red',
  }))

  const { data, error } = await supabase
    .from('sports_picks')
    .upsert(rows, { onConflict: 'game_id,picked_on', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`logPicksForDay: ${error.message}`)
  return data?.length ?? 0
}

export async function getPicksForRange(from: string, to: string): Promise<SportsPick[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sports_picks')
    .select('*')
    .gte('picked_on', from)
    .lte('picked_on', to)
    .order('picked_on', { ascending: false })
    .order('fav_odds', { ascending: true })

  if (error) throw new Error(`getPicksForRange: ${error.message}`)
  return (data ?? []) as SportsPick[]
}

export async function updatePickResult(
  gameId: string,
  pickedOn: string,
  winner: string,
  favWon: boolean
): Promise<void> {
  const supabase = await createClient()

  const { data: pick, error: fetchErr } = await supabase
    .from('sports_picks')
    .select('fav_odds')
    .eq('game_id', gameId)
    .eq('picked_on', pickedOn)
    .single()

  if (fetchErr || !pick) return

  const pnl = favWon ? oddsToPayout(pick.fav_odds as number, 100) : -100

  await supabase
    .from('sports_picks')
    .update({ winner, fav_won: favWon, pnl, updated_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('picked_on', pickedOn)
}

export function summarizePicks(picks: SportsPick[]): PicksSummary {
  const settled = picks.filter((p) => p.fav_won !== null && p.pnl !== null)
  const wins = settled.filter((p) => p.fav_won).length
  const losses = settled.length - wins
  const pnl = settled.reduce((acc, p) => acc + (p.pnl ?? 0), 0)
  const winRate = settled.length ? (wins / settled.length) * 100 : 0
  const roi = settled.length ? (pnl / (settled.length * 100)) * 100 : 0
  return { total: settled.length, wins, losses, pnl, win_rate: winRate, roi }
}
