/**
 * Bankroll history + health metrics from the bets table.
 *
 * Computes running high-water mark, current drawdown, and a quarter-Kelly
 * stake recommendation based on current bankroll and average historical odds.
 *
 * Domain rule: uses bankroll_after from the bets table, ordered ascending by
 * bet_date. Bets without bankroll_after are ignored.
 *
 * Kelly fraction cap: 0.25 (quarter Kelly, conservative default).
 * TODO: tune with real data — average odds and edge estimates may need adjustment.
 */

export interface BetForBankroll {
  bet_date: string // YYYY-MM-DD
  bankroll_after: number | null
  pnl: number | null
}

export interface BankrollPoint {
  date: string
  bankroll: number
  pnl: number
  high_water_mark: number
}

export interface BankrollSummary {
  current: number
  start_of_year: number
  high_water_mark: number
  /** Percentage drawdown from HWM (negative when below HWM) */
  current_drawdown_pct: number
  /** Quarter-Kelly max stake at current bankroll — TODO: tune with real data */
  kelly_stake: number
  history: BankrollPoint[]
}

/**
 * Quarter-Kelly stake given a win probability (p), moneyline odds, and bankroll.
 *
 * Kelly fraction = (p * b - q) / b
 *   where b = decimal odds − 1
 *         q = 1 − p
 *
 * Returns stake * KELLY_FRACTION (0.25 by default).
 * Clamped to [0, bankroll].
 *
 * TODO: tune p and avg_odds defaults with real data.
 */
export const KELLY_FRACTION = 0.25 // TODO: tune with real data

export function kellyStake(
  p: number, // estimated win probability 0–1
  odds: number, // American moneyline, e.g. -150 or +120
  bankroll: number,
  fraction = KELLY_FRACTION
): number {
  if (bankroll <= 0 || p <= 0 || p >= 1) return 0

  // Convert American odds to decimal profit per unit (b)
  const b = odds >= 0 ? odds / 100 : 100 / Math.abs(odds)
  const q = 1 - p
  const f = (p * b - q) / b

  if (f <= 0) return 0
  const stake = bankroll * f * fraction
  return parseFloat(Math.min(stake, bankroll).toFixed(2))
}

/**
 * Compute bankroll history + summary from a list of bets.
 *
 * @param bets  Bets ordered ascending by bet_date. Caller should pass all bets
 *              with bankroll_after populated; this function filters internally.
 */
export function computeBankrollSummary(bets: BetForBankroll[]): BankrollSummary {
  // Filter to bets with a bankroll reading, sort ascending
  const sorted = [...bets]
    .filter((b) => b.bankroll_after != null)
    .sort((a, b) => (a.bet_date < b.bet_date ? -1 : 1)) as (BetForBankroll & {
    bankroll_after: number
  })[]

  if (sorted.length === 0) {
    return {
      current: 0,
      start_of_year: 0,
      high_water_mark: 0,
      current_drawdown_pct: 0,
      kelly_stake: 0,
      history: [],
    }
  }

  const currentYear = new Date().getFullYear().toString()
  const history: BankrollPoint[] = []
  let runningHwm = sorted[0].bankroll_after

  for (const bet of sorted) {
    if (bet.bankroll_after > runningHwm) runningHwm = bet.bankroll_after
    history.push({
      date: bet.bet_date,
      bankroll: bet.bankroll_after,
      pnl: bet.pnl ?? 0,
      high_water_mark: runningHwm,
    })
  }

  const current = sorted[sorted.length - 1].bankroll_after
  const hwm = runningHwm
  const currentDrawdownPct = hwm > 0 ? parseFloat((((current - hwm) / hwm) * 100).toFixed(1)) : 0

  // Start of year: find the last bankroll_after in the previous year
  const startOfYearBet = [...sorted].reverse().find((b) => !b.bet_date.startsWith(currentYear))
  const startOfYear = startOfYearBet?.bankroll_after ?? sorted[0].bankroll_after

  // Quarter-Kelly at average -150 odds (conservative default)
  // TODO: tune with real data — should use median odds from bets table
  const avgWinProb = 0.55 // TODO: tune with real data
  const avgOdds = -150 // TODO: tune with real data
  const kelly = kellyStake(avgWinProb, avgOdds, current)

  return {
    current,
    start_of_year: startOfYear,
    high_water_mark: hwm,
    current_drawdown_pct: currentDrawdownPct,
    kelly_stake: kelly,
    history,
  }
}
