/**
 * lib/harness/prestage/sources/from_failures.ts
 *
 * Reads failures from the F-N overflow file (docs/claude-md/failures.md) and
 * the legacy F-L block in lepios/CLAUDE.md. Emits one proposal per F-entry
 * that has a "Queue task:" follow-up sentence.
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4.3
 *
 * Confidence scoring:
 *   0.6 base
 *   + 0.2 if entry contains "Queue task:" (Colin-flagged)
 *   + 0.2 if entry text does not match any open task_queue.task substring
 * Risk scoring:
 *   30 base
 *   + 20 if entry mentions migration/RLS/deploy gate
 *   - 10 if entry is doc-only (mentions doc/spec but not code)
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ProposalDraft } from '../types'

const FAILURES_MD = join(process.cwd(), 'docs', 'claude-md', 'failures.md')
const CLAUDE_MD = join(process.cwd(), 'CLAUDE.md')

const F_NUMBER_RE = /^\*\*F-([NL]\d+)([:\s—-])/

type ParsedFailure = {
  number: string // 'F-N7' / 'F-L11'
  title: string
  body: string
  hasQueueTask: boolean
}

/**
 * Walk a markdown blob and pull out F-entries. Each entry starts with
 * `**F-N{n}` or `**F-L{n}` at the start of a paragraph and runs until the
 * next F-entry, ### heading, or end of file.
 */
export function parseFailures(markdown: string): ParsedFailure[] {
  const entries: ParsedFailure[] = []
  const lines = markdown.split(/\r?\n/)
  let current: ParsedFailure | null = null

  for (const line of lines) {
    const m = F_NUMBER_RE.exec(line)
    if (m) {
      if (current) entries.push(current)
      const titleAfterNumber = line.replace(/^\*\*F-[NL]\d+[:\s—-]+/, '').replace(/\*\*\s*$/, '')
      current = {
        number: `F-${m[1]}`,
        title: titleAfterNumber.trim(),
        body: '',
        hasQueueTask: false,
      }
      continue
    }
    if (current) {
      // Stop on any ### heading or new top-level F-section header
      if (/^###\s+/.test(line) || /^---\s*$/.test(line)) {
        entries.push(current)
        current = null
        continue
      }
      current.body += line + '\n'
      if (/queue\s+task:/i.test(line)) {
        current.hasQueueTask = true
      }
    }
  }
  if (current) entries.push(current)
  return entries
}

function risksFor(body: string): number {
  let score = 30
  if (/migration|rls|deploy\s*gate|schema/i.test(body)) score += 20
  const docOnly =
    /\b(doc|spec|readme|markdown)\b/i.test(body) && !/\b(code|function|route|api)\b/i.test(body)
  if (docOnly) score -= 10
  return Math.max(0, Math.min(100, score))
}

function confidenceFor(failure: ParsedFailure, openTasks: ReadonlySet<string>): number {
  let conf = 0.6
  if (failure.hasQueueTask) conf += 0.2
  const lowerTitle = failure.title.toLowerCase()
  const matchesOpen = [...openTasks].some(
    (t) =>
      t.toLowerCase().includes(lowerTitle.slice(0, 32)) ||
      lowerTitle.includes(t.toLowerCase().slice(0, 32))
  )
  if (!matchesOpen) conf += 0.2
  return Math.max(0, Math.min(1, conf))
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

export type FromFailuresOptions = {
  openTaskTexts: string[]
}

/**
 * Build proposals from failure logs. Caller passes the set of currently
 * pending/claimed/running task texts so we can dedupe softly (the unique
 * index on (source, source_ref) is the hard dedup; this prevents stale-but-
 * still-active failures from repeatedly re-staging with new IDs).
 */
export async function fromFailures(opts: FromFailuresOptions): Promise<ProposalDraft[]> {
  const [failuresMd, claudeMd] = await Promise.all([
    readIfExists(FAILURES_MD),
    readIfExists(CLAUDE_MD),
  ])
  const all = [...parseFailures(failuresMd), ...parseFailures(claudeMd)]
  const openTasks = new Set(opts.openTaskTexts.map((t) => t.toLowerCase()))

  const proposals: ProposalDraft[] = []
  const seenRefs = new Set<string>()
  for (const f of all) {
    if (seenRefs.has(f.number)) continue
    seenRefs.add(f.number)
    proposals.push({
      task: `Resolve ${f.number} — ${f.title}`.slice(0, 200),
      description: f.body.trim().slice(0, 4000),
      source_ref: f.number,
      confidence: confidenceFor(f, openTasks),
      risk_score: risksFor(f.body),
      metadata: { failure_number: f.number, has_queue_task: f.hasQueueTask },
    })
  }
  return proposals
}
