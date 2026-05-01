/**
 * LepiOS Pattern Learner — port of Streamlit utils/knowledge.py nightly analyzers.
 *
 * Runs 6 analyzers on the last 24h of agent_events and extracts reusable knowledge.
 * Called nightly via POST /api/knowledge/nightly (Telegram bot scheduled task or cron).
 *
 * Analyzers (ported 1:1 from Python):
 *   1. Error-fix pairs      — failure → success on same domain+action = learned fix
 *   2. Repeated errors      — same error_type 3+ times = escalation flag
 *   3. Successful workflows — 3+ step success chains in one session
 *   4. Coach quality        — low-confidence AI answers flag knowledge gaps
 *   5. Failed approaches    — unresolved failures archived for retrospective
 *   6. Translation accuracy — accept/reject patterns for translator tuning
 */

import { createServiceClient } from '@/lib/supabase/service'
import { findKnowledge, markUsed, saveKnowledge } from './client'
import type { AgentEventRow, NightlyLearnResult } from './types'

// ── Event loader ─────────────────────────────────────────────────────────────

async function getEventsSince(hours: number = 24): Promise<AgentEventRow[]> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  const { data } = await supabase
    .from('agent_events')
    .select('*')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: true })
  return (data ?? []) as AgentEventRow[]
}

// ── Analyzer 1: Error-fix pairs ───────────────────────────────────────────────
// A failure followed by a success on the same domain+action+entity = learned fix.

type KnowledgeCandidate = Parameters<typeof saveKnowledge>[3] & {
  category: Parameters<typeof saveKnowledge>[0]
  domain: string
  title: string
}

function analyzeErrorFixPairs(events: AgentEventRow[]): KnowledgeCandidate[] {
  const results: KnowledgeCandidate[] = []
  const failures = events.filter((e) => e.status === 'failure' || e.status === 'error')
  const successes = events.filter((e) => e.status === 'success')

  for (const fail of failures) {
    const key = `${fail.domain}::${fail.action}::${fail.entity ?? ''}`
    const fix = successes.find(
      (s) =>
        `${s.domain}::${s.action}::${s.entity ?? ''}` === key && s.occurred_at > fail.occurred_at
    )
    if (fix) {
      results.push({
        category: 'error_fix',
        domain: fail.domain,
        title: `Fix for ${fail.error_type ?? 'error'} in ${fail.action}`,
        problem: (fail.error_message ?? '').slice(0, 300),
        solution: `Retried and succeeded. Output: ${(fix.output_summary ?? '').slice(0, 200)}`,
        sourceEvents: [fail.id, fix.id],
        confidence: 0.6,
      })
    }
  }
  return results
}

// ── Analyzer 2: Repeated errors ───────────────────────────────────────────────
// Same error_type appearing 3+ times signals a systemic issue.

function analyzeRepeatedErrors(events: AgentEventRow[]): KnowledgeCandidate[] {
  const counts = new Map<string, { count: number; example: AgentEventRow }>()

  for (const e of events) {
    if ((e.status === 'failure' || e.status === 'error') && e.error_type) {
      const key = `${e.domain}::${e.error_type}`
      const existing = counts.get(key)
      if (existing) {
        existing.count++
      } else {
        counts.set(key, { count: 1, example: e })
      }
    }
  }

  return Array.from(counts.entries())
    .filter(([, { count }]) => count >= 3)
    .map(([, { count, example }]) => ({
      category: 'pattern' as const,
      domain: example.domain,
      title: `Recurring ${example.error_type} in ${example.domain} (${count}x today)`,
      problem: `${example.error_type} occurred ${count} times: ${(example.error_message ?? '').slice(0, 200)}`,
      solution: undefined,
      context: `Action: ${example.action}. Needs investigation.`,
      confidence: Math.min(0.5 + count * 0.1, 0.9),
    }))
}

// ── Analyzer 3: Successful workflows ─────────────────────────────────────────
// 3+ consecutive successes in the same session = recordable workflow pattern.

function analyzeSuccessfulWorkflows(events: AgentEventRow[]): KnowledgeCandidate[] {
  const sessions = new Map<string, AgentEventRow[]>()

  for (const e of events) {
    if (e.session_id && e.status === 'success') {
      const existing = sessions.get(e.session_id) ?? []
      existing.push(e)
      sessions.set(e.session_id, existing)
    }
  }

  return Array.from(sessions.values())
    .filter((chain) => chain.length >= 3)
    .map((chain) => {
      const steps = chain
        .map((e) => `${e.action} (${(e.output_summary ?? '').slice(0, 50)})`)
        .join(' → ')
      return {
        category: 'workflow' as const,
        domain: chain[0].domain,
        title: `Successful ${chain[0].domain} workflow (${chain.length} steps)`,
        problem: undefined,
        solution: steps,
        sourceEvents: chain.map((e) => e.id),
        confidence: 0.6,
      }
    })
}

// ── Analyzer 4: Coach quality ─────────────────────────────────────────────────
// Low-confidence AI answers flag topics needing more data or better routing.

function analyzeCoachQuality(events: AgentEventRow[]): KnowledgeCandidate[] {
  const coachEvents = events.filter((e) => e.domain === 'ai' && e.action === 'coach.ask')
  const poor = coachEvents.filter((e) => e.confidence != null && e.confidence < 0.3)

  if (poor.length < 2) return []

  const topics = poor.slice(0, 3).map((e) => (e.input_summary ?? '').slice(0, 60))
  return [
    {
      category: 'tip',
      domain: 'ai',
      title: `Coach struggled with ${poor.length} questions today`,
      problem: `Low-confidence answers on: ${topics.join('; ')}`,
      solution: 'These topics may need more data or better routing to Claude',
      confidence: 0.5,
    },
  ]
}

// ── Analyzer 5: Failed approaches ─────────────────────────────────────────────
// Failures with no subsequent success = unresolved, archive for retrospective.
//
// Aggregates by (domain::action::entity) key — one candidate per unique failure
// pattern, not one per event. Without this, a recurring failure (e.g. Ollama
// unreachable across 31 nights) emits 31 byte-identical candidates that collapse
// into 31 duplicate knowledge rows. The most-recent failure provides the
// problem text; all event IDs are collected into sourceEvents.

export function analyzeFailedApproaches(events: AgentEventRow[]): KnowledgeCandidate[] {
  const successKeys = new Set(
    events
      .filter((e) => e.status === 'success')
      .map((e) => `${e.domain}::${e.action}::${e.entity ?? ''}`)
  )

  // Group unresolved failures by (domain::action::entity).
  const groups = new Map<string, { events: AgentEventRow[] }>()
  for (const e of events) {
    if (e.status !== 'failure' && e.status !== 'error') continue
    const key = `${e.domain}::${e.action}::${e.entity ?? ''}`
    if (successKeys.has(key)) continue
    const existing = groups.get(key)
    if (existing) {
      existing.events.push(e)
    } else {
      groups.set(key, { events: [e] })
    }
  }

  return Array.from(groups.values()).map(({ events: group }) => {
    // Most-recent failure drives the problem text; events are already ordered
    // ascending by occurred_at (getEventsSince sort), so last = most recent.
    const latest = group[group.length - 1]
    return {
      category: 'failed_approach' as const,
      domain: latest.domain,
      title: `Unresolved: ${latest.action} failed`,
      problem: (latest.error_message ?? latest.input_summary ?? '').slice(0, 300),
      solution: undefined,
      context: 'This failure was not resolved in this session',
      sourceEvents: group.map((e) => e.id),
      confidence: 0.3,
    }
  })
}

// ── Analyzer 6: Translation accuracy ─────────────────────────────────────────
// Accept/reject patterns teach which inputs need better keyword coverage.

function analyzeTranslationAccuracy(events: AgentEventRow[]): KnowledgeCandidate[] {
  const transEvents = events.filter((e) => e.domain === 'translator' && e.action === 'translate')
  if (!transEvents.length) return []

  const accepted = transEvents.filter(
    (e) => e.status === 'success' || e.status === ('accepted' as string)
  )
  const rejected = transEvents.filter(
    (e) => e.status === 'failure' || e.status === ('rejected' as string)
  )
  const total = transEvents.length
  const rate = accepted.length / total

  const results: KnowledgeCandidate[] = []

  if (rejected.length > 0) {
    const topics = rejected.slice(0, 3).map((e) => (e.input_summary ?? '').slice(0, 60))
    results.push({
      category: 'translation_pattern',
      domain: 'translator',
      title: `Translator rejected ${rejected.length}/${total} today (${Math.round(rate * 100)}% acceptance)`,
      problem: `Rejected inputs: ${topics.join('; ')}`,
      solution: 'Review rejected inputs — may need better keyword patterns or Claude escalation',
      confidence: 0.5,
    })
  }

  const editedCount = accepted.filter((e) => {
    try {
      const meta = (e.meta ?? {}) as Record<string, unknown>
      return meta['edited'] === true
    } catch {
      return false
    }
  }).length

  if (editedCount >= 2) {
    results.push({
      category: 'translation_pattern',
      domain: 'translator',
      title: `Translator needed ${editedCount} edits today — confidence calibration off`,
      problem: 'Accepted but required manual editing before execution',
      solution: 'Lower confidence threshold or improve domain keyword coverage',
      confidence: 0.4,
    })
  }

  return results
}

// ── Consolidator ─────────────────────────────────────────────────────────────
// Merge similar knowledge entries to prevent bloat.
// Groups by domain+category; merges pairs sharing 3+ title words.

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.toLowerCase())
  )
}

async function consolidateKnowledge(): Promise<{ merged: number }> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('knowledge')
      .select('id, domain, category, title, solution, times_used, times_helpful, confidence')
      .order('domain')
      .order('category')
      .order('confidence', { ascending: false })

    if (!data || data.length < 2) return { merged: 0 }

    const groups = new Map<string, typeof data>()
    for (const e of data) {
      const key = `${e.domain}::${e.category}`
      const existing = groups.get(key) ?? []
      existing.push(e)
      groups.set(key, existing)
    }

    const toDelete: string[] = []
    let merged = 0

    for (const group of groups.values()) {
      if (group.length < 2) continue
      const used = new Set<string>()

      for (let i = 0; i < group.length; i++) {
        const a = group[i]
        if (used.has(a.id)) continue
        const aWords = titleWords(a.title)

        for (let j = i + 1; j < group.length; j++) {
          const b = group[j]
          if (used.has(b.id)) continue
          // Don't merge two high-confidence entries
          if (a.confidence > 0.7 && b.confidence > 0.7) continue

          const shared = [...titleWords(b.title)].filter((w) => aWords.has(w))
          if (shared.length < 3) continue

          // Merge b into a (a has higher confidence — sorted DESC)
          const mergedSolution =
            [a.solution, b.solution].filter(Boolean).join('\n---\n').trim() || null

          await supabase
            .from('knowledge')
            .update({
              solution: mergedSolution,
              times_used: (a.times_used ?? 0) + (b.times_used ?? 0),
              times_helpful: (a.times_helpful ?? 0) + (b.times_helpful ?? 0),
              updated_at: new Date().toISOString(),
            })
            .eq('id', a.id)

          toDelete.push(b.id)
          used.add(b.id)
          merged++
        }
      }
    }

    if (toDelete.length) {
      await supabase.from('knowledge').delete().in('id', toDelete)
    }

    return { merged }
  } catch {
    return { merged: 0 }
  }
}

// ── Nightly metrics saver ────────────────────────────────────────────────────

async function saveDailyMetrics(events: AgentEventRow[]): Promise<void> {
  try {
    const supabase = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)

    const metrics: Array<{ date: string; domain: string; metric: string; value: number }> = []

    // Global counts
    const errCount = events.filter((e) => e.status === 'failure' || e.status === 'error').length
    metrics.push({ date: today, domain: 'all', metric: 'events_total', value: events.length })
    metrics.push({ date: today, domain: 'all', metric: 'errors_total', value: errCount })

    // Per-domain counts
    const domainCounts = new Map<string, { total: number; errors: number }>()
    for (const e of events) {
      const d = domainCounts.get(e.domain) ?? { total: 0, errors: 0 }
      d.total++
      if (e.status === 'failure' || e.status === 'error') d.errors++
      domainCounts.set(e.domain, d)
    }
    for (const [domain, { total, errors }] of domainCounts.entries()) {
      metrics.push({ date: today, domain, metric: 'events_total', value: total })
      metrics.push({ date: today, domain, metric: 'errors_total', value: errors })
    }

    // Coach quality
    const coachEvents = events.filter((e) => e.domain === 'ai' && e.action === 'coach.ask')
    if (coachEvents.length > 0) {
      const good = coachEvents.filter((e) => (e.confidence ?? 0) >= 0.5).length
      metrics.push({
        date: today,
        domain: 'ai',
        metric: 'coach_quality_good_pct',
        value: Math.round((good / coachEvents.length) * 1000) / 10,
      })
    }

    // Knowledge base health
    const { data: kb } = await supabase.from('knowledge').select('confidence')
    if (kb) {
      const avgConf = kb.reduce((s, r) => s + r.confidence, 0) / (kb.length || 1)
      const stale = kb.filter((r) => r.confidence < 0.2).length
      metrics.push({ date: today, domain: 'all', metric: 'knowledge_total', value: kb.length })
      metrics.push({
        date: today,
        domain: 'all',
        metric: 'knowledge_avg_confidence',
        value: Math.round(avgConf * 1000) / 1000,
      })
      metrics.push({ date: today, domain: 'all', metric: 'knowledge_stale_count', value: stale })
    }

    // Upsert all metrics
    if (metrics.length) {
      await supabase.from('daily_metrics').upsert(metrics, { onConflict: 'date,domain,metric' })
    }
  } catch {
    // Non-critical
  }
}

// ── Stale knowledge decay ────────────────────────────────────────────────────

async function decayStaleKnowledge(days: number = 30): Promise<void> {
  try {
    const supabase = createServiceClient()
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    // Use rpc for atomic update — same pattern as knowledge_mark_used
    await supabase.rpc('knowledge_decay_stale', { p_cutoff: cutoff })
  } catch {
    // Non-critical; decay will run again tomorrow
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all 6 analyzers on the last 24h of events. Deduplicates against existing
 * knowledge before saving. Runs consolidation + decay + daily metrics save.
 *
 * Call via POST /api/knowledge/nightly (Telegram bot at 11PM, or Vercel cron).
 */
export async function nightlyLearn(hours: number = 24): Promise<NightlyLearnResult> {
  const events = await getEventsSince(hours)
  if (!events.length) {
    return { eventsAnalyzed: 0, knowledgeCreated: 0, consolidated: 0 }
  }

  const candidates: KnowledgeCandidate[] = [
    ...analyzeErrorFixPairs(events),
    ...analyzeRepeatedErrors(events),
    ...analyzeSuccessfulWorkflows(events),
    ...analyzeCoachQuality(events),
    ...analyzeFailedApproaches(events),
    ...analyzeTranslationAccuracy(events),
  ]

  let created = 0
  for (const k of candidates) {
    const { category, domain, title, ...opts } = k
    // Deduplicate: if similar knowledge exists with confidence > 0.3, just reinforce it
    const existing = await findKnowledge(title, { category, limit: 1 })
    // 2026-04-28 halt patch — initially the only line of defense.
    // Now belt-and-suspenders alongside the unique index on
    // (content_hash, entity). See migration 0049.
    if (existing.length && existing[0].confidence >= 0.3) {
      await markUsed(existing[0].id, true)
    } else {
      const id = await saveKnowledge(category, domain, title, opts)
      if (id) created++
    }
  }

  const { merged } = await consolidateKnowledge()
  await decayStaleKnowledge()
  await saveDailyMetrics(events)

  return { eventsAnalyzed: events.length, knowledgeCreated: created, consolidated: merged }
}
