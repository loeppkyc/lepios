/**
 * Kelly criterion math — ported from Streamlit OS.
 *
 * Source: streamlit_app/pages/3_Sports_Betting.py
 *   _kelly_fraction — line 361 (module-level, returns 0-1)
 *   _kelly_pct      — line 1136 (local in Full History tab, returns 0-100)
 *
 * All numerical outputs verified against the Python source before porting.
 * See audits/sprint2-port-plan.md and docs/hallucination-log.md.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** American odds integer, e.g. -150 or +120. */
export type AmericanOdds = number

/** Kelly fraction in [0, 1] representing the optimal bankroll fraction to stake. */
export type KellyFraction = number

/** Kelly percentage in [0, 100]. Equals KellyFraction × 100. */
export type KellyPct = number

// ── Odds conversion ───────────────────────────────────────────────────────────

/**
 * Convert American odds to decimal odds.
 *
 * Mirrors: `dec_odds = 1 + (100 / abs(odds))` if negative, else `1 + (odds / 100)`
 * (same formula used in both _kelly_fraction and _kelly_pct in the Python source).
 *
 * @param odds - American odds integer (-150, +120, etc.)
 * @returns Decimal odds (e.g. 1.6667 for -150, 2.20 for +120)
 */
export function americanToDecimal(odds: AmericanOdds): number {
  return odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100
}

/**
 * Convert American odds to implied win probability (no vig removed).
 *
 * @param odds - American odds integer
 * @returns Implied probability in [0, 1]
 */
export function americanToImpliedProb(odds: AmericanOdds): number {
  return 1 / americanToDecimal(odds)
}

// ── Kelly criterion ───────────────────────────────────────────────────────────

/**
 * Kelly criterion: optimal fraction of bankroll to stake (0–1).
 *
 * Formula: f* = (b·p − q) / b   where b = net odds, p = win prob, q = 1 − p
 * Returns 0 when there is no edge (negative Kelly is clamped, not leaked).
 *
 * Mirrors: _kelly_fraction(win_prob, american_odds) at line 361.
 *
 * @param winProb     - Estimated win probability (0–1)
 * @param americanOdds - American odds integer
 * @returns Kelly fraction in [0, 1]
 */
export function kellyFraction(winProb: number, americanOdds: AmericanOdds): KellyFraction {
  const b = americanToDecimal(americanOdds) - 1 // net odds
  if (b <= 0) return 0
  const q = 1 - winProb
  return Math.max(0, (b * winProb - q) / b)
}

/**
 * Kelly criterion as a percentage (0–100).
 *
 * Mirrors: _kelly_pct(win_rate_dec, american_odds) at line 1136.
 * Identical math to kellyFraction — result multiplied by 100.
 *
 * @param winProb      - Estimated win probability (0–1)
 * @param americanOdds - American odds integer
 * @returns Kelly percentage in [0, 100]
 */
export function kellyPct(winProb: number, americanOdds: AmericanOdds): KellyPct {
  return kellyFraction(winProb, americanOdds) * 100
}

/**
 * Recommended stake in dollars using fractional Kelly.
 *
 * Sharp bettors typically use quarter Kelly (fraction=0.25) to reduce variance.
 * The default here matches the `kelly_qtr` usage in _score_game (line 385).
 *
 * @param winProb      - Estimated win probability (0–1)
 * @param americanOdds - American odds integer
 * @param bankroll     - Current bankroll in dollars
 * @param fraction     - Kelly fraction multiplier (default 0.25 = quarter Kelly)
 * @returns Recommended stake in dollars (0 when no edge)
 */
export function kellyStake(
  winProb: number,
  americanOdds: AmericanOdds,
  bankroll: number,
  fraction: number = 0.25,
): number {
  return kellyFraction(winProb, americanOdds) * fraction * bankroll
}
