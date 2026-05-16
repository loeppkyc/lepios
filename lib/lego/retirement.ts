/**
 * lib/lego/retirement.ts
 *
 * Port of utils/lego_retirement.py business logic.
 * Translates ~20% business logic (scoring, projections, ROI).
 * UI/data layer rebuilt from scratch; no Streamlit/Sheets coupling.
 *
 * Theme multipliers are loaded from the lego_theme_config Supabase table
 * (20% improvement: editable via UI instead of hardcoded).
 * These constants are provided as defaults when the DB is unavailable.
 */

// TODO: tune with real data — default fallback used when DB unavailable
export const DEFAULT_THEME_MULTIPLIERS: Record<string, number> = {
  'Star Wars': 1.45,
  Icons: 1.35,
  'Creator Expert': 1.35,
  Technic: 1.25,
  City: 1.1,
  'Harry Potter': 1.4,
  Ideas: 1.38,
  Art: 1.2,
  Architecture: 1.3,
  Marvel: 1.3,
  DC: 1.25,
  Ninjago: 1.15,
  Friends: 1.08,
  Botanical: 1.42,
  'Speed Champions': 1.18,
  Minecraft: 1.12,
  Disney: 1.32,
  'Lord of the Rings': 1.5,
}

// TODO: tune with real data — BrickLink-derived historical time factors
// Source: lego_retirement.py TIME_FACTORS dict
const TIME_FACTORS: Record<number, number> = {
  1: 1.15,
  2: 1.27,
  3: 1.4,
  4: 1.52,
  5: 1.65,
}

const DEFAULT_MULTIPLIER = 1.1

/**
 * Project post-retirement value.
 * Port of lego_retirement.py:project_post_retirement_value().
 *
 * @param basePrice  Retail price (CAD)
 * @param theme      Set theme string (must match a key in themeMultipliers or DEFAULT_THEME_MULTIPLIERS)
 * @param years      Years after retirement (1–5)
 * @param themeMultipliers  Optional override map (from DB lego_theme_config)
 */
export function projectPostRetirementValue(
  basePrice: number,
  theme: string,
  years: number,
  themeMultipliers: Record<string, number> = DEFAULT_THEME_MULTIPLIERS
): number {
  const multiplier = themeMultipliers[theme] ?? DEFAULT_MULTIPLIER
  const timeFactor = TIME_FACTORS[Math.min(Math.max(years, 1), 5)] ?? 1.65
  return Math.round(basePrice * multiplier * timeFactor * 100) / 100
}

export interface ProfitScoreBreakdown {
  discountScore: number // 0–25: how discounted vs retail
  themeScore: number // 0–20: theme investment multiplier
  pppScore: number // 0–15: price-per-piece ratio
  priceTierScore: number // 0–15: absolute price tier (higher = more investable)
  salesRankScore: number // 0–10: BSR (lower rank = more popular)
  urgencyScore: number // 0–15: months until retirement (fewer = more urgent)
  total: number // 0–100
}

export interface ProfitScoreInput {
  retailPriceCad: number
  amazonPriceCad: number | null
  theme: string
  pieces: number | null
  salesRank: number | null
  retireDateEst: string | null // ISO date string
  themeMultipliers?: Record<string, number>
}

/**
 * Calculate investment profit score (0–100).
 * Port of lego_retirement.py:calculate_profit_score().
 *
 * 6 factors:
 *  - Discount % vs retail (0–25 pts)
 *  - Theme investment multiplier (0–20 pts)
 *  - Price-per-piece ratio (0–15 pts)
 *  - Price tier (0–15 pts)
 *  - Sales rank (0–10 pts)
 *  - Urgency / months to retirement (0–15 pts)
 */
export function calculateProfitScore(input: ProfitScoreInput): ProfitScoreBreakdown {
  const {
    retailPriceCad,
    amazonPriceCad,
    theme,
    pieces,
    salesRank,
    retireDateEst,
    themeMultipliers = DEFAULT_THEME_MULTIPLIERS,
  } = input

  // 1. Discount score (0–25)
  let discountScore = 0
  if (amazonPriceCad != null && retailPriceCad > 0) {
    const discountPct = ((retailPriceCad - amazonPriceCad) / retailPriceCad) * 100
    if (discountPct >= 30) discountScore = 25
    else if (discountPct >= 20) discountScore = 18
    else if (discountPct >= 10) discountScore = 10
    else if (discountPct >= 5) discountScore = 5
    else discountScore = 0
  }

  // 2. Theme score (0–20)
  const multiplier = themeMultipliers[theme] ?? DEFAULT_MULTIPLIER
  let themeScore = 0
  if (multiplier >= 1.45) themeScore = 20
  else if (multiplier >= 1.35) themeScore = 16
  else if (multiplier >= 1.25) themeScore = 12
  else if (multiplier >= 1.15) themeScore = 8
  else if (multiplier >= 1.1) themeScore = 4
  else themeScore = 0

  // 3. Price-per-piece score (0–15)
  // Lower ppp is better value. Threshold: <$0.10/piece = great, <$0.15 = good, etc.
  let pppScore = 0
  if (pieces != null && pieces > 0 && retailPriceCad > 0) {
    const ppp = retailPriceCad / pieces
    if (ppp < 0.08) pppScore = 15
    else if (ppp < 0.1) pppScore = 12
    else if (ppp < 0.13) pppScore = 9
    else if (ppp < 0.17) pppScore = 6
    else if (ppp < 0.25) pppScore = 3
    else pppScore = 0
  }

  // 4. Price tier score (0–15)
  // Higher retail price = more desirable to investors (harder to find, bigger slabs)
  let priceTierScore = 0
  if (retailPriceCad >= 500) priceTierScore = 15
  else if (retailPriceCad >= 300) priceTierScore = 12
  else if (retailPriceCad >= 150) priceTierScore = 9
  else if (retailPriceCad >= 80) priceTierScore = 6
  else if (retailPriceCad >= 40) priceTierScore = 3
  else priceTierScore = 0

  // 5. Sales rank score (0–10)
  // Lower rank = more popular = more buyers when we eventually sell
  let salesRankScore = 0
  if (salesRank != null) {
    if (salesRank <= 1000) salesRankScore = 10
    else if (salesRank <= 5000) salesRankScore = 8
    else if (salesRank <= 20000) salesRankScore = 6
    else if (salesRank <= 50000) salesRankScore = 4
    else if (salesRank <= 100000) salesRankScore = 2
    else salesRankScore = 0
  }

  // 6. Urgency score (0–15)
  // Fewer months to retirement = more urgent to buy
  let urgencyScore = 0
  if (retireDateEst) {
    const now = new Date()
    const retireDate = new Date(retireDateEst)
    const monthsLeft = Math.max(
      0,
      (retireDate.getFullYear() - now.getFullYear()) * 12 + (retireDate.getMonth() - now.getMonth())
    )
    if (monthsLeft <= 3) urgencyScore = 15
    else if (monthsLeft <= 6) urgencyScore = 12
    else if (monthsLeft <= 12) urgencyScore = 9
    else if (monthsLeft <= 18) urgencyScore = 6
    else if (monthsLeft <= 24) urgencyScore = 3
    else urgencyScore = 0
  }

  const total =
    discountScore + themeScore + pppScore + priceTierScore + salesRankScore + urgencyScore

  return {
    discountScore,
    themeScore,
    pppScore,
    priceTierScore,
    salesRankScore,
    urgencyScore,
    total: Math.min(100, total),
  }
}

export type RadarLabel = 'STRONG BUY' | 'BUY' | 'WATCH' | 'PASS'

/**
 * Convert total score to label.
 * Thresholds from acceptance doc: STRONG BUY ≥70, BUY ≥55, WATCH ≥35, PASS <35
 */
export function scoreToLabel(total: number): RadarLabel {
  if (total >= 70) return 'STRONG BUY'
  if (total >= 55) return 'BUY'
  if (total >= 35) return 'WATCH'
  return 'PASS'
}

/**
 * Gross ROI: (current - paid) / paid * 100
 * Does NOT deduct FBA fees. Label shown as "Estimated" — see Principle 6.
 */
export function grossRoi(paid: number, current: number): number {
  if (paid <= 0) return 0
  return ((current - paid) / paid) * 100
}
