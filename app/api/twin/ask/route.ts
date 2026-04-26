import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { embed, generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { createServiceClient } from '@/lib/supabase/service'
import { isUncertain } from '@/lib/twin/uncertainty'
import { logEvent } from '@/lib/knowledge/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type EscalateReason = 'insufficient_context' | 'personal_escalation' | 'below_threshold' | null

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

// ── Config ────────────────────────────────────────────────────────────────────

// Expanded in P3 to include coordinator rule/principle chunks ingested from
// CLAUDE.md. Without these categories the twin corpus is only raw emails.
const SEARCHABLE_CATEGORIES = [
  'personal_correspondence',
  'personal_knowledge_base',
  'principle',
  'rule',
]

const SYSTEM_PROMPT =
  "You are a Q&A interface to Colin's personal knowledge. " +
  "Answer ONLY from retrieved context. If insufficient, say 'insufficient_context' and nothing else. " +
  "For questions about Colin's personal values, life decisions, or subjective preferences, " +
  "say 'personal_escalation' and nothing else."

function getTwinConfig() {
  return {
    ollamaModel: (process.env.OLLAMA_TWIN_MODEL ?? 'qwen2.5:32b').trim(),
    confidenceThreshold: parseFloat((process.env.TWIN_CONFIDENCE_THRESHOLD ?? '0.80').trim()),
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

async function retrievePersonalChunks(question: string, limit = 10): Promise<PersonalChunk[]> {
  let vec: number[]
  try {
    vec = await embed(question)
  } catch {
    return []
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: vec,
    match_count: limit * 3,
    min_confidence: 0,
  })

  if (error || !data) return []

  return (data as PersonalChunk[])
    .filter((r) => SEARCHABLE_CATEGORIES.includes(r.category))
    .slice(0, limit)
}

function buildContextString(chunks: PersonalChunk[]): string {
  return chunks
    .map((c, i) => {
      const parts = [c.title, c.problem, c.solution, c.context].filter(Boolean)
      return `[${i + 1}] ${parts.join(' | ')}`
    })
    .join('\n')
}

// ── Confidence heuristic ──────────────────────────────────────────────────────

function computeConfidence(answer: string, topSimilarity: number): number {
  if (isUncertain(answer)) return 0.55
  if (topSimilarity > 0.6) return 0.85
  if (topSimilarity > 0.4) return 0.7
  return 0.45
}

// ── Claude fallback ───────────────────────────────────────────────────────────

async function claudeFallback(
  question: string,
  contextStr: string
): Promise<{ answer: string; confidence: number }> {
  const client = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim() })

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Context:\n${contextStr}\n\nQuestion: ${question}` }],
  })

  const answer = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  const confidence = isUncertain(answer) ? 0.55 : 0.75
  return { answer, confidence }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest
): Promise<NextResponse<TwinResponse | { error: string }>> {
  const body = (await req.json()) as { question?: string; context?: string; chunk_id?: string }
  const question = (body.question ?? '').trim()

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  const { ollamaModel, confidenceThreshold } = getTwinConfig()
  const start = Date.now()

  const chunks = await retrievePersonalChunks(question)
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
      const resp: TwinResponse = {
        answer: '',
        confidence: 0,
        sources,
        escalate: true,
        escalate_reason: 'insufficient_context',
      }
      void logEvent('twin', 'twin.ask', {
        actor: 'user',
        inputSummary: question.slice(0, 200),
        outputSummary: 'ollama_unreachable + no_context',
        confidence: 0,
        durationMs: Date.now() - start,
        meta: {
          escalate: true,
          escalate_reason: 'insufficient_context',
          model: finalModel,
          routing_decision: 'claude_fallback',
          routing_reason: ollamaCircuitOpen
            ? 'circuit_open'
            : ollamaTimedOut
              ? 'ollama_timeout'
              : 'low_confidence',
        },
      })
      return NextResponse.json(resp)
    }

    try {
      const fallback = await claudeFallback(question, contextStr)
      answer = fallback.answer
      confidence = fallback.confidence
    } catch {
      const resp: TwinResponse = {
        answer: '',
        confidence: 0,
        sources,
        escalate: true,
        escalate_reason: 'below_threshold',
      }
      void logEvent('twin', 'twin.ask', {
        actor: 'user',
        inputSummary: question.slice(0, 200),
        outputSummary: 'ollama_unreachable + claude_failed',
        confidence: 0,
        durationMs: Date.now() - start,
        meta: {
          escalate: true,
          escalate_reason: 'below_threshold',
          model: finalModel,
          routing_decision: 'claude_fallback',
          routing_reason: ollamaCircuitOpen
            ? 'circuit_open'
            : ollamaTimedOut
              ? 'ollama_timeout'
              : 'low_confidence',
        },
      })
      return NextResponse.json(resp)
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

    void logEvent('twin', 'twin.ask', {
      actor: 'user',
      inputSummary: question.slice(0, 200),
      outputSummary: answer.slice(0, 200),
      confidence,
      durationMs: Date.now() - start,
      meta: {
        sources_count: sources.length,
        escalate,
        escalate_reason,
        model: finalModel,
        routing_decision: 'claude_fallback',
        routing_reason: ollamaCircuitOpen
          ? 'circuit_open'
          : ollamaTimedOut
            ? 'ollama_timeout'
            : 'low_confidence',
      },
    })
    return NextResponse.json<TwinResponse>({
      answer,
      confidence,
      sources,
      escalate,
      escalate_reason,
    })
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

  void logEvent('twin', 'twin.ask', {
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

  return NextResponse.json<TwinResponse>({ answer, confidence, sources, escalate, escalate_reason })
}
