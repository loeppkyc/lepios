/**
 * LepiOS Ollama Client — local LLM integration (Step 5).
 *
 * Reaches Ollama via OLLAMA_TUNNEL_URL (Cloudflare tunnel in production)
 * or http://localhost:11434 in local dev. All model names are env-configurable
 * with sensible defaults for Colin's Qwen 2.5 setup.
 *
 * Uncertainty detection is ported from Streamlit utils/local_ai.py:
 * hedging phrases → lower confidence signal → caller escalates to Claude API.
 *
 * Every public function logs to agent_events (fire-and-forget, never throws).
 *
 * Usage:
 *   import { healthCheck, generate, embed, autoSelectModel } from '@/lib/ollama/client'
 *
 *   const status = await healthCheck()
 *   if (!status.reachable) { // escalate to Claude API }
 *   const result = await generate('Summarise this deal', { task: 'analysis' })
 *   const vec    = await embed('Keepa token exhaustion fix')
 */

import { logEvent } from '@/lib/knowledge/client'
import { createServiceClient } from '@/lib/supabase/service'
import { OLLAMA_MODELS } from '@/lib/ollama/models'
import { getCircuitState, CircuitStatus } from '@/lib/ollama/circuit'

// ── Config ────────────────────────────────────────────────────────────────────

let _startupWarned = false

export function getBaseUrl(): string {
  const url = (process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434').replace(/\/$/, '')
  if (!_startupWarned && process.env.NODE_ENV === 'production' && url.includes('localhost')) {
    _startupWarned = true
    void logEvent('ollama', 'ollama.config_warning', {
      actor: 'system',
      status: 'warning',
      meta: { reason: 'OLLAMA_TUNNEL_URL not set; using localhost fallback in production' },
    })
  }
  return url
}

export function autoSelectModel(task: 'code' | 'analysis' | 'general' | 'embed' | 'twin'): string {
  const map: Record<typeof task, string> = {
    code: OLLAMA_MODELS.CODE,
    analysis: OLLAMA_MODELS.ANALYSIS,
    general: OLLAMA_MODELS.GENERAL,
    embed: OLLAMA_MODELS.EMBED,
    twin: OLLAMA_MODELS.TWIN,
  }
  return map[task]
}

// ── Typed error ───────────────────────────────────────────────────────────────

export class OllamaUnreachableError extends Error {
  override readonly name = 'OllamaUnreachableError'
  constructor(public readonly cause?: unknown) {
    super('Ollama is unreachable')
  }
}

// ── Circuit transition helpers ────────────────────────────────────────────────

/**
 * Fire-and-forget: insert a circuit transition alert into outbound_notifications.
 * Never throws.
 */
async function insertCircuitAlert(text: string, correlationId: string): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text },
      correlation_id: correlationId,
      requires_response: false,
    })
  } catch {
    // Non-critical — alert failure must never block inference
  }
}

/**
 * Log circuit transition events and send Telegram alerts.
 * Called from generate() when circuit.transitioned is true.
 */
function handleCircuitTransition(circuit: CircuitStatus, model: string): void {
  if (!circuit.transitioned) return

  if (circuit.state === 'OPEN' && circuit.prev_state === 'CLOSED') {
    const openReason = circuit.open_reason ?? 'server_unreachable'
    void logEvent('ollama', 'ollama.circuit_open', {
      actor: 'system',
      status: 'warning',
      meta: {
        recent_failures: circuit.recent_failures,
        last_failure_at: circuit.last_failure_at,
        open_reason: openReason,
      },
    })
    void insertCircuitAlert(
      `[LepiOS] Ollama circuit OPEN\n${circuit.recent_failures} failures in 5 min\nReason: ${openReason === 'model_not_loaded' ? 'server reachable but model not loaded' : 'server unreachable'}\nFalling back to Claude until Ollama recovers.`,
      'ollama_circuit_open'
    )
  } else if (
    circuit.state === 'CLOSED' &&
    (circuit.prev_state === 'OPEN' || circuit.prev_state === 'HALF_OPEN')
  ) {
    void logEvent('ollama', 'ollama.circuit_closed', {
      actor: 'system',
      status: 'success',
      meta: { was_open_since: circuit.last_failure_at, model },
    })
    void insertCircuitAlert(
      '[LepiOS] Ollama circuit CLOSED\nOllama is back online. Routing generate calls locally.',
      'ollama_circuit_closed'
    )
  }
}

// ── Uncertainty detection (port of Streamlit utils/local_ai.py) ───────────────
// Hedging phrases → reduce confidence. Each additional phrase lowers it further.

const UNCERTAINTY_PHRASES = [
  "i'm not sure",
  'i am not sure',
  "i don't know",
  'i do not know',
  "i'm uncertain",
  'i am uncertain',
  "i'm not certain",
  'i am not certain',
  'i cannot say',
  "i can't say",
  'not sure',
  'uncertain',
  "i don't have enough",
  'i do not have enough',
  "it's possible",
  'it is possible',
  'possibly',
  'perhaps',
  'might be',
  'could be',
  'may be',
  'maybe',
  'i think',
  'i believe',
  'i suspect',
  "i'm guessing",
  'i am guessing',
  'approximately',
  'roughly',
]

export function extractConfidence(text: string): number {
  const lower = text.toLowerCase()
  const hits = UNCERTAINTY_PHRASES.filter((p) => lower.includes(p)).length
  if (hits === 0) return 0.85
  if (hits === 1) return 0.6
  if (hits === 2) return 0.4
  return 0.2
}

// ── Cloudflare Access headers ─────────────────────────────────────────────────
// When CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET are set, inject service
// token headers so Cloudflare Access allows server-to-server requests to the
// tunnel URL without a browser auth flow. Both vars must be set or neither
// is used (partial config is silently ignored — avoids sending half-tokens).

function getCFAccessHeaders(): Record<string, string> {
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (!id || !secret) return {}
  return {
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': secret,
  }
}

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function ollamaFetch(path: string, body: unknown, timeoutMs = 15_000): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getCFAccessHeaders() },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return res
  } catch (err) {
    throw new OllamaUnreachableError(err)
  } finally {
    clearTimeout(timer)
  }
}

// ── healthCheck ───────────────────────────────────────────────────────────────

export interface OllamaHealthResult {
  reachable: boolean
  models: string[]
  latency_ms: number
  tunnel_used: boolean
}

export async function healthCheck(): Promise<OllamaHealthResult> {
  const start = Date.now()
  const baseUrl = getBaseUrl()
  const tunnelUsed =
    !!process.env.OLLAMA_TUNNEL_URL && process.env.OLLAMA_TUNNEL_URL !== 'http://localhost:11434'

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: getCFAccessHeaders(),
      signal: AbortSignal.timeout(5_000),
    })
    const latency_ms = Date.now() - start

    if (!res.ok) {
      void logEvent('ollama', 'ollama.health', {
        actor: 'system',
        status: 'failure',
        outputSummary: `HTTP ${res.status}`,
        durationMs: latency_ms,
      })
      return { reachable: false, models: [], latency_ms, tunnel_used: tunnelUsed }
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> }
    const models = (data.models ?? []).map((m) => m.name)

    void logEvent('ollama', 'ollama.health', {
      actor: 'system',
      status: 'success',
      outputSummary: `${models.length} model(s) available`,
      durationMs: latency_ms,
      meta: { models, tunnel_used: tunnelUsed },
    })

    return { reachable: true, models, latency_ms, tunnel_used: tunnelUsed }
  } catch {
    const latency_ms = Date.now() - start
    void logEvent('ollama', 'ollama.health', {
      actor: 'system',
      status: 'failure',
      outputSummary: 'unreachable',
      durationMs: latency_ms,
    })
    return { reachable: false, models: [], latency_ms, tunnel_used: tunnelUsed }
  }
}

// ── generate ──────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  task?: 'code' | 'analysis' | 'general'
  model?: string
  timeoutMs?: number
  systemPrompt?: string
}

export interface GenerateResult {
  text: string
  confidence: number
  model: string
  tokens_used: number | null
}

export async function generate(
  prompt: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const task = opts.task ?? 'general'
  const model = opts.model ?? autoSelectModel(task)
  const start = Date.now()

  // ── Circuit breaker check ──────────────────────────────────────────────────
  // Adds ~15ms but saves 15s+ when circuit is OPEN.
  // On Supabase query failure inside getCircuitState(), it defaults to CLOSED.
  let circuit: CircuitStatus
  try {
    circuit = await getCircuitState()
  } catch {
    // Should never reach here (getCircuitState never throws), but be safe
    circuit = {
      state: 'CLOSED',
      open_reason: null,
      recent_failures: 0,
      last_failure_at: null,
      last_success_at: null,
      transitioned: false,
      prev_state: 'CLOSED',
    }
  }

  // Handle state transitions (log + Telegram alert)
  handleCircuitTransition(circuit, model)

  if (circuit.state === 'OPEN') {
    void logEvent('ollama', 'ollama.circuit_skip', {
      actor: 'system',
      status: 'warning',
      meta: { reason: 'circuit_open', recent_failures: circuit.recent_failures },
    })
    throw new OllamaUnreachableError('circuit open — skipping Ollama')
  }

  if (circuit.state === 'HALF_OPEN') {
    // Probe: GET /api/tags, verify target model is loaded
    const health = await healthCheck()
    const modelLoaded = health.reachable && health.models.includes(model)

    if (!health.reachable) {
      void logEvent('ollama', 'ollama.circuit_probe_failed', {
        actor: 'system',
        status: 'failure',
        meta: { state: 'HALF_OPEN', reason: 'server_unreachable', model },
      })
      throw new OllamaUnreachableError('half-open probe failed: server unreachable')
    }
    if (!modelLoaded) {
      // Update open_reason for the transition log if we detect model_not_loaded
      void logEvent('ollama', 'ollama.circuit_probe_failed', {
        actor: 'system',
        status: 'failure',
        meta: {
          state: 'HALF_OPEN',
          reason: 'model_not_loaded',
          model,
          available_models: health.models,
        },
      })
      throw new OllamaUnreachableError(`half-open probe failed: model ${model} not loaded`)
    }
    // Probe succeeded — fall through to generate
  }

  // Analysis tasks use qwen2.5:32b which can take >15s to load from cold.
  const defaultTimeout = task === 'analysis' ? 60_000 : 15_000
  let res: Response
  try {
    res = await ollamaFetch(
      '/api/generate',
      { model, prompt, system: opts.systemPrompt, stream: false },
      opts.timeoutMs ?? defaultTimeout
    )
  } catch (err) {
    void logEvent('ollama', 'ollama.generate', {
      actor: 'system',
      status: 'failure',
      errorMessage: 'Ollama unreachable',
      errorType: 'OllamaUnreachableError',
      durationMs: Date.now() - start,
      meta: {
        model,
        task,
        actor_type: 'ollama_client',
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
    })
    throw new OllamaUnreachableError(err)
  }

  if (!res.ok) {
    const msg = `Ollama /api/generate returned HTTP ${res.status}`
    void logEvent('ollama', 'ollama.generate', {
      actor: 'system',
      status: 'failure',
      errorMessage: msg,
      durationMs: Date.now() - start,
      meta: {
        model,
        task,
        actor_type: 'ollama_client',
        error: msg,
      },
    })
    throw new OllamaUnreachableError(msg)
  }

  const data = (await res.json()) as {
    response: string
    prompt_eval_count?: number
    eval_count?: number
  }

  const text = data.response ?? ''
  const confidence = extractConfidence(text)
  const tokens_used =
    data.prompt_eval_count != null && data.eval_count != null
      ? data.prompt_eval_count + data.eval_count
      : null
  const durationMs = Date.now() - start

  void logEvent('ollama', 'ollama.generate', {
    actor: 'system',
    status: 'success',
    inputSummary: prompt.slice(0, 200),
    outputSummary: text.slice(0, 200),
    durationMs,
    tokensUsed: tokens_used ?? undefined,
    confidence,
    meta: { model, task, actor_type: 'ollama_client' },
  })

  return { text, confidence, model, tokens_used }
}

// ── embed ─────────────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const modelName = autoSelectModel('embed')
  const start = Date.now()
  let res: Response
  try {
    res = await ollamaFetch('/api/embeddings', { model: modelName, prompt: text }, 15_000)
  } catch (err) {
    void logEvent('ollama', 'ollama.embed', {
      actor: 'system',
      status: 'failure',
      errorMessage: 'Ollama unreachable',
      errorType: 'OllamaUnreachableError',
      durationMs: Date.now() - start,
      meta: {
        model: modelName,
        actor_type: 'ollama_client',
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
    })
    throw new OllamaUnreachableError(err)
  }

  if (!res.ok) {
    const msg = `Ollama /api/embeddings returned HTTP ${res.status}`
    void logEvent('ollama', 'ollama.embed', {
      actor: 'system',
      status: 'failure',
      errorMessage: msg,
      durationMs: Date.now() - start,
      meta: {
        model: modelName,
        actor_type: 'ollama_client',
        error: msg,
      },
    })
    throw new OllamaUnreachableError(msg)
  }

  const data = (await res.json()) as { embedding: number[] }
  const embedding = data.embedding

  void logEvent('ollama', 'ollama.embed', {
    actor: 'system',
    status: 'success',
    inputSummary: text.slice(0, 200),
    outputSummary: `${embedding.length}-dim vector`,
    durationMs: Date.now() - start,
    meta: { model: modelName, dims: embedding.length, actor_type: 'ollama_client' },
  })

  return embedding
}
