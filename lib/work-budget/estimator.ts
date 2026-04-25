/**
 * Work-Budget Estimator
 *
 * Estimates task duration using keyword heuristics, then maps to a size bucket.
 * For XL tasks, attempts Ollama ANALYSIS model refinement; falls back to
 * heuristic point estimate when circuit is OPEN or Ollama is unreachable.
 *
 * Keyword weights are read from `work_budget_keyword_weights` at runtime.
 * On DB failure, hardcoded defaults (matching migration seed) are used.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { OLLAMA_MODELS } from '@/lib/ollama/models'
import { getCircuitState } from '@/lib/ollama/circuit'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EstimateInput {
  task: string
  description: string | null
  metadata?: Record<string, unknown>
}

export interface EstimateResult {
  bucket: 'XS' | 'S' | 'M' | 'L' | 'XL'
  estimated_minutes: number
  method: 'heuristic' | 'ollama' | 'heuristic_fallback'
  keywords_hit: string[]
}

// ── Hardcoded defaults (mirrors migration seed) ───────────────────────────────
// Used when the DB read fails.

const DEFAULT_KEYWORD_WEIGHTS: Record<string, number> = {
  migration: 10,
  test: 15,
  tests: 15,
  'study doc': 20,
  'phase 1a': 20,
  'acceptance doc': 25,
  'phase 1d': 25,
  'multi-file': 15,
  'multiple files': 15,
  port: 30,
  'streamlit port': 30,
  fix: -10,
  cleanup: -10,
  update: -10,
}

const BASE_MINUTES = 20

// ── Bucket mapping ────────────────────────────────────────────────────────────

function mapToBucket(total: number): {
  bucket: EstimateResult['bucket']
  estimated_minutes: number
} {
  if (total < 30) return { bucket: 'XS', estimated_minutes: 15 }
  if (total <= 60) return { bucket: 'S', estimated_minutes: 45 }
  if (total <= 120) return { bucket: 'M', estimated_minutes: 90 }
  if (total <= 180) return { bucket: 'L', estimated_minutes: 150 }
  return { bucket: 'XL', estimated_minutes: 210 }
}

// ── Weight table reader ───────────────────────────────────────────────────────

export async function readKeywordWeights(): Promise<Record<string, number>> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('work_budget_keyword_weights')
      .select('keyword, weight_minutes')

    if (error || !data || data.length === 0) {
      return { ...DEFAULT_KEYWORD_WEIGHTS }
    }

    const weights: Record<string, number> = {}
    for (const row of data as { keyword: string; weight_minutes: number }[]) {
      weights[row.keyword] = row.weight_minutes
    }
    return weights
  } catch {
    return { ...DEFAULT_KEYWORD_WEIGHTS }
  }
}

// ── Heuristic signal extraction ───────────────────────────────────────────────

export function extractKeywordsAndScore(
  text: string,
  weights: Record<string, number>
): { total: number; keywords_hit: string[] } {
  const lower = text.toLowerCase()
  const keywords_hit: string[] = []
  let total = BASE_MINUTES

  // Sort by length descending so multi-word phrases match before single words
  const sorted = Object.keys(weights).sort((a, b) => b.length - a.length)

  for (const keyword of sorted) {
    if (lower.includes(keyword)) {
      total += weights[keyword]
      keywords_hit.push(keyword)
    }
  }

  return { total, keywords_hit }
}

// ── Main estimator ────────────────────────────────────────────────────────────

export async function estimateTask(input: EstimateInput): Promise<EstimateResult> {
  const combinedText = `${input.task} ${input.description ?? ''}`
  const weights = await readKeywordWeights()
  const { total, keywords_hit } = extractKeywordsAndScore(combinedText, weights)
  const { bucket, estimated_minutes: heuristicMinutes } = mapToBucket(total)

  // Non-XL: return heuristic immediately
  if (bucket !== 'XL') {
    return { bucket, estimated_minutes: heuristicMinutes, method: 'heuristic', keywords_hit }
  }

  // XL: attempt Ollama ANALYSIS refinement
  // Check circuit breaker first to avoid 15s timeout on open circuit
  try {
    const circuit = await getCircuitState()
    if (circuit.state === 'OPEN') {
      return {
        bucket: 'XL',
        estimated_minutes: heuristicMinutes,
        method: 'heuristic_fallback',
        keywords_hit,
      }
    }
  } catch {
    // Circuit check failure → fall through to Ollama attempt
  }

  try {
    const prompt = [
      'Given this task description, estimate how long it will take to complete',
      '(coordinator + builder phases, in minutes). Reply with a single integer only.',
      '',
      `Task: ${input.task}`,
      `Description: ${input.description ?? ''}`,
    ].join('\n')

    const result = await generate(prompt, {
      task: 'analysis',
      model: OLLAMA_MODELS.ANALYSIS,
      timeoutMs: 30_000,
    })

    const parsed = parseInt(result.text.trim(), 10)
    if (!isNaN(parsed) && parsed > 0) {
      return { bucket: 'XL', estimated_minutes: parsed, method: 'ollama', keywords_hit }
    }

    // Non-integer response → fall back
    return {
      bucket: 'XL',
      estimated_minutes: heuristicMinutes,
      method: 'heuristic_fallback',
      keywords_hit,
    }
  } catch (err) {
    if (err instanceof OllamaUnreachableError) {
      return {
        bucket: 'XL',
        estimated_minutes: heuristicMinutes,
        method: 'heuristic_fallback',
        keywords_hit,
      }
    }
    return {
      bucket: 'XL',
      estimated_minutes: heuristicMinutes,
      method: 'heuristic_fallback',
      keywords_hit,
    }
  }
}
