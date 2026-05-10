// Sports AI Coach — ports utils/sports_coach.py
// Uses claude-haiku-4-5-20251001 for daily picks (20% Better: cost savings vs sonnet)
// Keeps claude-sonnet-4-6 for post-game debrief (quality matters)

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface DebriefResult {
  summary: string
  key_factors: string[]
  lesson: string
  confidence_review: string
  rating: number
}

export interface BetContext {
  league: string
  home: string
  away: string
  favorite?: string
  bet_on?: string
  fav_odds?: number
  odds?: number
  implied_prob?: number
  stake?: number
  pnl?: number
}

export async function generateDebrief(
  bet: BetContext,
  result: 'Win' | 'Loss' | 'Push',
  teamHistory = ''
): Promise<DebriefResult> {
  const league = bet.league ?? 'Unknown'
  const home = bet.home ?? 'Home Team'
  const away = bet.away ?? 'Away Team'
  const favorite = bet.favorite ?? bet.bet_on ?? 'Favorite'
  const favOdds = bet.fav_odds ?? bet.odds ?? 0
  const impliedProb = bet.implied_prob ?? 0
  const stake = bet.stake ?? 0
  const pnl = bet.pnl ?? 0
  const betOn = bet.bet_on ?? favorite

  const outcomeLine = `Result: **${result}** (P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`
  const historyLine = teamHistory ? `\nBETTOR HISTORY ON THIS TEAM: ${teamHistory}` : ''
  const wonLost = result === 'Win' ? 'won' : result === 'Loss' ? 'lost' : 'pushed'

  const prompt = `You are a sharp sports betting analyst and coach. Analyse this completed bet concisely.

GAME: ${home} vs ${away} (${league})
BET ON: ${betOn} at ${favOdds} (${impliedProb.toFixed(1)}% implied probability)
STAKE: $${stake.toFixed(2)}
${outcomeLine}${historyLine}

Your job:
1. Briefly explain the most likely reason the favored team ${wonLost} — 2-3 sentences max.
2. List 2-3 key factors that typically drive outcomes in this type of matchup.
3. One sharp lesson for the bettor going forward with this type of line.
4. Rate the original pick quality (1-10) purely on bet value — NOT on whether it won.

Respond in JSON with exactly these keys:
{"summary":"...","key_factors":["...","...","..."],"lesson":"...","confidence_review":"...","rating":7}

Be direct. No fluff.`

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (resp.content[0] as { type: string; text: string }).text
      .trim()
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
    return JSON.parse(text) as DebriefResult
  } catch (e) {
    return {
      summary: `Debrief unavailable: ${e}`,
      key_factors: [],
      lesson: '',
      confidence_review: '',
      rating: 0,
    }
  }
}

export async function generateDailyPicksAnalysis(
  picks: {
    home: string
    away: string
    league: string
    favorite: string
    fav_odds: number
    implied_prob: number
    commence_str: string
  }[],
  context = ''
): Promise<string> {
  if (!picks.length) return 'No -150 or better games found today.'

  const lines = picks.map(
    (p) =>
      `- ${p.home} vs ${p.away} (${p.league}): ${p.favorite} favored at ${p.fav_odds} (${p.implied_prob}% implied) — ${p.commence_str}`
  )
  const contextBlock = context ? `\n${context}\n` : ''

  const prompt = `You are a sharp sports betting analyst focused on value and line quality.
${contextBlock}
Today's -150 or better moneyline favorites (Alberta/Canada perspective):

${lines.join('\n')}

Give a BRIEF analyst report (5-8 sentences total):
1. Which 1-2 games look strongest value — and why
2. Any games to avoid despite the short line
3. If historical data provided above, flag leagues with losing track record
4. Overall confidence level (High / Medium / Low)

Format as clean markdown. Be direct. No fluff.`

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    return (resp.content[0] as { type: string; text: string }).text.trim()
  } catch (e) {
    return `Analysis unavailable: ${e}`
  }
}

export interface StrategyStats {
  total_bets: number
  wins: number
  losses: number
  pushes: number
  roi_pct: number
  win_rate_pct: number
  best_league: string
  worst_league: string
  bankroll_start: number
  bankroll_current: number
  avg_odds?: string
}

export async function generateStrategyReview(stats: StrategyStats): Promise<string> {
  if (stats.total_bets < 5) return 'Need at least 5 bets to generate a meaningful strategy review.'

  const prompt = `You are a professional sports betting strategist reviewing a bettor's -150 moneyline strategy.

STATS:
- Total bets: ${stats.total_bets}
- Record: ${stats.wins}W / ${stats.losses}L / ${stats.pushes}P
- Win rate: ${stats.win_rate_pct.toFixed(1)}%
- ROI: ${stats.roi_pct.toFixed(1)}%
- Bankroll: $${stats.bankroll_start.toFixed(0)} → $${stats.bankroll_current.toFixed(0)}
- Best league: ${stats.best_league ?? 'N/A'}
- Worst league: ${stats.worst_league ?? 'N/A'}
- Avg odds bet: ${stats.avg_odds ?? 'N/A'}

Give a CONCISE strategy review (6-10 sentences):
1. Is the current ROI sustainable or is variance at play?
2. Should the bettor tighten or loosen the -150 threshold?
3. Any league/sport to focus on or avoid?
4. One concrete adjustment to improve edge.

Format as clean markdown. Sharp and direct.`

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 450,
      messages: [{ role: 'user', content: prompt }],
    })
    return (resp.content[0] as { type: string; text: string }).text.trim()
  } catch (e) {
    return `Review unavailable: ${e}`
  }
}
