/**
 * pre-research.ts — Ollama-driven pre-research for queued tasks.
 *
 * Runs in the daytime tick (lib/orchestrator/daytime-tick.ts) after health checks.
 * For each queued task in task_queue, extracts Streamlit module hints from the
 * task description, fetches matching source snippets from the knowledge table,
 * and generates an Ollama summary stored in task_queue.metadata.research_notes.
 *
 * Graceful degradation:
 * - Ollama unreachable → skip, do not write metadata, do not throw
 * - No knowledge hits → skip silently
 * - Any uncaught error → captured in PreResearchResult.errors, never re-thrown
 *
 * F17: feeds curated source summaries into coordinator Phase 1a, reducing
 *      hallucination risk and cloud token cost.
 * F18: tasks_processed + tasks_skipped surfaces pre/post token savings.
 *      Log action='pre_research_complete' to agent_events after each run.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { OLLAMA_MODELS } from '@/lib/ollama/models'
import { logEvent } from '@/lib/knowledge/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreResearchResult {
  tasks_processed: number
  tasks_skipped: number // already have research_notes
  tasks_no_hints: number
  tasks_ollama_error: number
  errors: string[]
}

// Minimal shape of a task_queue row for pre-research purposes
interface QueuedTask {
  id: string
  task: string
  description: string | null
  metadata: Record<string, unknown>
}

interface KnowledgeRow {
  entity: string
  title: string
  context: string
}

interface SummarizeResult {
  text: string
  model: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SOURCE_CHARS = 6000
const SYSTEM_PROMPT =
  'Summarize domain rules, data flow, and edge cases from this Streamlit code. Be precise. Max 400 words.'

// ── extractModuleHints ────────────────────────────────────────────────────────

/**
 * Extract Streamlit module hints from a task description.
 * Returns an array of lowercase slug strings suitable for ILIKE queries.
 *
 * Patterns recognized:
 *   - "52_Utility_Tracker.py" → ["52_utility", "utility_tracker"]
 *   - "port utility_tracker" → ["utility_tracker"]
 *   - No pattern → []
 */
export function extractModuleHints(description: string): string[] {
  const hints = new Set<string>()

  // Match NN_Module_Name.py patterns (e.g. "52_Utility_Tracker.py")
  const filePattern = /\b(\d{2,3})_([A-Za-z][A-Za-z0-9_]+)\.py\b/g
  let match: RegExpExecArray | null
  while ((match = filePattern.exec(description)) !== null) {
    const pageNum = match[1]
    const modulePart = match[2].toLowerCase()
    // "52_utility" hint matches the file path "pages/52_Utility_Tracker.py"
    hints.add(`${pageNum}_${modulePart.split('_')[0]}`)
    // "utility_tracker" hint matches by module name slug
    hints.add(modulePart)
  }

  // Match bare page slugs (e.g. "utility_tracker" without file extension)
  // Only if they look like a snake_case module name (at least one underscore)
  const descLower = description.toLowerCase()
  const slugPattern = /\b([a-z][a-z0-9]+(?:_[a-z0-9]+)+)\b/g
  while ((match = slugPattern.exec(descLower)) !== null) {
    const slug = match[1]
    // Avoid generic English phrases — require at least one segment ≥ 4 chars
    const segments = slug.split('_')
    if (segments.some((s) => s.length >= 4)) {
      hints.add(slug)
    }
  }

  return [...hints]
}

// ── fetchSourceSnippets ───────────────────────────────────────────────────────

/**
 * Query the knowledge table for streamlit_source rows matching any hint.
 * Returns concatenated context strings, capped at MAX_SOURCE_CHARS total.
 * Returns "" if no matches found.
 */
export async function fetchSourceSnippets(hints: string[]): Promise<string> {
  if (hints.length === 0) return ''

  const db = createServiceClient()
  const parts: string[] = []
  const seenEntities = new Set<string>()
  let totalChars = 0

  for (const hint of hints) {
    if (totalChars >= MAX_SOURCE_CHARS) break

    const { data, error } = await db
      .from('knowledge')
      .select('entity, title, context')
      .eq('domain', 'streamlit_source')
      .ilike('entity', `%${hint}%`)
      .order('entity', { ascending: true })
      .limit(10)

    if (error || !data) continue

    for (const row of data as KnowledgeRow[]) {
      const rowKey = `${row.entity}:${row.title}`
      if (seenEntities.has(rowKey)) continue
      seenEntities.add(rowKey)

      const snippet = `# ${row.entity} — ${row.title}\n${row.context}`
      const remaining = MAX_SOURCE_CHARS - totalChars
      if (snippet.length > remaining) {
        parts.push(snippet.slice(0, remaining))
        totalChars = MAX_SOURCE_CHARS
        break
      }
      parts.push(snippet)
      totalChars += snippet.length
    }
  }

  return parts.join('\n\n')
}

// ── summarizeSource ───────────────────────────────────────────────────────────

/**
 * Call Ollama to summarize the source snippets in context of the task description.
 * Returns null on OllamaUnreachableError — caller treats null as a skip signal.
 * Never throws on Ollama errors; re-throws other unexpected errors.
 */
export async function summarizeSource(
  taskDesc: string,
  source: string
): Promise<SummarizeResult | null> {
  if (!source) return null
  const prompt = `Task: ${taskDesc}\n\nStreamlit source:\n${source}`
  try {
    const result = await generate(prompt, {
      task: 'analysis',
      systemPrompt: SYSTEM_PROMPT,
    })
    return { text: result.text, model: result.model }
  } catch (err) {
    if (err instanceof OllamaUnreachableError) {
      return null
    }
    // Re-throw non-Ollama errors so runPreResearch can catch and count them
    throw err
  }
}

// ── writeResearchNotes ────────────────────────────────────────────────────────

/**
 * Write pre-research metadata fields to task_queue.metadata via read-merge-write.
 * Fields written:
 *   research_notes, research_notes_source_files, research_notes_generated_at,
 *   research_notes_model
 */
export async function writeResearchNotes(
  taskId: string,
  notes: string,
  sourceFiles: string[],
  model: string
): Promise<void> {
  const db = createServiceClient()
  const patch = {
    research_notes: notes,
    research_notes_source_files: sourceFiles,
    research_notes_generated_at: new Date().toISOString(),
    research_notes_model: model,
  }

  // Read current metadata, merge patch fields, write back
  const { data: row, error: readErr } = await db
    .from('task_queue')
    .select('metadata')
    .eq('id', taskId)
    .maybeSingle()

  if (readErr) throw new Error(`writeResearchNotes read: ${readErr.message}`)

  const currentMeta = (row as { metadata: Record<string, unknown> } | null)?.metadata ?? {}
  const merged = { ...currentMeta, ...patch }

  const { error: writeErr } = await db
    .from('task_queue')
    .update({ metadata: merged })
    .eq('id', taskId)

  if (writeErr) throw new Error(`writeResearchNotes write: ${writeErr.message}`)
}

// ── runPreResearch ────────────────────────────────────────────────────────────

/**
 * Public entry point. Processes all queued tasks without research_notes.
 * Wraps every per-task operation in try/catch — never throws.
 *
 * Logs action='pre_research_complete' to agent_events on finish (F18).
 */
export async function runPreResearch(): Promise<PreResearchResult> {
  const result: PreResearchResult = {
    tasks_processed: 0,
    tasks_skipped: 0,
    tasks_no_hints: 0,
    tasks_ollama_error: 0,
    errors: [],
  }

  let tasks: QueuedTask[] = []
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('task_queue')
      .select('id, task, description, metadata')
      .eq('status', 'queued')

    if (error) {
      result.errors.push(`task_queue fetch: ${error.message}`)
      return result
    }
    tasks = (data ?? []) as QueuedTask[]
  } catch (err) {
    result.errors.push(`task_queue fetch: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  if (tasks.length === 0) {
    void logEvent('harness', 'pre_research_complete', {
      actor: 'daytime_watchman',
      status: 'success',
      meta: { ...result, tasks_total: 0 },
    })
    return result
  }

  for (const task of tasks) {
    try {
      // Idempotency: skip if research_notes already present
      const existingNotes = task.metadata?.research_notes
      if (typeof existingNotes === 'string' && existingNotes.length > 0) {
        result.tasks_skipped++
        continue
      }

      // Extract hints from task description
      const descForHints = [task.task, task.description ?? ''].join(' ')
      const hints = extractModuleHints(descForHints)
      if (hints.length === 0) {
        result.tasks_no_hints++
        continue
      }

      // Fetch source snippets from knowledge table
      const source = await fetchSourceSnippets(hints)
      if (!source) {
        result.tasks_no_hints++
        continue
      }

      // Summarize via Ollama
      const taskDesc = [task.task, task.description ?? ''].filter(Boolean).join(' — ')
      const summary = await summarizeSource(taskDesc, source)
      if (summary === null) {
        // Ollama unreachable — graceful skip
        result.tasks_ollama_error++
        continue
      }

      // Collect source file entity names for metadata
      const sourceFiles = [
        ...new Set(
          source
            .split('\n')
            .filter((l) => l.startsWith('# '))
            .map((l) => l.replace(/^# /, '').split(' — ')[0].trim())
            .filter(Boolean)
        ),
      ]

      // Write to task_queue — use the model name from the generate() result,
      // fall back to the ANALYSIS constant if empty
      const modelName = summary.model || OLLAMA_MODELS.ANALYSIS
      await writeResearchNotes(task.id, summary.text, sourceFiles, modelName)
      result.tasks_processed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`task ${task.id}: ${msg}`)
      if (err instanceof OllamaUnreachableError) {
        result.tasks_ollama_error++
      }
    }
  }

  // F18: log completion event
  void logEvent('harness', 'pre_research_complete', {
    actor: 'daytime_watchman',
    status: 'success',
    meta: {
      ...result,
      tasks_total: tasks.length,
    },
  })

  return result
}
