import fs from 'fs'
import path from 'path'
import { generate } from '@/lib/ollama/client'
import { logEvent } from '@/lib/knowledge/client'
import { OLLAMA_MODELS } from '@/lib/ollama/models'

// Read at module load — throws loudly if the file is missing (intentional)
const ANALYST_PROMPT = fs
  .readFileSync(path.join(process.cwd(), 'lib/llm/prompts/analyst.md'), 'utf-8')
  .trim()

export function getAnalystPrompt(): string {
  return ANALYST_PROMPT
}

// Phrases that signal sycophancy when a response starts with them (case-insensitive).
// Extend this list after any eval run that surfaces new openers.
const SYCOPHANCY_OPENERS = [
  'great question',
  'interesting',
  "you're right",
  'you are right',
  "i think you're onto something",
  'i think you are onto something',
]

export function isSycophantic(text: string): boolean {
  const lower = text.toLowerCase()
  return SYCOPHANCY_OPENERS.some((opener) => lower.startsWith(opener))
}

export interface AskOllamaOpts {
  system?: string
  model?: string
  timeoutMs?: number
}

export interface AskOllamaResult {
  text: string
  confidence: number
  sycophancy_flag: boolean
  latency_ms: number
  model: string
}

/**
 * Send a message to Ollama with the analyst system prompt.
 * Returns null if Ollama is unreachable — callers decide whether to escalate.
 * Logs every call to agent_events as 'ollama.analyst_call'.
 */
export async function askOllama(
  userMessage: string,
  opts?: AskOllamaOpts
): Promise<AskOllamaResult | null> {
  const start = Date.now()
  const systemPrompt = opts?.system ?? ANALYST_PROMPT
  const model = opts?.model ?? OLLAMA_MODELS.ANALYSIS

  try {
    const result = await generate(userMessage, {
      task: 'analysis',
      model,
      systemPrompt,
      timeoutMs: opts?.timeoutMs,
    })

    const latency_ms = Date.now() - start
    const sycophancy_flag = isSycophantic(result.text)

    void logEvent('ollama', 'ollama.analyst_call', {
      actor: 'system',
      status: 'success',
      inputSummary: userMessage.slice(0, 500),
      outputSummary: result.text.slice(0, 500),
      durationMs: latency_ms,
      meta: { model, sycophancy_flag, actor_type: 'analyst' },
    })

    return { text: result.text, confidence: result.confidence, sycophancy_flag, latency_ms, model }
  } catch {
    const latency_ms = Date.now() - start
    void logEvent('ollama', 'ollama.analyst_call', {
      actor: 'system',
      status: 'failure',
      errorMessage: 'Ollama unreachable',
      durationMs: latency_ms,
      meta: { model, actor_type: 'analyst' },
    })
    return null
  }
}
