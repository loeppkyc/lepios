/**
 * POST /api/cron/sports-weights-tune
 *
 * Weekly cron Sunday 10pm MT (0 4 * * 1 UTC — shares slot with trading-weights-tune).
 * Reads last 50 settled sports predictions, uses Claude to adjust filtering weights,
 * inserts new prediction_weights row with is_active=true.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk B (net-new — Streamlit had no sports learning loop)
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import Anthropic from '@anthropic-ai/sdk'
import { logClaudeTokens } from '@/lib/ai/log-tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_SAMPLE_SIZE = 50

interface SportsWeights {
  max_odds: number
  tier_green_max: number
  min_implied_prob: number
  ai_rating_min: number
}

// Valid ranges for each weight
const WEIGHT_RANGES = {
  max_odds: { min: -300, max: -100 },
  tier_green_max: { min: -300, max: -100 },
  min_implied_prob: { min: 0.4, max: 0.85 },
  ai_rating_min: { min: 5.0, max: 9.5 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function validateWeights(raw: Partial<SportsWeights>, current: SportsWeights): SportsWeights {
  return {
    max_odds: clamp(
      raw.max_odds ?? current.max_odds,
      WEIGHT_RANGES.max_odds.min,
      WEIGHT_RANGES.max_odds.max
    ),
    tier_green_max: clamp(
      raw.tier_green_max ?? current.tier_green_max,
      WEIGHT_RANGES.tier_green_max.min,
      WEIGHT_RANGES.tier_green_max.max
    ),
    min_implied_prob: clamp(
      raw.min_implied_prob ?? current.min_implied_prob,
      WEIGHT_RANGES.min_implied_prob.min,
      WEIGHT_RANGES.min_implied_prob.max
    ),
    ai_rating_min: clamp(
      raw.ai_rating_min ?? current.ai_rating_min,
      WEIGHT_RANGES.ai_rating_min.min,
      WEIGHT_RANGES.ai_rating_min.max
    ),
  }
}

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  // ── Load current active weights ─────────────────────────────────────────────
  const { data: weightsRow } = await supabase
    .from('prediction_weights')
    .select('id, weights')
    .eq('domain', 'sports')
    .eq('is_active', true)
    .single()

  const currentWeights: SportsWeights = (weightsRow?.weights as SportsWeights) ?? {
    max_odds: -150,
    tier_green_max: -150,
    min_implied_prob: 0.6,
    ai_rating_min: 7.0,
  }

  // ── Check sample size ───────────────────────────────────────────────────────
  const { count } = await supabase
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .eq('domain', 'sports')
    .not('resolved_at', 'is', null)

  const sampleSize = count ?? 0

  if (sampleSize < MIN_SAMPLE_SIZE) {
    return NextResponse.json({
      skipped: true,
      reason: `Need ${MIN_SAMPLE_SIZE} settled predictions, have ${sampleSize}`,
      sample_size: sampleSize,
    })
  }

  // ── Load last 50 settled predictions ───────────────────────────────────────
  const { data: settled, error: predsErr } = await supabase
    .from('predictions')
    .select('league, odds, implied_prob, ai_rating, won, actual_pnl')
    .eq('domain', 'sports')
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(50)

  if (predsErr || !settled) {
    return NextResponse.json({ error: 'Failed to load predictions' }, { status: 500 })
  }

  // ── Compute stats for Claude ────────────────────────────────────────────────
  const wins = settled.filter((p) => p.won === true).length
  const losses = settled.filter((p) => p.won === false).length
  const totalPnl = settled.reduce((s, p) => s + (p.actual_pnl ?? 0), 0)
  const totalStake = settled.length * 100
  const roi = totalStake > 0 ? (totalPnl / totalStake) * 100 : 0

  // Odds bucket breakdown: -100 to -130, -130 to -150, -150 to -200, -200+
  const buckets = [
    { label: '-100 to -130', filter: (o: number) => o >= -130 && o <= -100 },
    { label: '-130 to -150', filter: (o: number) => o >= -150 && o < -130 },
    { label: '-150 to -200', filter: (o: number) => o >= -200 && o < -150 },
    { label: '-200+', filter: (o: number) => o < -200 },
  ]

  const bucketStats = buckets.map((b) => {
    const bPicks = settled.filter((p) => p.odds != null && b.filter(p.odds as number))
    const bWins = bPicks.filter((p) => p.won === true).length
    return {
      label: b.label,
      total: bPicks.length,
      wins: bWins,
      win_rate: bPicks.length > 0 ? ((bWins / bPicks.length) * 100).toFixed(1) : 'N/A',
    }
  })

  // League breakdown
  const leagueMap: Record<string, { total: number; wins: number }> = {}
  for (const p of settled) {
    const l = p.league ?? 'Unknown'
    if (!leagueMap[l]) leagueMap[l] = { total: 0, wins: 0 }
    leagueMap[l].total++
    if (p.won) leagueMap[l].wins++
  }

  const leagueTable = Object.entries(leagueMap)
    .map(
      ([league, s]) =>
        `  ${league}: ${s.wins}/${s.total} (${((s.wins / s.total) * 100).toFixed(0)}%)`
    )
    .join('\n')

  // ── Call Claude for weight adjustment ───────────────────────────────────────
  const client = new Anthropic()

  const systemPrompt = `You are a sports betting system optimizer. Review ${settled.length} settled picks and adjust filtering parameters.

Rules:
- max_odds / tier_green_max: must stay between -100 and -300 (American odds, negative = favorite)
- if a bucket consistently loses: tighten max_odds toward -150 or beyond
- if -130 bucket wins at ≥62%: consider loosening max_odds to -130
- min_implied_prob: keep between 0.40 and 0.85
- ai_rating_min: keep between 5.0 and 9.5; increase if low-rated picks underperform
- make only necessary changes; return current value if no adjustment warranted

Return ONLY valid JSON with no extra text:
{
  "max_odds": number,
  "tier_green_max": number,
  "min_implied_prob": number,
  "ai_rating_min": number,
  "_reasoning": "one sentence"
}`

  const userMessage = `Sports picks performance (last ${settled.length} settled):
- Wins: ${wins}, Losses: ${losses} (${((wins / settled.length) * 100).toFixed(1)}% win rate)
- Total PnL: $${totalPnl.toFixed(2)}, ROI: ${roi.toFixed(1)}%

Odds bucket breakdown:
${bucketStats.map((b) => `  ${b.label}: ${b.wins}/${b.total} wins (${b.win_rate}% WR)`).join('\n')}

League breakdown:
${leagueTable}

Current weights:
${JSON.stringify(currentWeights, null, 2)}`

  let updatedWeights = currentWeights
  let reasoning = 'No adjustment — maintaining current weights'

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    logClaudeTokens(resp, 'sports')

    const content = resp.content[0]
    if (content.type === 'text') {
      const text = content.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<SportsWeights & { _reasoning: string }>
        reasoning = parsed._reasoning ?? 'Weight adjustment by Claude'
        updatedWeights = validateWeights(parsed, currentWeights)
      }
    }
  } catch (err) {
    console.error('[sports-weights-tune] Claude failed:', err)
    reasoning = `Claude call failed (${String(err).slice(0, 80)}) — keeping current weights`
  }

  // ── Insert new weights row, flip old to is_active=false ────────────────────
  // Use a transaction via separate calls (Supabase JS client doesn't support transactions)
  const { error: insertErr } = await supabase.from('prediction_weights').insert({
    domain: 'sports',
    weights: updatedWeights,
    generated_by: 'analyze_and_learn',
    reasoning,
    sample_window: settled.length,
    win_rate_at_generation:
      settled.length > 0 ? parseFloat((wins / settled.length).toFixed(4)) : null,
    is_active: true,
  })

  if (insertErr) {
    return NextResponse.json(
      { error: 'Failed to insert new weights', detail: insertErr.message },
      { status: 500 }
    )
  }

  // Deactivate old row
  if (weightsRow?.id) {
    await supabase.from('prediction_weights').update({ is_active: false }).eq('id', weightsRow.id)
  }

  // ── Telegram summary ────────────────────────────────────────────────────────
  const { data: cfg } = await supabase
    .from('harness_config')
    .select('value')
    .eq('key', 'TELEGRAM_CHAT_ID')
    .single()

  const chatId = cfg?.value ? Number(cfg.value) : undefined

  await supabase.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: {
      text: [
        `Sports Weights Tuned (Sunday)`,
        `${wins}/${settled.length} wins | ROI ${roi.toFixed(1)}%`,
        `max_odds: ${currentWeights.max_odds} -> ${updatedWeights.max_odds}`,
        `ai_rating_min: ${currentWeights.ai_rating_min} -> ${updatedWeights.ai_rating_min}`,
        reasoning,
      ].join('\n'),
    },
    correlation_id: `sports-weights-tune-${new Date().toISOString().slice(0, 10)}`,
    requires_response: false,
    ...(chatId ? { chat_id: chatId } : {}),
  })

  const secret = getCronSecret()
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
  try {
    await fetch(`${base}/api/harness/notifications-drain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    })
  } catch {
    // non-blocking
  }

  return NextResponse.json({
    ok: true,
    sample_size: settled.length,
    win_rate: ((wins / settled.length) * 100).toFixed(1),
    roi: roi.toFixed(1),
    old_weights: currentWeights,
    new_weights: updatedWeights,
    reasoning,
  })
}
