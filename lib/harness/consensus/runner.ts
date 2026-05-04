/**
 * lib/harness/consensus/runner.ts
 *
 * Programmatic 3+1 debate consensus pipeline.
 *
 * Fan-out: 3 parallel Sonnet calls (technical / practical / skeptical perspectives).
 * Fan-in:  1 sequential Opus call that measures agreement across the 3 perspectives.
 *
 * All Anthropic calls go through httpRequest({ capability: 'net.outbound.anthropic' })
 * from arms_legs — never import the Anthropic SDK directly in harness code.
 *
 * Writes one consensus_runs row before returning. DB write is non-fatal.
 */

import { httpRequest } from '@/lib/harness/arms-legs'
import { createServiceClient } from '@/lib/supabase/service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConsensusLevel = 'full' | 'majority' | 'split'

export interface ConsensusOptions {
  /** Number of perspectives — currently fixed at 3 (n param reserved for Slice 2) */
  n?: number
  /** Model tier hint; 'sonnet' for perspectives, 'opus' for checker */
  tier?: string
  agentId?: string
  reason?: string
}

export interface ConsensusResult {
  runId: string
  answer: string | null
  splits: string[]
  outliers: string[]
  consensusLevel: ConsensusLevel
  rawPerspectives: string[]
  rawConsensus: string
  durationMs: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERSPECTIVE_MODEL = 'claude-sonnet-4-6'
const CONSENSUS_MODEL = 'claude-opus-4-7'

const PERSPECTIVE_MAX_TOKENS = 800
const CONSENSUS_MAX_TOKENS = 600

// ─── System prompts ───────────────────────────────────────────────────────────

const SYSTEM_TECHNICAL = `You are a technical reviewer analyzing a question from a pure engineering perspective.
Your lens: architecture, performance, maintainability, code quality, developer experience.
Be direct and concrete. Your output will be compared against two other perspectives
(practical and skeptical) to measure consensus. This is a structured 3-agent pipeline.

Answer with these sections only:
ANSWER: [1-2 sentences, direct]
REASONING: [3 bullet points with evidence]
RISKS: [top 2 technical risks]
CONFIDENCE: [HIGH/MEDIUM/LOW]`

const SYSTEM_PRACTICAL = `You are a practical reviewer analyzing a question from a cost/effort/ROI perspective.
Your lens: time-to-ship, maintainability cost, solo-developer constraints, opportunity cost.
Be direct and concrete. Your output will be compared against two other perspectives
(technical and skeptical) to measure consensus. This is a structured 3-agent pipeline.

Answer with these sections only:
ANSWER: [1-2 sentences, direct]
REASONING: [3 bullet points with evidence]
RISKS: [top 2 practical risks]
CONFIDENCE: [HIGH/MEDIUM/LOW]`

const SYSTEM_SKEPTICAL = `You are a risk reviewer analyzing a question from a failure-modes perspective.
Your lens: hidden assumptions, second-order effects, irreversibility, security.
Be direct and honest — if risks are genuinely low, say so. Crying wolf loses credibility.
Your output will be compared against two other perspectives (technical and practical)
to measure consensus. This is a structured 3-agent pipeline.

Answer with these sections only:
ANSWER: [1-2 sentences, direct risk assessment]
REASONING: [3 bullet points with evidence]
RISKS: [top 2 risks with severity]
CONFIDENCE: [HIGH/MEDIUM/LOW]`

const SYSTEM_CONSENSUS = `You measure agreement across independent assessments. Extract each agent's core answer,
compare positions, and determine consensus level. Do not force agreement where none exists.
A split is a valuable signal.`

// ─── Anthropic response type ──────────────────────────────────────────────────

interface AnthropicResponse {
  content?: { type: string; text: string }[]
  usage?: { input_tokens: number; output_tokens: number }
  error?: { type: string; message: string }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function callPerspective(
  systemPrompt: string,
  prompt: string,
  apiKey: string,
  agentId: string
): Promise<string> {
  const result = await httpRequest({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    capability: 'net.outbound.anthropic',
    agentId,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: PERSPECTIVE_MODEL,
      max_tokens: PERSPECTIVE_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Question: ${prompt}` }],
    },
    timeoutMs: 60_000,
  })

  if (!result.ok) {
    throw new Error(`Perspective call failed: HTTP ${result.status} ${result.error ?? ''}`.trim())
  }

  let parsed: AnthropicResponse
  try {
    parsed = JSON.parse(result.body) as AnthropicResponse
  } catch {
    throw new Error('Failed to parse Anthropic response JSON for perspective call')
  }

  if (parsed.error) {
    throw new Error(`Anthropic error: ${parsed.error.message}`)
  }

  const textContent = (parsed.content ?? []).find((c) => c.type === 'text')
  return textContent?.text ?? ''
}

interface ConsensusCheckerOutput {
  consensusLevel: ConsensusLevel
  answer: string | null
  splits: string[]
  outliers: string[]
}

function parseConsensusCheckerOutput(raw: string): ConsensusCheckerOutput {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  try {
    const obj = JSON.parse(cleaned) as Partial<ConsensusCheckerOutput>
    return {
      consensusLevel: (obj.consensusLevel as ConsensusLevel) ?? 'split',
      answer: obj.answer ?? null,
      splits: Array.isArray(obj.splits) ? (obj.splits as string[]) : [],
      outliers: Array.isArray(obj.outliers) ? (obj.outliers as string[]) : [],
    }
  } catch {
    return {
      consensusLevel: 'split',
      answer: null,
      splits: ['parse error: consensus checker returned non-JSON output'],
      outliers: [],
    }
  }
}

async function callConsensusChecker(
  prompt: string,
  perspectives: string[],
  apiKey: string,
  agentId: string
): Promise<{ raw: string; parsed: ConsensusCheckerOutput }> {
  const userMessage = `Question: ${prompt}

--- TECHNICAL PERSPECTIVE ---
${perspectives[0]}

--- PRACTICAL PERSPECTIVE ---
${perspectives[1]}

--- SKEPTICAL PERSPECTIVE ---
${perspectives[2]}

Output these fields only (JSON):
{
  "consensusLevel": "full" | "majority" | "split",
  "answer": "the consensus answer, or null if split",
  "splits": ["point of disagreement 1", "point of disagreement 2"],
  "outliers": ["outlier position if any agent diverged from the other 2"]
}`

  const result = await httpRequest({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    capability: 'net.outbound.anthropic',
    agentId,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: CONSENSUS_MODEL,
      max_tokens: CONSENSUS_MAX_TOKENS,
      system: SYSTEM_CONSENSUS,
      messages: [{ role: 'user', content: userMessage }],
    },
    timeoutMs: 60_000,
  })

  let rawText = ''

  if (result.ok) {
    try {
      const parsed = JSON.parse(result.body) as AnthropicResponse
      const textContent = (parsed.content ?? []).find((c) => c.type === 'text')
      rawText = textContent?.text ?? ''
    } catch {
      rawText = ''
    }
  }

  return { raw: rawText, parsed: parseConsensusCheckerOutput(rawText) }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConsensus(
  prompt: string,
  opts?: ConsensusOptions
): Promise<ConsensusResult> {
  const agentId = opts?.agentId ?? 'consensus'
  const reason = opts?.reason

  const start = Date.now()

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''

  // Fan-out: 3 parallel perspective calls
  const [technical, practical, skeptical] = await Promise.all([
    callPerspective(SYSTEM_TECHNICAL, prompt, apiKey, agentId),
    callPerspective(SYSTEM_PRACTICAL, prompt, apiKey, agentId),
    callPerspective(SYSTEM_SKEPTICAL, prompt, apiKey, agentId),
  ])

  const rawPerspectives = [technical, practical, skeptical]

  // Fan-in: 1 sequential consensus checker call
  const { raw: rawConsensus, parsed: checked } = await callConsensusChecker(
    prompt,
    rawPerspectives,
    apiKey,
    agentId
  )

  const durationMs = Date.now() - start
  const runId = crypto.randomUUID()

  const consensusResult: ConsensusResult = {
    runId,
    answer: checked.answer,
    splits: checked.splits,
    outliers: checked.outliers,
    consensusLevel: checked.consensusLevel,
    rawPerspectives,
    rawConsensus,
    durationMs,
  }

  // Write audit row — non-fatal
  try {
    const db = createServiceClient()
    await db.from('consensus_runs').insert({
      id: runId,
      prompt,
      consensus_level: checked.consensusLevel,
      answer: checked.answer,
      splits: checked.splits,
      outliers: checked.outliers,
      raw_perspectives: rawPerspectives,
      raw_consensus: rawConsensus,
      duration_ms: durationMs,
      agent_id: agentId,
      reason: reason ?? null,
    })
  } catch {
    // Non-fatal — still return the result
  }

  return consensusResult
}
