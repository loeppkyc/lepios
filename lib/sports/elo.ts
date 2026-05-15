// NHL Elo rating math — ports sports_backtester.py constants and formulas
// TODO: tune constants with real data once 50+ games processed

// ── Constants (from Streamlit sports_backtester.py) ──────────────────────────
// TODO: tune with real data
const ELO_K = 20 // learning rate
// TODO: tune with real data
const ELO_HOME_ADV = 50 // home ice advantage in Elo points
// TODO: tune with real data
const ELO_START = 1500 // new team default Elo rating

export { ELO_K, ELO_HOME_ADV, ELO_START }

// ── Core Elo math ─────────────────────────────────────────────────────────────

/**
 * expectedScore — probability that player A beats player B.
 * Standard Elo formula: 1 / (1 + 10^((ratingB - ratingA) / 400))
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * updateElo — apply one game result to both teams.
 * Home advantage is applied by adding ELO_HOME_ADV to homeElo before computing
 * expected scores, then removed before storing. This biases the expected-score
 * calculation without permanently inflating home Elo.
 */
export function updateElo(
  winnerElo: number,
  loserElo: number,
  homeWon: boolean
): { newWinner: number; newLoser: number } {
  // Apply home advantage to the home team before computing expected score
  const homeAdj = homeWon ? ELO_HOME_ADV : -ELO_HOME_ADV
  const adjWinner = winnerElo + (homeWon ? homeAdj : 0)
  const adjLoser = loserElo + (homeWon ? 0 : -homeAdj)

  const expected = expectedScore(adjWinner, adjLoser)
  const delta = ELO_K * (1 - expected)

  return {
    newWinner: Math.round((winnerElo + delta) * 100) / 100,
    newLoser: Math.round((loserElo - delta) * 100) / 100,
  }
}

/**
 * eloToWinProb — home team win probability given both Elo ratings.
 * Applies home advantage offset before computing expected score.
 */
export function eloToWinProb(homeElo: number, awayElo: number): number {
  return expectedScore(homeElo + ELO_HOME_ADV, awayElo)
}

/**
 * eloEdge — difference between Elo-derived win probability and market-implied prob.
 * Positive = Elo says home team is undervalued by the market.
 * Negative = market is more bullish on home team than Elo supports.
 */
export function eloEdge(homeElo: number, awayElo: number, marketImpliedProb: number): number {
  return eloToWinProb(homeElo, awayElo) - marketImpliedProb
}

// ── Team helpers ──────────────────────────────────────────────────────────────

export interface EloRating {
  id: string
  sport: string
  team: string
  elo: number
  wins: number
  losses: number
  games_played: number
  last_game_at: string | null
  updated_at: string
  created_at: string
}
