import { createOllama } from 'ollama-ai-provider'

// ── Error types ────────────────────────────────────────────────────────────────

export class OllamaDownError extends Error {
  constructor(cause?: unknown) {
    super('Ollama is not running')
    this.name = 'OllamaDownError'
    if (cause) this.cause = cause
  }
}

export class OllamaTimeoutError extends Error {
  constructor() {
    super('Ollama timed out')
    this.name = 'OllamaTimeoutError'
  }
}

export class OllamaModelNotFoundError extends Error {
  constructor(public readonly model: string) {
    super(`Model ${model} not found`)
    this.name = 'OllamaModelNotFoundError'
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export interface LepiosOllamaConfig {
  provider: ReturnType<typeof createOllama>
  model: string
  baseURL: string
  timeoutMs: number
}

export function createLepiosOllama(): LepiosOllamaConfig {
  const baseURL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5-coder:3b'
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '60000', 10)
  const provider = createOllama({ baseURL: `${baseURL}/api` })
  return { provider, model, baseURL, timeoutMs }
}

// ── Pre-flight check ───────────────────────────────────────────────────────────
// Hits /api/tags (3 s hard timeout) to confirm Ollama is up and the target model exists.
// Throws OllamaDownError or OllamaModelNotFoundError; rethrows unknowns.

export async function checkOllamaHealth(baseURL: string, model: string): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3_000)
  try {
    const res = await fetch(`${baseURL}/api/tags`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new OllamaDownError(`HTTP ${res.status}`)
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    const names = (data.models ?? []).map((m) => m.name)
    const modelBase = model.split(':')[0]
    const found = names.some((n) => n === model || n.split(':')[0] === modelBase)
    if (!found) throw new OllamaModelNotFoundError(model)
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof OllamaDownError || err instanceof OllamaModelNotFoundError) throw err
    const msg = String(err)
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      msg.includes('connect') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      throw new OllamaDownError(err)
    }
    throw err
  }
}

// ── Error stream ───────────────────────────────────────────────────────────────
// Returns a Vercel AI SDK data-stream v1 response whose content is `message`.
// The client-side useChat hook renders this as a regular assistant message.

export function errorStream(message: string): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(`0:${JSON.stringify(message)}\n`))
      ctrl.enqueue(
        enc.encode(
          `e:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 }, isContinued: false })}\n`,
        ),
      )
      ctrl.enqueue(
        enc.encode(
          `d:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`,
        ),
      )
      ctrl.close()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-vercel-ai-data-stream': 'v1',
      'Cache-Control': 'no-cache',
    },
  })
}
