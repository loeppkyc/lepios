/**
 * lib/failures/export-markdown.ts
 *
 * Renders the failures_log table to docs/claude-md/failures.md.
 * Single source of truth: the table. The markdown is auto-generated.
 *
 * Invoked from night-tick (re-uses existing cron slot per F-N9 — no 19th
 * vercel.json entry).
 *
 * F-N14 fix: writeFile() to /var/task on Vercel fails (EROFS, read-only
 * filesystem). The export now commits via GitHub Contents API directly to
 * main, mirroring the F22-bearer-auth pattern from self-repair/pr-opener.
 *
 * Format mirrors the existing hand-written F-N entries so CLAUDE.md
 * component #4 reads the same shape:
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

import { createServiceClient } from '@/lib/supabase/service'

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? 'loeppkyc'
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? 'lepios'
const MD_REPO_PATH = 'docs/claude-md/failures.md'
const COMMIT_MESSAGE = 'chore(failures-log): auto-export failures.md from failures_log table'

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
  updated_at: string
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
  /** True when content was unchanged since last commit and no GitHub call was made. */
  skipped?: boolean
  /** Commit sha, when a new commit landed. */
  commit_sha?: string
  error?: string
}

/**
 * Build the markdown content as a string. Pure-ish (does not write or commit).
 *
 * F-N14 deterministic-timestamp note: the "Last updated" line uses the max
 * `updated_at` across rendered rows, not Date.now(). This keeps the rendered
 * content stable across runs when no rows changed, which is what makes the
 * skip-if-unchanged idempotency check actually skip.
 */
export async function buildMarkdown(): Promise<{
  content: string
  open: FailureRow[]
  recurring: FailureRow[]
  fixed: FailureRow[]
  lastDataChangeAt: string
}> {
  const db = createServiceClient()
  const SELECT =
    'failure_number, title, what_happened, expected_behavior, actual_behavior, root_cause, fix_commit_sha, lesson, severity, status, occurrence_count, last_seen_at, updated_at'

  const { data: openData } = await db
    .from('failures_log')
    .select(SELECT)
    .in('status', ['open', 'fixing'])
    .order('last_seen_at', { ascending: false })

  const { data: recurringData } = await db
    .from('failures_log')
    .select(SELECT)
    .eq('status', 'recurring')
    .order('last_seen_at', { ascending: false })

  // Fixed in last 30 days only — keep the file scannable.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: fixedData } = await db
    .from('failures_log')
    .select(SELECT)
    .eq('status', 'fixed')
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })

  const open = (openData ?? []) as FailureRow[]
  const recurring = (recurringData ?? []) as FailureRow[]
  const fixed = (fixedData ?? []) as FailureRow[]

  // Deterministic timestamp: latest data change across rendered rows. If the
  // table hasn't changed since last run, this matches last run's value, the
  // rendered markdown is byte-identical, and the GitHub commit is skipped.
  const allRows = [...open, ...recurring, ...fixed]
  const lastDataChangeAt =
    allRows.length === 0
      ? 'never'
      : allRows.map((r) => r.updated_at).reduce((a, b) => (a > b ? a : b))

  const header = [
    '# LepiOS — Failure Log',
    '',
    `**Auto-generated from \`failures_log\` table.** Last data change: ${lastDataChangeAt}.`,
    'Source of truth: `failures_log` table. Edit there (cockpit `/failures` form or via `POST /api/failures/log`).',
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
  return { content, open, recurring, fixed, lastDataChangeAt }
}

// ── GitHub Contents API helpers ────────────────────────────────────────────

type ContentsGetResult =
  | { exists: true; sha: string; contentBase64: string }
  | { exists: false }
  | { error: string }

/**
 * GET /repos/:owner/:repo/contents/:path — fetch current file sha + content.
 * Returns { exists: false } on 404, { error } on other failures.
 *
 * Lets the caller compare incoming content against the existing file so the
 * commit is skipped when nothing changed (idempotent night-tick).
 */
export async function fetchExistingFile(
  fetchImpl: typeof fetch = fetch,
  token: string = process.env.GITHUB_TOKEN ?? ''
): Promise<ContentsGetResult> {
  if (!token) return { error: 'GITHUB_TOKEN not set' }
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${MD_REPO_PATH}?ref=main`
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  if (res.status === 404) return { exists: false }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { error: `GET contents failed (${res.status}): ${text.slice(0, 200)}` }
  }
  let body: { sha?: string; content?: string }
  try {
    body = (await res.json()) as { sha?: string; content?: string }
  } catch (err) {
    return { error: `parse contents response: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!body.sha || !body.content) return { error: 'contents response missing sha or content' }
  // GitHub returns content base64-encoded with newlines every 60 chars.
  const contentBase64 = body.content.replace(/\n/g, '')
  return { exists: true, sha: body.sha, contentBase64 }
}

type CommitResult = { ok: true; sha: string } | { ok: false; error: string }

/**
 * PUT /repos/:owner/:repo/contents/:path — create or update the file.
 * Single commit, lands directly on main.
 */
export async function commitFile(
  contentBase64: string,
  existingSha: string | undefined,
  fetchImpl: typeof fetch = fetch,
  token: string = process.env.GITHUB_TOKEN ?? ''
): Promise<CommitResult> {
  if (!token) return { ok: false, error: 'GITHUB_TOKEN not set' }
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${MD_REPO_PATH}`
  const body: Record<string, unknown> = {
    message: COMMIT_MESSAGE,
    content: contentBase64,
    branch: 'main',
  }
  if (existingSha) body.sha = existingSha

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `PUT contents failed (${res.status}): ${text.slice(0, 200)}` }
  }
  let parsed: { commit?: { sha?: string } }
  try {
    parsed = (await res.json()) as { commit?: { sha?: string } }
  } catch (err) {
    return {
      ok: false,
      error: `parse PUT response: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!parsed.commit?.sha) {
    return { ok: false, error: 'PUT response missing commit.sha' }
  }
  return { ok: true, sha: parsed.commit.sha }
}

function toBase64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
}

/**
 * Build the markdown, compare to the file currently on main, and commit a
 * new version via the GitHub Contents API only if content changed.
 *
 * F-N14 fix: replaces the previous writeFile() approach which failed with
 * EROFS in Vercel cron context. Mirrors the F22-bearer-auth pattern from
 * lib/harness/self-repair/pr-opener.ts.
 */
export async function exportFailuresMarkdown(
  options: {
    fetchImpl?: typeof fetch
    token?: string
  } = {}
): Promise<ExportResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const token = options.token ?? process.env.GITHUB_TOKEN ?? ''

  try {
    const { content, open, recurring, fixed } = await buildMarkdown()
    const counts = {
      open_count: open.length,
      recurring_count: recurring.length,
      fixed_count: fixed.length,
      total_rendered: open.length + recurring.length + fixed.length,
      markdown_bytes: Buffer.byteLength(content, 'utf-8'),
    }

    if (!token) {
      return { ok: false, ...counts, error: 'GITHUB_TOKEN not set' }
    }

    const existing = await fetchExistingFile(fetchImpl, token)
    if ('error' in existing) {
      return { ok: false, ...counts, error: existing.error }
    }

    const newBase64 = toBase64(content)

    if (existing.exists && existing.contentBase64 === newBase64) {
      // Idempotent: content unchanged, no commit needed.
      return { ok: true, ...counts, skipped: true }
    }

    const commit = await commitFile(
      newBase64,
      existing.exists ? existing.sha : undefined,
      fetchImpl,
      token
    )
    if (!commit.ok) {
      return { ok: false, ...counts, error: commit.error }
    }

    return { ok: true, ...counts, commit_sha: commit.sha }
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
