/**
 * lib/failures/list.ts
 *
 * Server-side query helper for /failures cockpit page. Returns rows
 * sorted with open + recurring at top, then by severity DESC, then
 * by last_seen_at DESC.
 */

import { createServiceClient } from '@/lib/supabase/service'

export type FailureListRow = {
  id: string
  failure_number: string | null
  title: string
  trigger_context: string
  severity: string
  status: string
  occurrence_count: number
  last_seen_at: string
  fix_commit_sha: string | null
  lesson: string | null
  what_happened: string
  root_cause: string | null
  pattern_signature: Record<string, unknown>
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const STATUS_RANK: Record<string, number> = {
  // Open + recurring + fixing first
  recurring: 4,
  open: 3,
  fixing: 2,
  fixed: 1,
}

/**
 * Loads the failure rows for the cockpit page, sorted: open+recurring first,
 * then severity DESC, then last_seen_at DESC. Filters applied if provided.
 */
export async function listFailures(
  filters: {
    status?: string
    severity?: string
  } = {}
): Promise<FailureListRow[]> {
  const db = createServiceClient()

  let query = db
    .from('failures_log')
    .select(
      'id, failure_number, title, trigger_context, severity, status, occurrence_count, last_seen_at, fix_commit_sha, lesson, what_happened, root_cause, pattern_signature'
    )

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters.severity && filters.severity !== 'all') {
    query = query.eq('severity', filters.severity)
  }

  const { data } = await query.order('last_seen_at', { ascending: false }).limit(200)

  const rows = (data ?? []) as FailureListRow[]
  return rows.slice().sort((a, b) => {
    const statusDiff = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0)
    if (statusDiff !== 0) return statusDiff
    const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
    if (sevDiff !== 0) return sevDiff
    return b.last_seen_at.localeCompare(a.last_seen_at)
  })
}
