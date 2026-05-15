/**
 * Claude weight auto-tuning for the AI Pick Engine.
 *
 * Reads last N completed trading predictions, sends to Claude Haiku with
 * instructions to suggest small weight adjustments, returns updated weights.
 *
 * Model: claude-haiku-4-5-20251001 (fast, cheap, structured JSON)
 * Max tokens: 200 — strictly JSON output
 *
 * Fails safe: if Claude returns unparseable JSON, returns the current weights
 * unchanged rather than crashing or writing bad weights to DB.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { PredictionWeights } from './types'
import { DEFAULT_WEIGHTS } from './types'

const client = new Anthropic()

export interface CompletedTradePrediction {
  ticker: string
  direction: 'long' | 'short'
  grade: string
  weighted_score: number
  won: boolean | null
  actual_pnl: number | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  exit_price: number | null
}

/**
 * Analyze completed trade predictions and suggest adjusted weights.
 *
 * @param completedTrades - Last N completed predictions (won IS NOT NULL)
 * @param currentWeights  - Active weights to adjust from
 * @returns Updated PredictionWeights; returns currentWeights if adjustment fails
 */
export async function analyzeAndLearn(
  completedTrades: CompletedTradePrediction[],
  currentWeights: PredictionWeights
): Promise<{ weights: PredictionWeights; reasoning: string }> {
  const winCount = completedTrades.filter((t) => t.won === true).length
  const lossCount = completedTrades.filter((t) => t.won === false).length
  const totalPnl = completedTrades.reduce((s, t) => s + (t.actual_pnl ?? 0), 0)
  const stopsHitCount = completedTrades.filter(
    (t) => t.won === false && t.stop_price != null
  ).length
  const targetsHitCount = completedTrades.filter(
    (t) => t.won === true && t.target_price != null
  ).length

  const systemPrompt = `You are reviewing ${completedTrades.length} completed trading predictions and their outcomes.
Your job is to suggest small weight adjustments (±0.05–0.2) to improve future predictions.

Rules:
- if stops hit too often (stop_rate > 0.6): increase atr_stop_mult by 0.1–0.2
- if targets rarely reached (target_hit_rate < 0.3): decrease atr_target_mult by 0.1–0.2
- if low-score trades (grade B or C) are losing: increase min_score_threshold by 0.25–0.5
- if high-score trades (grade A) are losing: decrease trend_weight or rsi_weight by 0.05–0.1
- if volume signal not correlating with wins: decrease volume_weight by 0.05–0.1
- weights must stay in range: component weights 0.5–2.0, multipliers 0.5–5.0, threshold 3.0–10.0
- make only necessary changes; return current weight if no adjustment warranted

Return ONLY valid JSON matching this schema. No explanation text outside JSON.
{
  "trend_weight": number,
  "rsi_weight": number,
  "volume_weight": number,
  "momentum_weight": number,
  "level_weight": number,
  "atr_stop_mult": number,
  "atr_target_mult": number,
  "min_score_threshold": number,
  "_reasoning": "one sentence"
}`

  const userMessage = `Performance summary:
- Total trades: ${completedTrades.length}
- Wins: ${winCount}, Losses: ${lossCount} (win rate: ${((winCount / completedTrades.length) * 100).toFixed(1)}%)
- Total PnL: $${totalPnl.toFixed(2)}
- Stops hit: ${stopsHitCount} (${((stopsHitCount / completedTrades.length) * 100).toFixed(1)}%)
- Targets reached: ${targetsHitCount} (${((targetsHitCount / completedTrades.length) * 100).toFixed(1)}%)

Grade breakdown:
${Object.entries(
  completedTrades.reduce(
    (acc, t) => {
      acc[t.grade] = (acc[t.grade] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )
)
  .map(([g, n]) => `  ${g}: ${n}`)
  .join('\n')}

Current weights:
${JSON.stringify(currentWeights, null, 2)}`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      return {
        weights: currentWeights,
        reasoning: 'Claude returned non-text — using current weights',
      }
    }

    const text = content.text.trim()
    // Extract JSON from the response (strip any preamble/postamble)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        weights: currentWeights,
        reasoning: 'No JSON in Claude response — using current weights',
      }
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<PredictionWeights & { _reasoning: string }>
    const reasoning = parsed._reasoning ?? 'Weight adjustment by Claude'

    // Validate and clamp all fields
    const updated: PredictionWeights = {
      trend_weight: clamp(parsed.trend_weight ?? currentWeights.trend_weight, 0.5, 2.0),
      rsi_weight: clamp(parsed.rsi_weight ?? currentWeights.rsi_weight, 0.5, 2.0),
      volume_weight: clamp(parsed.volume_weight ?? currentWeights.volume_weight, 0.5, 2.0),
      momentum_weight: clamp(parsed.momentum_weight ?? currentWeights.momentum_weight, 0.5, 2.0),
      level_weight: clamp(parsed.level_weight ?? currentWeights.level_weight, 0.5, 2.0),
      atr_stop_mult: clamp(parsed.atr_stop_mult ?? currentWeights.atr_stop_mult, 0.5, 5.0),
      atr_target_mult: clamp(parsed.atr_target_mult ?? currentWeights.atr_target_mult, 0.5, 5.0),
      min_score_threshold: clamp(
        parsed.min_score_threshold ?? currentWeights.min_score_threshold,
        3.0,
        10.0
      ),
    }

    return { weights: updated, reasoning }
  } catch (err) {
    console.error('[learn] Claude call failed:', err)
    return { weights: currentWeights, reasoning: 'Claude call failed — using current weights' }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export { DEFAULT_WEIGHTS }
