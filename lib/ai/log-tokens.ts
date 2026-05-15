import { logEvent } from '@/lib/knowledge/client'

// Pricing per million tokens (USD) — update when Anthropic changes rates
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
}

/**
 * Fire-and-forget: log Claude API token usage to agent_events after any
 * client.messages.create() call. domain = the feature area (e.g. 'receipts').
 * Uses action 'claude.usage' so the token-stats route can aggregate cleanly.
 */
export function logClaudeTokens(
  response: { usage?: { input_tokens?: number; output_tokens?: number }; model?: string },
  domain: string
): void {
  const usage = response.usage
  if (!usage) return
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const model = response.model ?? 'claude-sonnet-4-6'
  const p = PRICING[model] ?? { input: 3.0, output: 15.0 }
  const costUsd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000

  void logEvent(domain, 'claude.usage', {
    tokensUsed: inputTokens + outputTokens,
    costUsd,
    meta: { input_tokens: inputTokens, output_tokens: outputTokens, model },
  })
}
