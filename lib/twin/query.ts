/**
 * lib/twin/query.ts — extracted twin logic for reuse by tools and route handlers.
 *
 * Extracted from app/api/twin/ask/route.ts.
 * The route handler is now a thin wrapper calling askTwin().
 */

import Anthropic from '@anthropic-ai/sdk'
import { embed, generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { createServiceClient } from '@/lib/supabase/service'
import { isUncertain } from '@/lib/twin/uncertainty'
import { logEvent } from '@/lib/knowledge/client'
import { logClaudeTokens } from '@/lib/ai/log-tokens'

// ── Types ─────────────────────────────────────────────────────────────────────

export type EscalateReason =
  | 'insufficient_context'
  | 'personal_escalation'
  | 'below_threshold'
  | null

export interface TwinSource {
  chunk_id: string
  similarity: number
}

export interface TwinResponse {
  answer: string
  confidence: number
  sources: TwinSource[]
  escalate: boolean
  escalate_reason: EscalateReason
  retrieval_path: 'vector' | 'fts' | 'none'
  escalation_id: string | null
}

interface PersonalChunk {
  id: string
  category: string
  title: string
  problem: string | null
  solution: string | null
  context: string | null
  similarity: number
}

interface RetrievalResult {
  chunks: PersonalChunk[]
  retrieval_path: 'vector' | 'fts' | 'none'
}

// ── Config ────────────────────────────────────────────────────────────────────

// Expanded in P3 to include coordinator rule/principle chunks ingested from
// CLAUDE.md. Without these categories the twin corpus is only raw emails.
// 'decision' added 2026-04-28 (memory layer chunk #1) so decisions_log rows
// mirrored into knowledge are retrievable; 'idea' reserved for chunk #2.
const SEARCHABLE_CATEGORIES = [
  'personal_correspondence',
  'personal_knowledge_base',
  'principle',
  'rule',
  'decision',
  'idea',
]

const SYSTEM_PROMPT =
  "You are a Q&A interface to Colin's personal knowledge. " +
  "Answer ONLY from retrieved context. If insufficient, say 'insufficient_context' and nothing else. " +
  "For questions about Colin's personal values, life decisions, or subjective preferences, " +
  "say 'personal_escalation' and nothing else."

export function getTwinConfig() {
  return {
    ollamaModel: (process.env.OLLAMA_TWIN_MODEL ?? 'phi4:14b').trim(),
    confidenceThreshold: parseFloat((process.env.TWIN_CONFIDENCE_THRESHOLD ?? '0.80').trim()),
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export async function retrievePersonalChunks(
  question: string,
  limit = 10
): Promise<RetrievalResult> {
  const supabase = createServiceClient()

  // Vector path
  let vectorChunks: PersonalChunk[] = []
  try {
    const vec = await embed(question)
    const { data, error } = await supabase.rpc('match_knowledge', {
      query_embedding: vec,
      match_count: limit * 3,
      min_confidence: 0,
    })
    if (!error && data) {
      vectorChunks = (data as PersonalChunk[])
        .filter((r) => SEARCHABLE_CATEGORIES.includes(r.category))
        .slice(0, limit)
    }
  } catch {
    // embed failed or RPC failed — fall through to FTS
  }

  if (vectorChunks.length > 0) {
    return { chunks: vectorChunks, retrieval_path: 'vector' }
  }

  // FTS fallback
  try {
    const { data, error } = await supabase
      .from('knowledge')
      .select('id, category, title, problem, solution, context')
      .textSearch('fts', question, { type: 'websearch', config: 'english' })
      .in('category', SEARCHABLE_CATEGORIES)
      .limit(limit)

    if (!error && data && (data as unknown[]).length > 0) {
      const chunks = (data as Omit<PersonalChunk, 'similarity'>[]).map((r) => ({
        ...r,
        similarity: 0,
      }))
      return { chunks, retrieval_path: 'fts' }
    }
  } catch {
    // FTS failed too
  }

  return { chunks: [], retrieval_path: 'none' }
}

export function buildContextString(chunks: PersonalChunk[]): string {
  return chunks
    .map((c, i) => {
      const parts = [c.title, c.problem, c.solution, c.context].filter(Boolean)
      return `[${i + 1}] ${parts.join(' | ')}`
    })
    .join('\n')
}

// ── Confidence heuristic ──────────────────────────────────────────────────────

export function computeConfidence(answer: string, topSimilarity: number): number {
  if (isUncertain(answer)) return 0.55
  if (topSimilarity > 0.6) return 0.85
  if (topSimilarity > 0.4) return 0.7
  return 0.45
}

// ── Claude fallback ───────────────────────────────────────────────────────────

export async function claudeFallback(
  question: string,
  contextStr: string
): Promise<{ answer: string; confidence: number }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured — frontier fallback unavailable')
  }
  const client = new Anthropic({ apiKey })

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Context:\n${contextStr}\n\nQuestion: ${question}` }],
  })
  logClaudeTokens(msg, 'twin')

  const answer = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  const confidence = isUncertain(answer) ? 0.55 : 0.75
  return { answer, confidence }
}

// ── Escalation tracking ───────────────────────────────────────────────────────

/**
 * Inserts a row into twin_escalations capturing the escalated question.
 * Returns the new row id, or null on insert failure (table missing,
 * RLS denial, etc.). Soft-fails — never throws — so the askTwin response
 * is unaffected by tracking issues.
 */
async function recordEscalation(
  question: string,
  escalateReason: Exclude<EscalateReason, null>,
  sourceEventId: string | null
): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('twin_escalations')
      .insert({
        question: question.slice(0, 2000),
        escalate_reason: escalateReason,
        source_event_id: sourceEventId,
      })
      .select('id')
      .single()
    if (error || !data) return null
    return (data as { id: string }).id
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function askTwin(question: string): Promise<TwinResponse> {
  const { ollamaModel, confidenceThreshold } = getTwinConfig()
  const start = Date.now()

  const { chunks, retrieval_path } = await retrievePersonalChunks(question)
  const topSimilarity = (chunks[0] as PersonalChunk | undefined)?.similarity ?? 0
  const sources: TwinSource[] = chunks.map((c) => ({ chunk_id: c.id, similarity: c.similarity }))
  const contextStr = buildContextString(chunks)

  const ollamaPrompt = contextStr
    ? `Context:\n${contextStr}\n\nQuestion: ${question}`
    : `Question: ${question}`

  let answer: string
  let confidence: number
  let escalate = false
  let escalate_reason: EscalateReason = null
  let finalModel = ollamaModel

  // ── F17: routing tracking variables ─────────────────────────────────────────
  let ollamaUsed = false
  let ollamaCircuitOpen = false
  let ollamaTimedOut = false

  // ── Ollama first ────────────────────────────────────────────────────────────

  try {
    const result = await generate(ollamaPrompt, {
      model: ollamaModel,
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: 15_000,
    })
    answer = result.text.trim()
    ollamaUsed = true
  } catch (err) {
    if (!(err instanceof OllamaUnreachableError)) throw err

    // Detect circuit open vs timeout vs other
    const errMsg = err instanceof Error ? err.message : ''
    if (errMsg.includes('circuit open')) {
      ollamaCircuitOpen = true
    } else if (
      errMsg.includes('aborted') ||
      errMsg.includes('timeout') ||
      errMsg.includes('abort')
    ) {
      ollamaTimedOut = true
    }

    // Ollama down — fall straight to Claude
    finalModel = 'claude-sonnet-4-6'
    if (!contextStr) {
      const sourceEventId = await logEvent('twin', 'twin.ask', {
        actor: 'user',
        inputSummary: question.slice(0, 200),
        outputSummary: 'ollama_unreachable + no_context',
        confidence: 0,
        durationMs: Date.now() - start,
        meta: {
          escalate: true,
          escalate_reason: 'insufficient_context',
          retrieval_path,
          model: finalModel,
          routing_decision: 'claude_fallback',
          routing_reason: ollamaCircuitOpen
            ? 'circuit_open'
            : ollamaTimedOut
              ? 'ollama_timeout'
              : 'low_confidence',
        },
      })
      const escalation_id = await recordEscalation(question, 'insufficient_context', sourceEventId)
      return {
        answer: '',
        confidence: 0,
        sources,
        escalate: true,
        escalate_reason: 'insufficient_context',
        retrieval_path,
        escalation_id,
      }
    }

    try {
      const fallback = await claudeFallback(question, contextStr)
      answer = fallback.answer
      confidence = fallback.confidence
    } catch {
      const sourceEventId = await logEvent('twin', 'twin.ask', {
        actor: 'user',
        inputSummary: question.slice(0, 200),
        outputSummary: 'ollama_unreachable + claude_failed',
        confidence: 0,
        durationMs: Date.now() - start,
        meta: {
          escalate: true,
          escalate_reason: 'below_threshold',
          retrieval_path,
          model: finalModel,
          routing_decision: 'claude_fallback',
          routing_reason: ollamaCircuitOpen
            ? 'circuit_open'
            : ollamaTimedOut
              ? 'ollama_timeout'
              : 'low_confidence',
        },
      })
      const escalation_id = await recordEscalation(question, 'below_threshold', sourceEventId)
      return {
        answer: '',
        confidence: 0,
        sources,
        escalate: true,
        escalate_reason: 'below_threshold',
        retrieval_path,
        escalation_id,
      }
    }

    // Normalise Claude response through the same special-token check
    if (answer === 'insufficient_context') {
      escalate = true
      escalate_reason = 'insufficient_context'
      confidence = 0
    } else if (answer === 'personal_escalation') {
      escalate = true
      escalate_reason = 'personal_escalation'
      confidence = 0
    } else if (confidence < confidenceThreshold) {
      escalate = true
      escalate_reason = 'below_threshold'
    }

    const sourceEventId = await logEvent('twin', 'twin.ask', {
      actor: 'user',
      inputSummary: question.slice(0, 200),
      outputSummary: answer.slice(0, 200),
      confidence,
      durationMs: Date.now() - start,
      meta: {
        sources_count: sources.length,
        escalate,
        escalate_reason,
        retrieval_path,
        model: finalModel,
        routing_decision: 'claude_fallback',
        routing_reason: ollamaCircuitOpen
          ? 'circuit_open'
          : ollamaTimedOut
            ? 'ollama_timeout'
            : 'low_confidence',
      },
    })
    const escalation_id = escalate
      ? await recordEscalation(question, escalate_reason!, sourceEventId)
      : null
    return {
      answer,
      confidence,
      sources,
      escalate,
      escalate_reason,
      retrieval_path,
      escalation_id,
    }
  }

  // ── Check special tokens ────────────────────────────────────────────────────

  if (answer === 'insufficient_context') {
    escalate = true
    escalate_reason = 'insufficient_context'
    confidence = 0
  } else if (answer === 'personal_escalation') {
    escalate = true
    escalate_reason = 'personal_escalation'
    confidence = 0
  } else {
    confidence = computeConfidence(answer, topSimilarity)
  }

  // ── Claude fallback if below threshold ──────────────────────────────────────

  if (!escalate && confidence < confidenceThreshold) {
    finalModel = 'claude-sonnet-4-6'
    ollamaUsed = false
    if (contextStr) {
      try {
        const fallback = await claudeFallback(question, contextStr)
        answer = fallback.answer
        confidence = fallback.confidence

        if (answer === 'insufficient_context') {
          escalate = true
          escalate_reason = 'insufficient_context'
          confidence = 0
        } else if (answer === 'personal_escalation') {
          escalate = true
          escalate_reason = 'personal_escalation'
          confidence = 0
        } else if (confidence < confidenceThreshold) {
          escalate = true
          escalate_reason = 'below_threshold'
        }
      } catch {
        escalate = true
        escalate_reason = 'below_threshold'
      }
    } else {
      escalate = true
      escalate_reason = 'below_threshold'
    }
  }

  const sourceEventId = await logEvent('twin', 'twin.ask', {
    actor: 'user',
    inputSummary: question.slice(0, 200),
    outputSummary: answer.slice(0, 200),
    confidence,
    durationMs: Date.now() - start,
    meta: {
      sources_count: sources.length,
      top_similarity: topSimilarity,
      escalate,
      escalate_reason,
      retrieval_path,
      model: finalModel,
      routing_decision: ollamaUsed ? 'ollama' : 'claude_fallback',
      routing_reason: ollamaUsed
        ? 'primary'
        : ollamaCircuitOpen
          ? 'circuit_open'
          : ollamaTimedOut
            ? 'ollama_timeout'
            : 'low_confidence',
    },
  })

  const escalation_id = escalate
    ? await recordEscalation(question, escalate_reason!, sourceEventId)
    : null

  return {
    answer,
    confidence,
    sources,
    escalate,
    escalate_reason,
    retrieval_path,
    escalation_id,
  }
}
