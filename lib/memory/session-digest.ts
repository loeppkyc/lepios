/**
 * Session digest composer — Memory Layer chunk #5.
 *
 * Queries idea_inbox, decisions_log, agent_events, task_queue, harness rollup
 * and renders a compact markdown block for session context.
 *
 * Spec: docs/harness/MEMORY_LAYER_SPEC.md §M4
 *
 * Budget: 6000 bytes by default (~1500 tokens). Each section is capped so
 * the total stays under budget. Never throws — caller catches and degrades.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { computeHarnessRollup } from '@/lib/harness/rollup'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DigestIdea {
  id: string
  title: string
  score: number
  status: string
}

export interface DigestDecision {
  id: string
  topic: string
  chosen_path: string
  decided_at: string
}

export interface DigestEvent {
  action: string
  actor: string
  occurred_at: string
}

export interface DigestTask {
  id: string
  task: string
  priority: number
  status: string
}

export interface DigestSections {
  header: { date: string; branch: string }
  rollup: { harness_pct: number }
  top_ideas: DigestIdea[]
  recent_decisions: DigestDecision[]
  recent_events: DigestEvent[]
  open_tasks: DigestTask[]
}

export interface SessionDigest {
  markdown: string
  sections: DigestSections
  bytes: number
  build_ms: number
}

export interface BuildDigestOptions {
  topic?: string
  requested_by: string
  budget_bytes?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string): string {
  return iso.slice(0, 10)
}

function cap(items: string[], limit: number, moreLabel: string): string[] {
  const capped = items.slice(0, limit)
  if (items.length > limit) capped.push(`_…and ${items.length - limit} more — ${moreLabel}_`)
  return capped
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function fetchTopIdeas(db: ReturnType<typeof createServiceClient>): Promise<DigestIdea[]> {
  const { data } = await db
    .from('idea_inbox')
    .select('id, title, score, status')
    .eq('status', 'active')
    .order('score', { ascending: false })
    .limit(10)
  return (data ?? []) as DigestIdea[]
}

async function fetchRecentDecisions(
  db: ReturnType<typeof createServiceClient>,
): Promise<DigestDecision[]> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString()
  const { data } = await db
    .from('decisions_log')
    .select('id, topic, chosen_path, decided_at')
    .is('superseded_at', null)
    .gte('decided_at', since)
    .order('decided_at', { ascending: false })
    .limit(5)
  return (data ?? []) as DigestDecision[]
}

async function fetchRecentEvents(
  db: ReturnType<typeof createServiceClient>,
): Promise<DigestEvent[]> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data } = await db
    .from('agent_events')
    .select('action, actor, occurred_at')
    .gte('occurred_at', since)
    .not('action', 'like', 'chat_ui.tool.%')
    .order('occurred_at', { ascending: false })
    .limit(5)
  return (data ?? []) as DigestEvent[]
}

async function fetchOpenTasks(
  db: ReturnType<typeof createServiceClient>,
): Promise<DigestTask[]> {
  const { data } = await db
    .from('task_queue')
    .select('id, task, priority, status')
    .in('status', ['queued', 'claimed', 'running'])
    .lte('priority', 3)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(5)
  return (data ?? []) as DigestTask[]
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(sections: DigestSections, budget: number): string {
  const lines: string[] = []

  lines.push(`## Session Context — ${sections.header.date}`)
  lines.push(`**Harness:** ${sections.rollup.harness_pct}% | **Branch:** ${sections.header.branch}`)
  lines.push('')

  // Top ideas
  lines.push('### Active Ideas')
  if (sections.top_ideas.length === 0) {
    lines.push('_(no active ideas)_')
  } else {
    const ideaLines = sections.top_ideas.map(
      (i) => `- [${i.score.toFixed(2)}] ${i.title}`,
    )
    cap(ideaLines, 10, 'see idea_inbox').forEach((l) => lines.push(l))
  }
  lines.push('')

  // Recent decisions
  lines.push('### Recent Decisions (14d)')
  if (sections.recent_decisions.length === 0) {
    lines.push('_(none)_')
  } else {
    const decLines = sections.recent_decisions.map(
      (d) => `- **${d.topic}** (${fmt(d.decided_at)}): ${d.chosen_path}`,
    )
    cap(decLines, 5, 'see decisions_log').forEach((l) => lines.push(l))
  }
  lines.push('')

  // Recent events
  lines.push('### Recent Events (7d)')
  if (sections.recent_events.length === 0) {
    lines.push('_(none)_')
  } else {
    sections.recent_events.forEach((e) =>
      lines.push(`- \`${e.action}\` by ${e.actor} (${fmt(e.occurred_at)})`),
    )
  }
  lines.push('')

  // Open tasks
  lines.push('### Open Tasks')
  if (sections.open_tasks.length === 0) {
    lines.push('_(none)_')
  } else {
    const taskLines = sections.open_tasks.map(
      (t) => `- [P${t.priority}] ${t.task} (${t.status})`,
    )
    cap(taskLines, 5, 'see task_queue').forEach((l) => lines.push(l))
  }

  const md = lines.join('\n')
  // Trim to budget if over
  if (Buffer.byteLength(md, 'utf8') > budget) {
    return md.slice(0, budget) + '\n_(digest truncated to budget)_'
  }
  return md
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildSessionDigest(opts: BuildDigestOptions): Promise<SessionDigest> {
  const t0 = Date.now()
  const budget = opts.budget_bytes ?? 6000
  const db = createServiceClient()

  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ?? process.env.BRANCH ?? 'main'

  const [rollup, ideas, decisions, events, tasks] = await Promise.all([
    computeHarnessRollup(),
    fetchTopIdeas(db),
    fetchRecentDecisions(db),
    fetchRecentEvents(db),
    fetchOpenTasks(db),
  ])

  const sections: DigestSections = {
    header: { date: new Date().toISOString().slice(0, 10), branch },
    rollup: { harness_pct: rollup?.rollup_pct ?? 0 },
    top_ideas: ideas,
    recent_decisions: decisions,
    recent_events: events,
    open_tasks: tasks,
  }

  const markdown = renderMarkdown(sections, budget)
  const bytes = Buffer.byteLength(markdown, 'utf8')
  const build_ms = Date.now() - t0

  // Persist to session_digests (non-blocking — failure must not surface to caller)
  try {
    await db.from('session_digests').insert({
      branch,
      topic: opts.topic ?? null,
      requested_by: opts.requested_by,
      markdown,
      sections: sections as unknown as Record<string, unknown>,
      bytes,
      build_ms,
    })
  } catch {
    // non-fatal
  }

  return { markdown, sections, bytes, build_ms }
}
