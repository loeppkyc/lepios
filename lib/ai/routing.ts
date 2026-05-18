/**
 * lib/ai/routing.ts — Hybrid Stack Routing Rule.
 *
 * Formalizes which AI tasks go to Ollama vs Claude.
 * Backed by harness_config overrides so routing can change without a deploy.
 *
 * Default contract (change requires acceptance doc update):
 *   Ollama: scoring, filtering, embedding, pre_research, llm_safety_review,
 *           twin_qa, lightweight_synthesis
 *   Claude: ocr, hard_synthesis, validation, structured_extraction
 *
 * F17: routing override events feed behavioral data — which tasks Colin
 *      promotes to Claude reveals resource allocation under constraint.
 * F18: Ollama routing rate = % of non-OCR AI calls on Ollama. Target ≥ 70%.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AITaskType =
  | 'scoring'
  | 'filtering'
  | 'embedding'
  | 'pre_research'
  | 'llm_safety_review'
  | 'twin_qa'
  | 'lightweight_synthesis'
  | 'ocr'
  | 'hard_synthesis'
  | 'validation'
  | 'structured_extraction'

export type AIProvider = 'ollama' | 'claude'

// ── Default routing table ─────────────────────────────────────────────────────
// The contract. Change requires acceptance doc update.

const DEFAULT_ROUTING: Record<AITaskType, AIProvider> = {
  scoring:               'ollama',
  filtering:             'ollama',
  embedding:             'ollama',
  pre_research:          'ollama',
  llm_safety_review:     'ollama',
  twin_qa:               'ollama',
  lightweight_synthesis: 'ollama',
  ocr:                   'claude',
  hard_synthesis:        'claude',
  validation:            'claude',
  structured_extraction: 'claude',
}

// ── Hydration cache ───────────────────────────────────────────────────────────
// Same TTL pattern as hydrateOllamaConfig() in lib/ollama/client.ts.

const HYDRATE_TTL_MS = 5 * 60 * 1000 // 5 min
let _overrides: Partial<Record<AITaskType, AIProvider>> = {}
let _hydratedAt: number | null = null

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidProvider(v: string): v is AIProvider {
  return v === 'ollama' || v === 'claude'
}

function taskKeyToType(key: string): AITaskType | null {
  // key format: 'ai.routing.<task_type>'
  const suffix = key.replace(/^ai\.routing\./, '')
  return suffix in DEFAULT_ROUTING ? (suffix as AITaskType) : null
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Read ai.routing.* keys from harness_config and populate the override cache.
 * Idempotent + TTL'd. 5-min cache prevents thrashing on every AI call.
 * Errors are swallowed — falls back to DEFAULT_ROUTING on any failure.
 * Pattern mirrors hydrateOllamaConfig() in lib/ollama/client.ts.
 */
export async function hydrateRoutingConfig(force = false): Promise<void> {
  const now = Date.now()
  if (!force && _hydratedAt !== null && now - _hydratedAt < HYDRATE_TTL_MS) {
    return // cache fresh
  }
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('harness_config')
      .select('key, value')
      .like('key', 'ai.routing.%')
    if (data) {
      const next: Partial<Record<AITaskType, AIProvider>> = {}
      for (const row of data as Array<{ key: string; value: string }>) {
        const taskType = taskKeyToType(row.key)
        const val = (row.value ?? '').trim()
        if (taskType && val && isValidProvider(val)) {
          next[taskType] = val
        }
        // Empty string = use default, so we don't store it
      }
      _overrides = next
    }
    _hydratedAt = now
  } catch {
    // Non-fatal — fall back to DEFAULT_ROUTING
    _hydratedAt = now // mark hydrated so we don't thrash retries
  }
}

/**
 * Reset the override cache. Test-only — exported so unit tests can stub
 * harness_config and force a re-read between assertions.
 * @internal
 */
export function _resetRoutingCache(): void {
  _overrides = {}
  _hydratedAt = null
}

/**
 * Return the AI provider for a given task type.
 *
 * Resolution order:
 *   1. harness_config override (non-empty string from _overrides cache)
 *   2. DEFAULT_ROUTING constant
 *
 * When an override is active and differs from the default, logs to agent_events
 * (fire-and-forget, never throws). This feeds the F17 behavioral data signal.
 */
export function routeAICall(taskType: AITaskType): AIProvider {
  const override = _overrides[taskType]
  if (override) {
    const defaultProvider = DEFAULT_ROUTING[taskType]
    if (override !== defaultProvider) {
      // Fire-and-forget: log the routing override for F17 behavioral data
      void logEvent('ai', 'ai.routing_override', {
        actor: 'system',
        status: 'success',
        meta: {
          task_type: taskType,
          provider: override,
          override_source: 'harness_config',
        },
      })
    }
    return override
  }
  return DEFAULT_ROUTING[taskType]
}
