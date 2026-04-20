/**
 * LepiOS Knowledge Client — port of Streamlit utils/knowledge.py to TypeScript.
 *
 * Storage: Supabase Postgres (agent_events + knowledge + daily_metrics tables).
 * Retrieval: Postgres full-text search (tsvector generated column).
 *
 * SPRINT5-GATE: Semantic/vector search is deferred to Step 5 (Ollama port).
 * When Ollama runs in LepiOS, embeddings will be generated locally and stored
 * via pgvector — a standard Postgres extension that migrates to the home-server
 * Postgres with zero code changes. The embedding_id column is the forward hook.
 * ChromaDB (Python) stays as the Streamlit-era reference; LepiOS uses pgvector.
 *
 * Usage:
 *   import { logEvent, logError, saveKnowledge, retrieveContext } from '@/lib/knowledge/client'
 *
 *   await logEvent('pageprofit', 'scan', { actor: 'user', status: 'success', ... })
 *   await logError('pageprofit', 'scan', error, { entity: isbn })
 *   await retrieveContext('SP-API throttling')  // → prompt-injectable context string
 */

import { createServiceClient } from '@/lib/supabase/service'
import { embed, OllamaUnreachableError } from '@/lib/ollama/client'
import type {
  KnowledgeCategory,
  KnowledgeEntry,
  LogEventOptions,
  FindKnowledgeOptions,
  SaveKnowledgeOptions,
  MemoryHealthStats,
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function trunc(s: string | null | undefined, max: number): string | undefined {
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

// ── 1. Event Logger ──────────────────────────────────────────────────────────

/**
 * Log an event to agent_events. Never throws — logging must not break callers.
 * Returns the event UUID on success, null on failure.
 */
export async function logEvent(
  domain: string,
  action: string,
  opts: LogEventOptions = {},
): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('agent_events')
      .insert({
        domain,
        action,
        actor: opts.actor ?? 'system',
        status: opts.status ?? 'success',
        entity: opts.entity ?? null,
        input_summary: trunc(opts.inputSummary, 500) ?? null,
        output_summary: trunc(opts.outputSummary, 500) ?? null,
        error_message: trunc(opts.errorMessage, 1000) ?? null,
        error_type: opts.errorType ?? null,
        duration_ms: opts.durationMs ?? null,
        tokens_used: opts.tokensUsed ?? null,
        confidence: opts.confidence ?? null,
        parent_id: opts.parentId ?? null,
        session_id: opts.sessionId ?? null,
        tags: opts.tags ?? null,
        meta: opts.meta ?? null,
      })
      .select('id')
      .single()

    if (error) return null
    return (data as { id: string } | null)?.id ?? null
  } catch {
    return null
  }
}

/** Shorthand: log a failure event with error details extracted. */
export async function logError(
  domain: string,
  action: string,
  error: unknown,
  opts: Omit<LogEventOptions, 'status' | 'errorMessage' | 'errorType'> = {},
): Promise<string | null> {
  const err = error instanceof Error ? error : new Error(String(error))
  return logEvent(domain, action, {
    ...opts,
    status: 'failure',
    errorMessage: err.message.slice(0, 1000),
    errorType: err.constructor.name,
  })
}

/** Shorthand: log a success event with output summary. */
export async function logSuccess(
  domain: string,
  action: string,
  summary: string,
  opts: Omit<LogEventOptions, 'status' | 'outputSummary'> = {},
): Promise<string | null> {
  return logEvent(domain, action, {
    ...opts,
    status: 'success',
    outputSummary: summary,
  })
}

// ── 2. Knowledge Store ───────────────────────────────────────────────────────

/**
 * Save a knowledge entry. Returns the knowledge UUID on success, null on failure.
 * Full-text index is auto-maintained by the tsvector generated column.
 *
 * Auto-embeds the entry via Ollama (embed model) and stores the vector.
 * If Ollama is unreachable at save time the row is saved without an embedding
 * and flagged for the backfill script (scripts/backfill-embeddings.ts).
 */
export async function saveKnowledge(
  category: KnowledgeCategory,
  domain: string,
  title: string,
  opts: SaveKnowledgeOptions = {},
): Promise<string | null> {
  try {
    const supabase = createServiceClient()

    // Attempt to generate an embedding. Fail silently — the row is still saved.
    let embedding: number[] | null = null
    try {
      const embedText = [title, opts.problem, opts.solution, opts.context]
        .filter(Boolean)
        .join(' ')
      embedding = await embed(embedText)
    } catch (err) {
      if (!(err instanceof OllamaUnreachableError)) throw err
      // Ollama down — row saved without embedding; backfill script will fill it later
    }

    const { data, error } = await supabase
      .from('knowledge')
      .insert({
        category,
        domain,
        title: trunc(title, 300) ?? title,
        entity: opts.entity ?? null,
        problem: trunc(opts.problem, 1000) ?? null,
        solution: trunc(opts.solution, 1000) ?? null,
        context: trunc(opts.context, 1000) ?? null,
        confidence: opts.confidence ?? 0.5,
        source_events: opts.sourceEvents ?? null,
        tags: opts.tags ?? null,
        embedding: embedding ? JSON.stringify(embedding) : null,
      })
      .select('id')
      .single()

    if (error) {
      const e = error as unknown as Record<string, unknown>
      console.error('[saveKnowledge] Supabase insert failed:', {
        message: error.message,
        details: e['details'] ?? null,
        hint:    e['hint']    ?? null,
        code:    e['code']    ?? null,
      })
      return null
    }
    return (data as { id: string } | null)?.id ?? null
  } catch (err) {
    console.error('[saveKnowledge] Unexpected error:', err)
    return null
  }
}

// ── FTS helpers (internal) ────────────────────────────────────────────────────

async function runFtsSearch(
  query: string,
  opts: FindKnowledgeOptions,
): Promise<KnowledgeEntry[]> {
  const supabase = createServiceClient()
  const limit = opts.limit ?? 5
  const minConfidence = opts.minConfidence ?? 0.0

  let q = supabase
    .from('knowledge')
    .select('id, created_at, updated_at, category, domain, entity, title, problem, solution, context, confidence, times_used, times_helpful, last_used_at, source_events, tags, embedding_id')
    .gte('confidence', minConfidence)
    .order('confidence', { ascending: false })
    .limit(limit)

  if (opts.category) q = q.eq('category', opts.category)
  if (opts.domain) q = q.eq('domain', opts.domain)

  if (query.trim()) {
    const words = query
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter((w) => w.length >= 3)
      .slice(0, 5)
    if (words.length > 0) {
      q = q.textSearch('fts', words.join(' or '), { type: 'websearch', config: 'english' })
    }
  }

  const { data, error } = await q
  if (error || !data) return []
  return data as KnowledgeEntry[]
}

// ── Hybrid merge (60% vector + 40% FTS) ──────────────────────────────────────

interface VectorRow extends KnowledgeEntry {
  similarity: number
}

function mergeHybrid(
  vectorRows: VectorRow[],
  ftsRows: KnowledgeEntry[],
  limit: number,
): KnowledgeEntry[] {
  // Normalize FTS rank: position 0 = score 1.0, last = 0.0
  const ftsScore = (idx: number, total: number) =>
    total > 1 ? 1 - idx / (total - 1) : 1

  const scores = new Map<string, number>()
  const byId = new Map<string, KnowledgeEntry>()

  for (let i = 0; i < vectorRows.length; i++) {
    const row = vectorRows[i]
    scores.set(row.id, (scores.get(row.id) ?? 0) + 0.6 * row.similarity)
    byId.set(row.id, row)
  }

  for (let i = 0; i < ftsRows.length; i++) {
    const row = ftsRows[i]
    scores.set(row.id, (scores.get(row.id) ?? 0) + 0.4 * ftsScore(i, ftsRows.length))
    if (!byId.has(row.id)) byId.set(row.id, row)
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!)
}

/**
 * Hybrid knowledge search: 60% vector similarity + 40% FTS rank.
 *
 * Vector path: calls Ollama embed() then match_knowledge() RPC (pgvector).
 * FTS path: existing Postgres tsvector search.
 *
 * Graceful fallback: if Ollama is unreachable, drops to 100% FTS and logs
 * a knowledge.search.fts_only event. Callers see identical KnowledgeEntry[]
 * shape regardless of which path ran.
 */
export async function findKnowledge(
  query: string,
  opts: FindKnowledgeOptions = {},
): Promise<KnowledgeEntry[]> {
  const limit = opts.limit ?? 5
  const minConfidence = opts.minConfidence ?? 0.0
  const trimmedQuery = query.trim()

  // Empty query: nothing to search
  if (!trimmedQuery) return []

  try {
    // Run FTS and vector embed in parallel
    const [ftsResult, embeddingResult] = await Promise.allSettled([
      runFtsSearch(trimmedQuery, opts),
      embed(trimmedQuery),
    ])

    const ftsRows = ftsResult.status === 'fulfilled' ? ftsResult.value : []

    // Vector path unavailable → FTS-only fallback
    if (embeddingResult.status === 'rejected') {
      void logEvent('knowledge', 'knowledge.search.fts_only', {
        actor: 'system', status: 'warning',
        inputSummary: trimmedQuery.slice(0, 200),
        outputSummary: `Ollama unreachable — fell back to FTS (${ftsRows.length} results)`,
      })
      return ftsRows
    }

    // Vector path available — run match_knowledge RPC
    const supabase = createServiceClient()
    const { data: vectorData, error: vectorError } = await supabase.rpc('match_knowledge', {
      query_embedding: embeddingResult.value,
      match_count: limit,
      min_confidence: minConfidence,
    })

    if (vectorError || !vectorData) {
      // RPC failed — fall back to FTS
      void logEvent('knowledge', 'knowledge.search.fts_only', {
        actor: 'system', status: 'warning',
        inputSummary: trimmedQuery.slice(0, 200),
        outputSummary: `match_knowledge RPC error — fell back to FTS (${ftsRows.length} results)`,
      })
      return ftsRows
    }

    // Apply category/domain filters to vector results (RPC doesn't filter)
    let vectorRows = (vectorData as VectorRow[])
    if (opts.category) vectorRows = vectorRows.filter((r) => r.category === opts.category)
    if (opts.domain)   vectorRows = vectorRows.filter((r) => r.domain   === opts.domain)

    return mergeHybrid(vectorRows, ftsRows, limit)
  } catch {
    return []
  }
}

/**
 * Find fixes for a specific error type. Exact match first (error_type field),
 * then FTS supplement.
 */
export async function retrieveForError(
  errorType: string,
  errorMessage: string,
  limit: number = 3,
): Promise<KnowledgeEntry[]> {
  try {
    const supabase = createServiceClient()

    // Exact match on error_type column in source_events titles
    const { data: exactRows } = await supabase
      .from('knowledge')
      .select('*')
      .eq('category', 'error_fix')
      .ilike('title', `%${errorType}%`)
      .order('confidence', { ascending: false })
      .limit(limit)

    const exact = (exactRows ?? []) as KnowledgeEntry[]
    if (exact.length >= limit) return exact

    // Supplement with FTS
    const semantic = await findKnowledge(`${errorType} ${errorMessage.slice(0, 100)}`, {
      category: 'error_fix',
      limit: limit - exact.length,
    })

    const seen = new Set(exact.map((e) => e.id))
    return [...exact, ...semantic.filter((e) => !seen.has(e.id))].slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Format retrieved knowledge as a context string for LLM prompt injection.
 * Marks entries as used (confidence += 0.05 per use, atomic via RPC).
 */
export async function retrieveContext(
  question: string,
  opts: { domain?: string; limit?: number } = {},
): Promise<string> {
  const entries = await findKnowledge(question, {
    domain: opts.domain,
    limit: opts.limit ?? 3,
    minConfidence: 0.3,
  })

  if (!entries.length) return ''

  const lines: string[] = ['## Relevant Knowledge (from past experience)']
  for (const e of entries) {
    const cat = e.category.replace(/_/g, ' ')
    lines.push(`\n### ${cat}: ${e.title} (confidence: ${e.confidence.toFixed(1)})`)
    if (e.problem) lines.push(`Problem: ${e.problem}`)
    if (e.solution) lines.push(`Solution: ${e.solution}`)
    if (e.context) lines.push(`Context: ${e.context}`)
    // Fire-and-forget — don't await, context retrieval shouldn't block
    void markUsed(e.id, true)
  }

  return lines.join('\n')
}

/**
 * Record that a knowledge entry was retrieved.
 * Atomic confidence adjustment via Postgres RPC (no read-modify-write race).
 */
export async function markUsed(knowledgeId: string, helpful: boolean = true): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.rpc('knowledge_mark_used', {
      p_id: knowledgeId,
      p_helpful: helpful,
    })
  } catch {
    // Non-critical
  }
}

// ── 3. Query Helpers ─────────────────────────────────────────────────────────

/** Count events in the last N hours, optionally filtered by domain. */
export async function getEventCount(
  domain?: string,
  hours: number = 24,
): Promise<number> {
  try {
    const supabase = createServiceClient()
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
    let q = supabase
      .from('agent_events')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', cutoff)
    if (domain) q = q.eq('domain', domain)
    const { count } = await q
    return count ?? 0
  } catch {
    return 0
  }
}

/** Error summary grouped by domain+action+error_type for the last N hours. */
export async function getErrorSummary(
  hours: number = 24,
): Promise<Array<{ domain: string; action: string; error_type: string; count: number }>> {
  try {
    const supabase = createServiceClient()
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
    const { data } = await supabase
      .from('agent_events')
      .select('domain, action, error_type')
      .in('status', ['error', 'failure'])
      .gte('occurred_at', cutoff)

    if (!data) return []

    // Group client-side (Supabase JS SDK doesn't expose GROUP BY directly)
    const counts = new Map<string, { domain: string; action: string; error_type: string; count: number }>()
    for (const row of data) {
      const key = `${row.domain}::${row.action}::${row.error_type ?? 'unknown'}`
      const existing = counts.get(key)
      if (existing) {
        existing.count++
      } else {
        counts.set(key, { domain: row.domain, action: row.action, error_type: row.error_type ?? 'unknown', count: 1 })
      }
    }

    return Array.from(counts.values()).sort((a, b) => b.count - a.count)
  } catch {
    return []
  }
}

/** Overview stats for the knowledge base. */
export async function getKnowledgeStats(): Promise<{
  total: number
  byCategory: Record<string, number>
  avgConfidence: number
}> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('knowledge').select('category, confidence')
    if (!data) return { total: 0, byCategory: {}, avgConfidence: 0 }

    const byCategory: Record<string, number> = {}
    let confSum = 0
    for (const row of data) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
      confSum += row.confidence
    }

    return {
      total: data.length,
      byCategory,
      avgConfidence: data.length > 0 ? Math.round((confSum / data.length) * 1000) / 1000 : 0,
    }
  } catch {
    return { total: 0, byCategory: {}, avgConfidence: 0 }
  }
}

/** Comprehensive memory health metrics. */
export async function getMemoryHealth(): Promise<MemoryHealthStats> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('knowledge')
      .select('category, domain, confidence')

    if (!data) return { total: 0, avgConfidence: 0, staleCount: 0, byCategory: {}, byDomain: {}, coverageGaps: [] }

    const byCategory: Record<string, number> = {}
    const byDomain: Record<string, number> = {}
    let confSum = 0
    let staleCount = 0

    for (const row of data) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
      byDomain[row.domain] = (byDomain[row.domain] ?? 0) + 1
      confSum += row.confidence
      if (row.confidence < 0.2) staleCount++
    }

    const coverageGaps = Object.entries(byDomain)
      .filter(([, c]) => c < 5)
      .map(([d]) => d)

    return {
      total: data.length,
      avgConfidence: data.length > 0 ? Math.round((confSum / data.length) * 1000) / 1000 : 0,
      staleCount,
      byCategory,
      byDomain,
      coverageGaps,
    }
  } catch {
    return { total: 0, avgConfidence: 0, staleCount: 0, byCategory: {}, byDomain: {}, coverageGaps: [] }
  }
}
