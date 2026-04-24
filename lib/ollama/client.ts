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

// ── Config ────────────────────────────────────────────────────────────────────

export function getBaseUrl(): string {
  return (process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434').replace(/\/$/, '')
}

export function autoSelectModel(task: 'code' | 'analysis' | 'general' | 'embed'): string {
  const map: Record<typeof task, string> = {
    code:     process.env.OLLAMA_CODE_MODEL     ?? 'qwen2.5-coder:7b',
    analysis: process.env.OLLAMA_ANALYSIS_MODEL ?? 'qwen2.5:32b',
    general:  process.env.OLLAMA_GENERAL_MODEL  ?? 'qwen2.5:7b',
    embed:    process.env.OLLAMA_EMBED_MODEL     ?? 'nomic-embed-text',
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

// ── Uncertainty detection (port of Streamlit utils/local_ai.py) ───────────────
// Hedging phrases → reduce confidence. Each additional phrase lowers it further.

const UNCERTAINTY_PHRASES = [
  "i'm not sure", "i am not sure",
  "i don't know", "i do not know",
  "i'm uncertain", "i am uncertain",
  "i'm not certain", "i am not certain",
  "i cannot say", "i can't say",
  "not sure", "uncertain",
  "i don't have enough", "i do not have enough",
  "it's possible", "it is possible",
  "possibly", "perhaps",
  "might be", "could be", "may be", "maybe",
  "i think", "i believe", "i suspect",
  "i'm guessing", "i am guessing",
  "approximately", "roughly",
]

export function extractConfidence(text: string): number {
  const lower = text.toLowerCase()
  const hits = UNCERTAINTY_PHRASES.filter((p) => lower.includes(p)).length
  if (hits === 0) return 0.85
  if (hits === 1) return 0.60
  if (hits === 2) return 0.40
  return 0.20
}

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function ollamaFetch(path: string, body: unknown, timeoutMs = 30_000): Promise<Response> {
  const url = `${getBaseUrl()}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const tunnelUsed = !!process.env.OLLAMA_TUNNEL_URL && process.env.OLLAMA_TUNNEL_URL !== 'http://localhost:11434'

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    const latency_ms = Date.now() - start

    if (!res.ok) {
      void logEvent('ollama', 'ollama.health', {
        actor: 'system', status: 'failure',
        outputSummary: `HTTP ${res.status}`, durationMs: latency_ms,
      })
      return { reachable: false, models: [], latency_ms, tunnel_used: tunnelUsed }
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> }
    const models = (data.models ?? []).map((m) => m.name)

    void logEvent('ollama', 'ollama.health', {
      actor: 'system', status: 'success',
      outputSummary: `${models.length} model(s) available`, durationMs: latency_ms,
      meta: { models, tunnel_used: tunnelUsed },
    })

    return { reachable: true, models, latency_ms, tunnel_used: tunnelUsed }
  } catch {
    const latency_ms = Date.now() - start
    void logEvent('ollama', 'ollama.health', {
      actor: 'system', status: 'failure',
      outputSummary: 'unreachable', durationMs: latency_ms,
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
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const task = opts.task ?? 'general'
  const model = opts.model ?? autoSelectModel(task)
  const start = Date.now()

  let res: Response
  try {
    res = await ollamaFetch(
      '/api/generate',
      { model, prompt, system: opts.systemPrompt, stream: false },
      opts.timeoutMs ?? 30_000,
    )
  } catch (err) {
    void logEvent('ollama', 'ollama.generate', {
      actor: 'system', status: 'failure',
      errorMessage: 'Ollama unreachable', errorType: 'OllamaUnreachableError',
      durationMs: Date.now() - start,
    })
    throw new OllamaUnreachableError(err)
  }

  if (!res.ok) {
    const msg = `Ollama /api/generate returned HTTP ${res.status}`
    void logEvent('ollama', 'ollama.generate', {
      actor: 'system', status: 'failure',
      errorMessage: msg, durationMs: Date.now() - start,
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
    actor: 'system', status: 'success',
    inputSummary: prompt.slice(0, 200),
    outputSummary: text.slice(0, 200),
    durationMs, tokensUsed: tokens_used ?? undefined, confidence,
    meta: { model, task },
  })

  return { text, confidence, model, tokens_used }
}

// ── embed ─────────────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const model = autoSelectModel('embed')
  const start = Date.now()

  let res: Response
  try {
    res = await ollamaFetch('/api/embeddings', { model, prompt: text }, 15_000)
  } catch (err) {
    void logEvent('ollama', 'ollama.embed', {
      actor: 'system', status: 'failure',
      errorMessage: 'Ollama unreachable', errorType: 'OllamaUnreachableError',
      durationMs: Date.now() - start,
    })
    throw new OllamaUnreachableError(err)
  }

  if (!res.ok) {
    const msg = `Ollama /api/embeddings returned HTTP ${res.status}`
    void logEvent('ollama', 'ollama.embed', {
      actor: 'system', status: 'failure',
      errorMessage: msg, durationMs: Date.now() - start,
    })
    throw new OllamaUnreachableError(msg)
  }

  const data = (await res.json()) as { embedding: number[] }
  const embedding = data.embedding

  void logEvent('ollama', 'ollama.embed', {
    actor: 'system', status: 'success',
    inputSummary: text.slice(0, 200),
    outputSummary: `${embedding.length}-dim vector`,
    durationMs: Date.now() - start,
    meta: { model, dims: embedding.length },
  })

  return embedding
}
