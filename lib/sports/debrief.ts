// Auto-debrief for settled sports picks — uses Claude Haiku for cost efficiency
// Called after nightly settlement to analyze each resolved pick

import Anthropic from '@anthropic-ai/sdk'
import type { SportsPick } from '@/lib/sports/picks'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DebriefResult {
  summary: string
  factors: string[]
  lesson: string
  quality_rating: number
}

// ── generateDebrief ───────────────────────────────────────────────────────────

/**
 * generateDebrief — runs a Claude Haiku analysis on a settled sports pick.
 * Returns structured JSON: summary, factors, lesson, quality_rating.
 * Uses claude-haiku-4-5-20251001 (cost savings vs sonnet; 20% Better criterion).
 */
export async function generateDebrief(pick: SportsPick): Promise<DebriefResult> {
  const favWon = pick.fav_won ?? false
  const underdog = pick.home === pick.favorite ? pick.away : pick.home

  // How many hours before game was the pick logged?
  const pickedAt = new Date(pick.created_at)
  const now = new Date()
  const hoursAgo = Math.round((now.getTime() - pickedAt.getTime()) / (1000 * 60 * 60))

  const prompt = `The ${pick.favorite} (${pick.fav_odds}) ${favWon ? 'won' : 'lost'} vs ${underdog}. Pick was logged ${hoursAgo} hours before the game. Analyze briefly: why did this happen, what factors mattered, rate the pick quality 1-10 independent of result. Return JSON only.

Expected output format:
{"summary":"one sentence why favorite won/lost","factors":["factor1","factor2","factor3"],"lesson":"one takeaway","quality_rating":7}`

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = (resp.content[0] as { type: string; text: string }).text
      .trim()
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
    const parsed = JSON.parse(raw) as DebriefResult
    return {
      summary: parsed.summary ?? '',
      factors: Array.isArray(parsed.factors) ? parsed.factors.slice(0, 3) : [],
      lesson: parsed.lesson ?? '',
      quality_rating: typeof parsed.quality_rating === 'number' ? parsed.quality_rating : 5,
    }
  } catch (e) {
    return {
      summary: `Debrief unavailable: ${String(e).slice(0, 80)}`,
      factors: [],
      lesson: '',
      quality_rating: 0,
    }
  }
}
