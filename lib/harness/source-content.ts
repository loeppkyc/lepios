/**
 * source-content.ts — helpers for reading Streamlit source from task metadata.
 *
 * Cloud coordinators cannot access the local filesystem. Source content is
 * pre-embedded in task_queue.metadata.source_content at task-generation time.
 * This module provides the extraction helper used by coordinator Phase 1a and
 * tested in tests/task-source-content.test.ts.
 */

export interface SourceContentMeta {
  source_content: string
  source_files: string[]
  source_captured_at: string
  source_line_count: number
}

/**
 * Extract pre-embedded Streamlit source from a task_queue metadata object.
 * Returns null if the field is absent — caller must fall back to filesystem
 * (local-dev only) or escalate if filesystem is also unavailable (cloud mode).
 */
export function extractSourceFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null
  const content = metadata['source_content']
  if (typeof content !== 'string' || content.length === 0) return null
  return content
}

/**
 * Returns a structured summary of the source content metadata fields for logging.
 * Safe to call when source_content is absent — returns null fields.
 */
export function describeSourceMeta(metadata: Record<string, unknown> | null | undefined): {
  present: boolean
  files: string[]
  line_count: number
  captured_at: string | null
} {
  if (!metadata) return { present: false, files: [], line_count: 0, captured_at: null }

  const content = metadata['source_content']
  const present = typeof content === 'string' && content.length > 0
  const files = Array.isArray(metadata['source_files'])
    ? (metadata['source_files'] as unknown[]).filter((f): f is string => typeof f === 'string')
    : []
  const line_count =
    typeof metadata['source_line_count'] === 'number' ? metadata['source_line_count'] : 0
  const captured_at =
    typeof metadata['source_captured_at'] === 'string' ? metadata['source_captured_at'] : null

  return { present, files, line_count, captured_at }
}
