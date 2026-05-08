/**
 * lib/failures/export-markdown.ts
 *
 * Renders the failures_log table to docs/claude-md/failures.md.
 * Single source of truth: the table. The markdown is auto-generated.
 *
 * Invoked from night-tick (re-uses existing cron slot per F-N9 — no 19th
 * vercel.json entry). Idempotent — overwrites the file on every run.
 *
 * Format mirrors the existing hand-written F-N entries so CLAUDE.md
 * component #4 reads the same shape after the migration cuts over:
 *
 *   ## F-N{n} — {title} ({last_seen_at date})
 *   - **What:** {what_happened}
 *   - **Root cause:** {root_cause or "Pending analysis"}
 *   - **Fix/workaround:** {fix_commit_sha or "Open"}
 *   - **Lesson:** {lesson or "—"}
 *
 * Grouped by status: Open · Recurring · Fixed (last 30 days). Within each
 * group, sorted by severity DESC then last_seen_at DESC.
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

import { writeFile } from 'fs/promises'
import { join } from 'path'
import { createServiceClient } from '@/lib/supabase/service'

const MD_PATH = join(process.cwd(), 'docs', 'claude-md', 'failures.md')

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

type FailureRow = {
  failure_number: string | null
  title: string
  what_happened: string
  expected_behavior: string | null
  actual_behavior: string | null
  root_cause: string | null
  fix_commit_sha: string | null
  lesson: string | null
  severity: string
  status: string
  occurrence_count: number
  last_seen_at: string
}

function isoDate(iso: string): string {
  return iso.slice(0, 10)
}

function bySeverityThenRecency(a: FailureRow, b: FailureRow): number {
  const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
  if (sevDiff !== 0) return sevDiff
  return b.last_seen_at.localeCompare(a.last_seen_at)
}

function renderEntry(row: FailureRow): string {
  const number = row.failure_number ?? '(unnumbered)'
  const date = isoDate(row.last_seen_at)
  const lines: string[] = []
  lines.push(`## ${number} — ${row.title} (${date})`)
  lines.push('')
  lines.push(`- **What:** ${row.what_happened.trim()}`)
  if (row.expected_behavior) lines.push(`- **Expected:** ${row.expected_behavior.trim()}`)
  if (row.actual_behavior) lines.push(`- **Actual:** ${row.actual_behavior.trim()}`)
  lines.push(`- **Root cause:** ${row.root_cause?.trim() ?? '_Pending analysis_'}`)
  lines.push(`- **Fix/workaround:** ${row.fix_commit_sha?.trim() ?? '_Open_'}`)
  lines.push(`- **Lesson:** ${row.lesson?.trim() ?? '—'}`)
  if (row.occurrence_count > 1) {
    lines.push(`- **Occurrences:** ${row.occurrence_count}`)
  }
  lines.push(`- **Severity:** ${row.severity}`)
  return lines.join('\n')
}

function renderSection(title: string, rows: FailureRow[]): string {
  if (rows.length === 0) return ''
  const sorted = rows.slice().sort(bySeverityThenRecency)
  const body = sorted.map(renderEntry).join('\n\n---\n\n')
  return `## ${title} (${rows.length})\n\n${body}\n\n`
}

export type ExportResult = {
  ok: boolean
  open_count: number
  recurring_count: number
  fixed_count: number
  total_rendered: number
  markdown_bytes: number
  error?: string
}

/**
 * Build the markdown content as a string. Pure-ish (does not write to disk).
 * Useful for tests + dry-run mode.
 */
export async function buildMarkdown(): Promise<{
  content: string
  open: FailureRow[]
  recurring: FailureRow[]
  fixed: FailureRow[]
}> {
  const db = createServiceClient()

  const { data: openData } = await db
    .from('failures_log')
    .select(
      'failure_number, title, what_happened, expected_behavior, actual_behavior, root_cause, fix_commit_sha, lesson, severity, status, occurrence_count, last_seen_at'
    )
    .in('status', ['open', 'fixing'])
    .order('last_seen_at', { ascending: false })

  const { data: recurringData } = await db
    .from('failures_log')
    .select(
      'failure_number, title, what_happened, expected_behavior, actual_behavior, root_cause, fix_commit_sha, lesson, severity, status, occurrence_count, last_seen_at'
    )
    .eq('status', 'recurring')
    .order('last_seen_at', { ascending: false })

  // Fixed in last 30 days only — keep the file scannable.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: fixedData } = await db
    .from('failures_log')
    .select(
      'failure_number, title, what_happened, expected_behavior, actual_behavior, root_cause, fix_commit_sha, lesson, severity, status, occurrence_count, last_seen_at'
    )
    .eq('status', 'fixed')
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })

  const open = (openData ?? []) as FailureRow[]
  const recurring = (recurringData ?? []) as FailureRow[]
  const fixed = (fixedData ?? []) as FailureRow[]

  const header = [
    '# LepiOS — Failure Log',
    '',
    `**Auto-generated from \`failures_log\` table.** Last updated: ${new Date().toISOString()}.`,
    'Source of truth: \`failures_log\` table. Edit there (cockpit `/failures` form or via `POST /api/failures/log`).',
    '',
    'F-L1–F-L15 live in `CLAUDE.md §9` (canonical hand-written entries kept in prose).',
    'F-N entries below are auto-rendered from the table.',
    '',
    '---',
    '',
  ].join('\n')

  const body =
    renderSection('Open', open) +
    (open.length && (recurring.length || fixed.length) ? '---\n\n' : '') +
    renderSection('Recurring', recurring) +
    (recurring.length && fixed.length ? '---\n\n' : '') +
    renderSection('Fixed (last 30 days)', fixed)

  const content = header + body.trim() + '\n'
  return { content, open, recurring, fixed }
}

/**
 * Write the rendered markdown to docs/claude-md/failures.md.
 * Returns counts for observability + agent_events logging by the caller.
 */
export async function exportFailuresMarkdown(): Promise<ExportResult> {
  try {
    const { content, open, recurring, fixed } = await buildMarkdown()
    await writeFile(MD_PATH, content, 'utf-8')
    return {
      ok: true,
      open_count: open.length,
      recurring_count: recurring.length,
      fixed_count: fixed.length,
      total_rendered: open.length + recurring.length + fixed.length,
      markdown_bytes: Buffer.byteLength(content, 'utf-8'),
    }
  } catch (err) {
    return {
      ok: false,
      open_count: 0,
      recurring_count: 0,
      fixed_count: 0,
      total_rendered: 0,
      markdown_bytes: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
