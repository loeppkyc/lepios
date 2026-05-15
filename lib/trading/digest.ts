/**
 * Trading + sports digest lines for the morning digest.
 *
 * Called from lib/orchestrator/digest.ts — appends composite score,
 * today's A-grade trading picks, and green-tier sports picks.
 *
 * Never throws — on any error returns a safe fallback string.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { computeCompositeConfidence } from './composite'

/**
 * Build the composite confidence line for the morning digest.
 *
 * Format:
 *   📊 Confidence: 72/100 (Moderate)
 *   Trend: 80 · Sports: 65 · Grade: 70 · Vol: 60 · Momentum: 75 · VIX: 68 · Deals: 55 · Health: 85
 */
export async function buildTradingCompositeDigestLine(): Promise<string> {
  try {
    const composite = await computeCompositeConfidence()

    const labelMap: Record<string, string> = {
      'Market Trend': 'Trend',
      'Sports Edge': 'Sports',
      'Trading Grade': 'Grade',
      Volume: 'Vol',
      Momentum: 'Momentum',
      Volatility: 'VIX',
      'Deal Flow': 'Deals',
      'System Health': 'Health',
    }

    const interpretLabel =
      {
        high: 'High',
        moderate: 'Moderate',
        cautious: 'Cautious',
        standAside: 'Stand Aside',
      }[composite.interpretation] ?? 'Unknown'

    const line1 = `📊 Confidence: ${composite.score}/100 (${interpretLabel})`

    const signalParts = composite.signals.map((s) => {
      const short = labelMap[s.name] ?? s.name
      return `${short}: ${Math.round(s.value)}`
    })
    const line2 = signalParts.join(' · ')

    return `${line1}\n${line2}`
  } catch {
    return '📊 Confidence: unavailable'
  }
}

/**
 * Build today's A-grade trading picks line for the morning digest.
 *
 * Format:
 *   🎯 Trading Picks (A-grade):
 *   • NVDA LONG  Entry: 910  Stop: 892  Target: 946  R:R 2.0
 *
 * Returns empty string if no A-grade predictions today.
 */
export async function buildTradingPicksDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)

    const { data } = await db
      .from('predictions')
      .select('ticker, direction, entry_price, stop_price, target_price, risk_reward')
      .eq('domain', 'trading')
      .eq('pick_date', today)
      .eq('grade', 'A')
      .eq('person_handle', 'colin') // SPRINT5-GATE
      .order('confidence', { ascending: false })
      .limit(3)

    if (!data || data.length === 0) return ''

    const lines = ['\n🎯 Trading Picks (A-grade):']
    for (const p of data) {
      const dir = p.direction?.toUpperCase() ?? ''
      const entry = p.entry_price != null ? `  Entry: ${p.entry_price}` : ''
      const stop = p.stop_price != null ? `  Stop: ${p.stop_price}` : ''
      const target = p.target_price != null ? `  Target: ${p.target_price}` : ''
      const rr = p.risk_reward != null ? `  R:R ${Number(p.risk_reward).toFixed(1)}` : ''
      lines.push(`• ${p.ticker ?? '?'} ${dir}${entry}${stop}${target}${rr}`)
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

/**
 * Build today's green-tier sports picks line for the morning digest.
 *
 * Format:
 *   🏒 Sports Picks (green tier, 2 games):
 *   • EDM -165 vs CAL
 *
 * Returns empty string if no green picks today.
 */
export async function buildSportsPicksDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)

    const { data } = await db
      .from('sports_picks')
      .select('home, away, favorite, fav_odds, league')
      .eq('picked_on', today)
      .eq('tier', 'green')

    if (!data || data.length === 0) return ''

    const gameWord = data.length !== 1 ? 'games' : 'game'
    const lines = [`\n🏒 Sports Picks (green tier, ${data.length} ${gameWord}):`]
    for (const p of data) {
      const odds = p.fav_odds > 0 ? `+${p.fav_odds}` : `${p.fav_odds}`
      const opponent = p.home === p.favorite ? p.away : p.home
      lines.push(`• ${p.favorite} ${odds} vs ${opponent}`)
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}
