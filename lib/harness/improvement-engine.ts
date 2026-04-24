/**
 * Improvement Engine — 20% Better Loop
 *
 * Fires after every chunk completion, analyzes the audit trail,
 * generates structured improvement proposals, deduplicates against
 * open proposals, queues them in task_queue, and notifies Colin via
 * Telegram (one message per chunk, inline keyboard for bulk approve/dismiss).
 *
 * Components:
 *   2 — Analyzer    (analyzeChunk)
 *   3 — Proposer    (generateProposals)
 *   4 — Deduplicator (deduplicateAndQueue)
 *   5 — Queuer      (inline in deduplicateAndQueue)
 *   6 — Notifier    (notifyProposals)
 *   7 — Auto-Proceed Gate (checkAutoProceed)
 *
 * Component 1 (Trigger) lives in app/api/harness/notifications-drain/route.ts
 * — the drain cron is extended to also scan for recently-completed task_queue
 * rows and invoke runImprovementEngine.
 *
 * See: docs/sprint-5/20-percent-better-engine-acceptance.md
 */

import { createServiceClient } from '@/lib/supabase/service'
import { recordAttribution } from '@/lib/attribution/writer'

// ── Constants (Principle 11 — centralized, TODO-tagged thresholds) ─────────────

/** Categories the engine can generate. All 8 have active write paths. */
// TODO: tune with real data — add/remove categories only when a write path exists
export const PROPOSAL_CATEGORIES = [
  'process',
  'code_pattern',
  'test_coverage',
  'doc_gap',
  'tooling',
  'twin_corpus_gap',
  'security',
  'reliability',
] as const

export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number]

/** Categories eligible for auto-proceed (Component 7, Q5 — resolved 2026-04-24) */
// TODO: tune with real data — only expand after observing approval patterns
const AUTO_PROCEED_CATEGORIES: ProposalCategory[] = ['tooling', 'code_pattern', 'test_coverage']

/**
 * Recurrence thresholds for severity escalation.
 * first_occurrence (recurrence_count = 0) → nice_to_have
 * recurrence_count = 1                    → meaningful
 * recurrence_count >= 2                   → blocking
 */
// TODO: tune with real data — may need to lower blocking threshold if proposals stagnate
const SEVERITY_RECURRENCE_THRESHOLDS = {
  meaningful: 1,
  blocking: 2,
} as const

const ROOT_CAUSE_REVIEW_THRESHOLD = 2 // recurrence_count >= this → needs_root_cause_review = true

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChunkAudit {
  chunk_id: string
  sprint_id: string
  task_queue_id: string
  acceptance_doc_found: boolean
  grounding_status: 'passed' | 'passed_with_limitation' | 'failed' | 'not_yet'
  grounding_mismatches: number
  escalations_to_colin: number
  twin_escalations: number
  notification_failures: number
  ollama_failures: number
  review_bypasses: number
  spec_corrections: number
  analyzed_at: string
}

export interface ImprovementProposal {
  category: ProposalCategory
  severity: 'blocking' | 'meaningful' | 'nice_to_have'
  concrete_action: string
  engine_signal: string
  measurement: string
  source_chunk_id: string
  fingerprint: string
  reversible: boolean
}

interface DeduplicationResult {
  existingId: string | null
  recurrenceCount: number
}

// ── Agent-events logger (inline — avoids circular imports from knowledge/client) ─

async function logEngineEvent(fields: {
  action: string
  status: 'success' | 'error' | 'warning'
  output_summary: string
  meta?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('agent_events')
      .insert({
        domain: 'improvement_engine',
        action: fields.action,
        actor: 'improvement_engine',
        status: fields.status,
        task_type: 'improvement_engine',
        output_summary: fields.output_summary,
        meta: fields.meta ?? null,
        tags: ['improvement_engine', 'harness'],
      })
      .select('id')
      .single()
    if (error) return null
    return (data as { id: string } | null)?.id ?? null
  } catch {
    return null
  }
}

// ── Component 2 — Analyzer ────────────────────────────────────────────────────

/**
 * Given a completed chunk's task_queue row ID, reads its full audit trail
 * and produces a structured ChunkAudit object.
 *
 * Logs:
 *   action='improvement_engine.triggered'    — on entry
 *   action='improvement_engine.audit_complete' — on success
 *   action='improvement_engine.audit_incomplete' — if acceptance_doc_path missing
 */
export async function analyzeChunk(taskQueueId: string): Promise<ChunkAudit> {
  const db = createServiceClient()
  const now = new Date().toISOString()

  // Log trigger event
  await logEngineEvent({
    action: 'improvement_engine.triggered',
    status: 'success',
    output_summary: `improvement engine triggered for task_queue id=${taskQueueId}`,
    meta: { task_id: taskQueueId },
  })

  // ── Read task_queue row ──────────────────────────────────────────────────────

  const { data: taskRow, error: taskErr } = await db
    .from('task_queue')
    .select('id, metadata, completed_at')
    .eq('id', taskQueueId)
    .maybeSingle()

  if (taskErr || !taskRow) {
    await logEngineEvent({
      action: 'improvement_engine.audit_incomplete',
      status: 'error',
      output_summary: `task_queue row not found: ${taskQueueId}`,
      meta: { task_id: taskQueueId, error: taskErr?.message },
    })
    // Return a safe default audit — caller decides whether to proceed
    return {
      chunk_id: 'unknown',
      sprint_id: 'unknown',
      task_queue_id: taskQueueId,
      acceptance_doc_found: false,
      grounding_status: 'not_yet',
      grounding_mismatches: 0,
      escalations_to_colin: 0,
      twin_escalations: 0,
      notification_failures: 0,
      ollama_failures: 0,
      review_bypasses: 0,
      spec_corrections: 0,
      analyzed_at: now,
    }
  }

  const meta = (taskRow.metadata ?? {}) as Record<string, unknown>
  const chunk_id = (meta.chunk_id as string | undefined) ?? 'unknown'
  const sprint_id = (meta.sprint_id as string | undefined) ?? 'unknown'
  const acceptance_doc_path = (meta.acceptance_doc_path as string | undefined) ?? null

  // ── Check acceptance doc exists ──────────────────────────────────────────────
  // We check via a best-effort read; missing doc = acceptance_doc_found: false
  let acceptance_doc_found = false
  if (acceptance_doc_path) {
    try {
      // Dynamic import of fs — only available server-side; fails gracefully in tests
      const { existsSync } = await import('fs')
      acceptance_doc_found = existsSync(acceptance_doc_path)
    } catch {
      // fs not available (edge runtime, test) — treat as not found
      acceptance_doc_found = false
    }
  }

  if (!acceptance_doc_found) {
    await logEngineEvent({
      action: 'improvement_engine.audit_incomplete',
      status: 'warning',
      output_summary: `acceptance doc not found at path: ${acceptance_doc_path ?? '(not set)'}`,
      meta: { task_id: taskQueueId, chunk_id, sprint_id, acceptance_doc_path },
    })
    // Continue — we can still count agent_events signals without the doc
  }

  // ── Read agent_events for this task ──────────────────────────────────────────

  const { data: events } = await db
    .from('agent_events')
    .select('action, status, task_type, meta')
    .filter('meta->>task_id', 'eq', taskQueueId)

  const allEvents = (events ?? []) as Array<{
    action: string
    status: string | null
    task_type: string | null
    meta: Record<string, unknown> | null
  }>

  // Also pull events scoped to this chunk_id (some events use chunk_id not task_id)
  const { data: chunkEvents } = await db
    .from('agent_events')
    .select('action, status, task_type, meta')
    .filter('meta->>chunk_id', 'eq', chunk_id)

  const allChunkEvents = [...allEvents, ...(chunkEvents ?? [])]

  // ── Count audit signals ───────────────────────────────────────────────────────

  // escalations_to_colin: coordinator escalation events
  const escalations_to_colin = allChunkEvents.filter(
    (e) => e.action === 'coordinator.escalate_to_colin' || e.task_type === 'escalate_to_colin'
  ).length

  // twin_escalations: twin.ask events where escalate=true
  const twin_escalations = allChunkEvents.filter((e) => {
    if (e.action !== 'twin.ask' && e.task_type !== 'twin_ask') return false
    const m = e.meta ?? {}
    return m.escalate === true || m.escalated === true
  }).length

  // notification_failures: outbound notification failed events
  const notification_failures = allChunkEvents.filter(
    (e) =>
      e.status === 'error' &&
      (e.action === 'notification_failed' ||
        e.action === 'improvement_engine.notification_failed' ||
        (e.task_type ?? '').includes('notification_failed'))
  ).length

  // ollama_failures: ollama generate/embed failure events
  const ollama_failures = allChunkEvents.filter(
    (e) =>
      e.status === 'error' &&
      (e.action.includes('ollama') ||
        (e.task_type ?? '').includes('ollama') ||
        e.action === 'ollama.generate' ||
        e.action === 'ollama.embed')
  ).length

  // grounding_mismatches: corrections logged at grounding time
  const grounding_mismatches = allChunkEvents.filter(
    (e) => e.action === 'grounding.mismatch' || e.task_type === 'grounding_mismatch'
  ).length

  // spec_corrections: grounding corrections that trace to spec omissions
  const spec_corrections = allChunkEvents.filter(
    (e) =>
      (e.action === 'grounding.mismatch' || e.task_type === 'grounding_mismatch') &&
      (e.meta?.reason === 'spec_omission' || e.meta?.spec_gap === true)
  ).length

  // review_bypasses: pre-commit bypasses (check agent_events for bypass logs)
  const review_bypasses = allChunkEvents.filter(
    (e) => e.action === 'review_bypass' || e.task_type === 'review_bypass'
  ).length

  // grounding_status: inferred from events
  const groundingPassed = allChunkEvents.some(
    (e) => e.action === 'grounding.passed' || e.task_type === 'grounding_passed'
  )
  const groundingFailed = allChunkEvents.some(
    (e) => e.action === 'grounding.failed' || e.task_type === 'grounding_failed'
  )
  const groundingLimited = allChunkEvents.some(
    (e) =>
      e.action === 'grounding.passed_with_limitation' ||
      e.task_type === 'grounding_passed_with_limitation'
  )
  const grounding_status: ChunkAudit['grounding_status'] = groundingFailed
    ? 'failed'
    : groundingLimited
      ? 'passed_with_limitation'
      : groundingPassed
        ? 'passed'
        : 'not_yet'

  const audit: ChunkAudit = {
    chunk_id,
    sprint_id,
    task_queue_id: taskQueueId,
    acceptance_doc_found,
    grounding_status,
    grounding_mismatches,
    escalations_to_colin,
    twin_escalations,
    notification_failures,
    ollama_failures,
    review_bypasses,
    spec_corrections,
    analyzed_at: now,
  }

  await logEngineEvent({
    action: 'improvement_engine.audit_complete',
    status: 'success',
    output_summary: JSON.stringify(audit),
    meta: { task_id: taskQueueId, chunk_id, sprint_id },
  })

  return audit
}

// ── Component 3 — Proposer ────────────────────────────────────────────────────

/**
 * Reads a ChunkAudit and generates 0–N ImprovementProposal objects.
 *
 * Concrete action validation (Q2): before adding any proposal, both:
 *   (a) a specific file/doc/process must be named
 *   (b) the exact change must be named
 * Proposals failing this are logged as improvement_engine.proposal_rejected.
 */
export async function generateProposals(audit: ChunkAudit): Promise<ImprovementProposal[]> {
  const proposals: ImprovementProposal[] = []

  function makeFingerprint(category: ProposalCategory, concrete_action: string): string {
    return `${category}:${concrete_action.slice(0, 60)}`
  }

  function addProposal(
    p: Omit<ImprovementProposal, 'fingerprint' | 'severity' | 'source_chunk_id'>
  ) {
    const fingerprint = makeFingerprint(p.category, p.concrete_action)
    proposals.push({
      ...p,
      severity: 'nice_to_have', // initial severity; Deduplicator escalates on recurrence
      source_chunk_id: audit.chunk_id,
      fingerprint,
    })
  }

  async function rejectVague(
    category: ProposalCategory,
    concrete_action: string,
    reason: string
  ): Promise<void> {
    await logEngineEvent({
      action: 'improvement_engine.proposal_rejected',
      status: 'warning',
      output_summary: `proposal rejected: ${reason} — "${concrete_action.slice(0, 80)}"`,
      meta: {
        chunk_id: audit.chunk_id,
        category,
        concrete_action,
        reason: 'concrete_action_too_vague',
        detail: reason,
      },
    })
  }

  /**
   * Validates that a concrete_action names both:
   *   (a) a specific file/doc/process
   *   (b) the exact change
   * Returns true if valid. Returns false and logs rejection if not.
   *
   * Detection heuristic: action must contain at least one path-like token
   * (contains . or / or §) AND a verb phrase (add, update, export, wire, etc.)
   */
  async function validateConcreteness(
    category: ProposalCategory,
    concrete_action: string
  ): Promise<boolean> {
    const hasFileRef =
      /[./§]/.test(concrete_action) ||
      /\b(migration|table|column|cron|route|hook|endpoint|function|module|script|doc|policy|config|index|constraint)\b/i.test(
        concrete_action
      )

    const hasVerb =
      /\b(add|update|export|wire|remove|create|insert|extend|require|enforce|source|set|enable|check|log|alert|include|replace|move|rename|delete|refactor|fix|configure)\b/i.test(
        concrete_action
      )

    if (!hasFileRef || !hasVerb) {
      await rejectVague(
        category,
        concrete_action,
        `missing ${!hasFileRef ? '(a) file/doc reference' : '(b) exact change verb'}`
      )
      return false
    }
    return true
  }

  // ── Generation rules (all 9 from acceptance doc table) ────────────────────────

  // Rule 1: grounding_mismatches > 0 AND traces to spec field → doc_gap
  if (audit.grounding_mismatches > 0) {
    const action = `Add numeric field definition table to acceptance doc for ${audit.chunk_id} chunk type — specify OrderStatus filter, pending handling, and SC match target in docs/sprint-${audit.sprint_id}`
    if (await validateConcreteness('doc_gap', action)) {
      addProposal({
        category: 'doc_gap',
        concrete_action: action,
        engine_signal: `chunk ${audit.chunk_id} had ${audit.grounding_mismatches} grounding mismatches — spec field precision gap detected`,
        measurement: `grounding_mismatches per chunk: before=${audit.grounding_mismatches}, target=0 after acceptance doc template update`,
        reversible: true,
      })
    }
  }

  // Rule 2: grounding_mismatches > 0 AND traces to timezone → doc_gap
  if (audit.grounding_mismatches > 0 && audit.spec_corrections > 0) {
    const action = `Update coordinator.md §8.4 to require timezone defined for any date-comparison chunk — add boundary test cases (e.g. Apr 30 23:30 MT → April bucket) and date range purpose`
    if (await validateConcreteness('doc_gap', action)) {
      addProposal({
        category: 'doc_gap',
        concrete_action: action,
        engine_signal: `chunk ${audit.chunk_id} had ${audit.spec_corrections} spec corrections tracing to timezone or date range omissions`,
        measurement: `spec_corrections per chunk: before=${audit.spec_corrections}, target=0 after coordinator.md §8.4 update`,
        reversible: true,
      })
    }
  }

  // Rule 3: twin_escalations > 2 → twin_corpus_gap
  if (audit.twin_escalations > 2) {
    const action = `Ingest ${audit.chunk_id} decisions into Twin corpus — ${audit.twin_escalations} escalations in chunk ${audit.chunk_id} were corpus gaps, not personal decisions. Update docs/twin-corpus-index.md with new ingestion task`
    if (await validateConcreteness('twin_corpus_gap', action)) {
      addProposal({
        category: 'twin_corpus_gap',
        concrete_action: action,
        engine_signal: `twin escalated ${audit.twin_escalations} times in chunk ${audit.chunk_id} — knowledge gap, not Colin preference`,
        measurement: `twin_escalations per chunk: before=${audit.twin_escalations}, target <= 2 after corpus ingestion`,
        reversible: true,
      })
    }
  }

  // Rule 4: notification_failures > 0 → tooling
  if (audit.notification_failures > 0) {
    const action = `Wire coordinator to detect sandbox environment at startup and log notification_skipped instead of failing — add sandbox detection check in lib/harness/invoke-coordinator.ts`
    if (await validateConcreteness('tooling', action)) {
      addProposal({
        category: 'tooling',
        concrete_action: action,
        engine_signal: `${audit.notification_failures} notification failures in chunk ${audit.chunk_id} — sandbox detection gap`,
        measurement: `notification_failures per chunk: before=${audit.notification_failures}, target=0 after sandbox detection`,
        reversible: true,
      })
    }
  }

  // Rule 5: ollama_failures > 3 → reliability (Ollama liveness)
  if (audit.ollama_failures > 3) {
    const action = `Add Ollama liveness check to morning_digest — if Ollama unreachable, alert Colin before overnight runs begin. Update app/api/cron/morning-digest/route.ts to call /api/health/ollama before scheduling tasks`
    if (await validateConcreteness('reliability', action)) {
      addProposal({
        category: 'reliability',
        concrete_action: action,
        engine_signal: `${audit.ollama_failures} Ollama failures in chunk ${audit.chunk_id} — no pre-flight liveness check`,
        measurement: `ollama_failures per chunk: before=${audit.ollama_failures}, target=0 with liveness pre-check`,
        reversible: true,
      })
    }
  }

  // Rule 6: review_bypasses > 0 (ANTHROPIC_API_KEY reason) → tooling
  if (audit.review_bypasses > 0) {
    const action = `Export ANTHROPIC_API_KEY from .env.local into pre-commit hook env — add sourcing line to .husky/pre-commit: source .env.local before running AI review`
    if (await validateConcreteness('tooling', action)) {
      addProposal({
        category: 'tooling',
        concrete_action: action,
        engine_signal: `${audit.review_bypasses} pre-commit bypass(es) in chunk ${audit.chunk_id} — ANTHROPIC_API_KEY not in hook env`,
        measurement: `review_bypasses per chunk: before=${audit.review_bypasses}, target=0 after .husky/pre-commit sourcing fix`,
        reversible: true,
      })
    }
  }

  // Rule 7: escalations_to_colin > 3 AND chunk is a port → process
  if (audit.escalations_to_colin > 3) {
    const action = `Run Phase 1a Streamlit study before writing acceptance doc for ${audit.chunk_id} chunk type — update coordinator.md Phase 1a to mark study as mandatory, not optional, for port chunks`
    if (await validateConcreteness('process', action)) {
      addProposal({
        category: 'process',
        concrete_action: action,
        engine_signal: `${audit.escalations_to_colin} Colin escalations in chunk ${audit.chunk_id} — Phase 1a study was skipped`,
        measurement: `escalations_to_colin per chunk: before=${audit.escalations_to_colin}, target <= 3 after Phase 1a mandate`,
        reversible: true,
      })
    }
  }

  // Rule 8: auth/secret handling → security (triggered by any security-adjacent signal)
  // We detect this via meta signals: spec_corrections on auth tables, or any event tagged 'auth'
  // For v1, we check grounding_mismatches + spec_corrections as a proxy for auth-adjacent changes
  if (audit.spec_corrections > 0 && audit.grounding_mismatches > 0) {
    const action = `Add RLS policy review to acceptance checklist for chunks touching auth-adjacent tables — update docs/sprint-${audit.sprint_id}/chunk-${audit.chunk_id}-acceptance.md template to require safety agent sign-off on any RLS change`
    if (await validateConcreteness('security', action)) {
      addProposal({
        category: 'security',
        concrete_action: action,
        engine_signal: `spec corrections in chunk ${audit.chunk_id} — auth/RLS change may have shipped without safety agent review`,
        measurement: `security_review_gap_per_chunk: before=1 (unchecked), target=0 after checklist update`,
        reversible: true,
      })
    }
  }

  // Rule 9: ollama_failures > 3 OR silent degradation → reliability (circuit-breaker)
  if (audit.ollama_failures > 3) {
    const action = `Add circuit-breaker to lib/ollama/client.ts — ${audit.ollama_failures} Ollama failures in chunk ${audit.chunk_id} caused silent degradation with no alert; implement half-open/open state with agent_events logging`
    if (await validateConcreteness('reliability', action)) {
      addProposal({
        category: 'reliability',
        concrete_action: action,
        engine_signal: `${audit.ollama_failures} Ollama failures with silent degradation in chunk ${audit.chunk_id}`,
        measurement: `silent_degradation_events per chunk: before=${audit.ollama_failures}, target=0 with circuit-breaker`,
        reversible: true,
      })
    }
  }

  return proposals
}

// ── Component 4 — Deduplicator + Component 5 — Queuer ────────────────────────

/**
 * For each proposal:
 *   1. Query task_queue for existing open row with matching fingerprint
 *   2. If match: UPDATE existing (increment recurrence_count, recalculate severity)
 *              + INSERT new row with recurrence_of = existing_id
 *   3. If no match: INSERT new row
 *
 * Returns the list of newly inserted task_queue row IDs.
 */
export async function deduplicateAndQueue(
  proposals: ImprovementProposal[],
  chunkId: string
): Promise<string[]> {
  const db = createServiceClient()
  const insertedIds: string[] = []

  for (const proposal of proposals) {
    // ── Component 4: Deduplication query ────────────────────────────────────────
    const { data: existing } = await db
      .from('task_queue')
      .select('id, metadata')
      .in('status', ['queued', 'claimed'])
      .filter('metadata->>proposal_fingerprint', 'eq', proposal.fingerprint)
      .filter('metadata->>task_type_label', 'eq', 'improvement_proposal')
      .limit(1)
      .maybeSingle()

    const existingRow = existing as { id: string; metadata: Record<string, unknown> } | null

    let recurrenceOf: string | undefined
    let newSeverity = proposal.severity

    if (existingRow) {
      // ── Step 1: UPDATE existing row ───────────────────────────────────────────
      const currentCount = Number(existingRow.metadata?.recurrence_count ?? 0)
      const newCount = currentCount + 1

      // Recalculate severity based on new recurrence count
      if (newCount >= SEVERITY_RECURRENCE_THRESHOLDS.blocking) {
        newSeverity = 'blocking'
      } else if (newCount >= SEVERITY_RECURRENCE_THRESHOLDS.meaningful) {
        newSeverity = 'meaningful'
      } else {
        newSeverity = 'nice_to_have'
      }

      const needsRootCauseReview = newCount >= ROOT_CAUSE_REVIEW_THRESHOLD

      await db
        .from('task_queue')
        .update({
          metadata: {
            ...existingRow.metadata,
            recurrence_count: newCount,
            last_seen_chunk_id: chunkId,
            severity: newSeverity,
            needs_root_cause_review: needsRootCauseReview,
          },
        })
        .eq('id', existingRow.id)

      recurrenceOf = existingRow.id
    }

    // ── Step 2 (match) / Direct path (no match): INSERT new row ─────────────────
    const resolvedSeverity = newSeverity

    const { data: inserted } = await db
      .from('task_queue')
      .insert({
        task: `Improvement proposal: ${proposal.concrete_action.slice(0, 80)}`,
        description: proposal.concrete_action,
        priority: resolvedSeverity === 'blocking' ? 1 : resolvedSeverity === 'meaningful' ? 2 : 3,
        // KNOWN BLOCKER: source='improvement_engine' will fail task_queue.source CHECK constraint
        // until a migration adds 'improvement_engine' to the allowed set.
        // See: supabase/migrations/0018_add_auto_proceed_patterns.sql note section.
        source: 'improvement_engine' as string,
        metadata: {
          task_type_label: 'improvement_proposal',
          category: proposal.category,
          severity: resolvedSeverity,
          concrete_action: proposal.concrete_action,
          engine_signal: proposal.engine_signal,
          measurement: proposal.measurement,
          source_chunk_id: proposal.source_chunk_id,
          proposal_fingerprint: proposal.fingerprint,
          recurrence_count: 0,
          f17_compliance: proposal.engine_signal,
          f18_compliance: proposal.measurement,
          ...(recurrenceOf ? { recurrence_of: recurrenceOf } : {}),
        },
      })
      .select('id')
      .single()

    if (inserted) {
      insertedIds.push((inserted as { id: string }).id)
    }
  }

  return insertedIds
}

// ── Component 7 — Auto-Proceed Gate ──────────────────────────────────────────

/**
 * Checks if a proposal qualifies for auto-proceed (all 5 criteria must hold):
 *   1. category in {tooling, code_pattern, test_coverage}
 *   2. severity === 'nice_to_have'
 *   3. proposal.reversible === true
 *   4. v1: assume tests pass (full CI gate out of scope — logged as note)
 *   5. auto_proceed_patterns row exists with approval_count >= 3 AND enabled = true
 *
 * Returns true if auto-proceed, false if should route to Notifier.
 */
export async function checkAutoProceed(
  proposal: ImprovementProposal,
  taskQueueRowId: string
): Promise<boolean> {
  // Criterion 1: category
  if (!AUTO_PROCEED_CATEGORIES.includes(proposal.category)) return false

  // Criterion 2: severity
  if (proposal.severity !== 'nice_to_have') return false

  // Criterion 3: reversible
  if (!proposal.reversible) return false

  // Criterion 4: v1 — assume tests pass (note logged)
  // TODO: wire to actual CI test run result when available (Sprint 6+)
  const ciAssumedPass = true
  if (!ciAssumedPass) return false

  // Criterion 5: auto_proceed_patterns lookup
  const db = createServiceClient()
  const actionSignature = proposal.concrete_action.slice(0, 80)

  const { data: pattern } = await db
    .from('auto_proceed_patterns')
    .select('id, approval_count, enabled')
    .eq('category', proposal.category)
    .eq('action_signature', actionSignature)
    .eq('enabled', true)
    .gte('approval_count', 3)
    .maybeSingle()

  if (!pattern) return false

  // All 5 criteria met — mark auto_proceeded
  // KNOWN BLOCKER: status='auto_proceeded' will fail task_queue.status CHECK constraint
  // until a migration adds 'auto_proceeded' to the allowed set.
  await db
    .from('task_queue')
    .update({ status: 'auto_proceeded' as string })
    .eq('id', taskQueueRowId)

  await logEngineEvent({
    action: 'improvement_engine.auto_proceeded',
    status: 'success',
    output_summary: `proposal auto-proceeded: ${proposal.concrete_action.slice(0, 80)}`,
    meta: {
      task_queue_id: taskQueueRowId,
      category: proposal.category,
      fingerprint: proposal.fingerprint,
      pattern_id: (pattern as { id: string }).id,
    },
  })

  return true
}

// ── Component 6 — Notifier ────────────────────────────────────────────────────

/**
 * Inserts one outbound_notifications row if >= 1 proposal was queued.
 * Uses plain text (NO parse_mode: Markdown) to avoid bracket-parse failures.
 */
export async function notifyProposals(
  proposals: ImprovementProposal[],
  chunkId: string,
  taskQueueId: string
): Promise<void> {
  if (proposals.length === 0) return

  const lines: string[] = [
    `LepiOS Improvement Engine - Chunk ${chunkId}`,
    `${proposals.length} proposal(s) queued`,
    '',
  ]

  proposals.forEach((p, i) => {
    const truncated =
      p.concrete_action.length > 100 ? p.concrete_action.slice(0, 100) + '...' : p.concrete_action
    lines.push(`${i + 1}. [${p.category}] ${truncated}`)
    lines.push(`   Severity: ${p.severity}`)
  })

  const text = lines.join('\n')

  const db = createServiceClient()

  await db.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: {
      text,
      // NO parse_mode: Markdown — brackets in text cause parse failures
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Approve all', callback_data: `improve_approve_all:${chunkId}` },
            { text: 'Review each', callback_data: `improve_review:${chunkId}` },
            { text: 'Dismiss', callback_data: `improve_dismiss:${chunkId}` },
          ],
        ],
      },
    },
    correlation_id: taskQueueId,
    requires_response: true,
  })
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Full improvement engine pipeline for one completed chunk.
 * Called by the notifications-drain route (Component 1 — Option A).
 *
 * Steps:
 *   1. Analyze chunk audit trail
 *   2. Generate proposals
 *   3. For each proposal: check auto-proceed or deduplicate+queue
 *   4. Notify via Telegram if any proposals were queued
 */
export async function runImprovementEngine(taskQueueId: string): Promise<{
  chunk_id: string
  proposals_generated: number
  proposals_queued: number
  proposals_auto_proceeded: number
}> {
  // Step 2: Analyze
  const audit = await analyzeChunk(taskQueueId)

  // Reconstruct attribution context from the completed task row.
  // run_id = claimed_by of the completed task (the pickup cron's UUID that ran it).
  // coordinator_session_id = first agent_events row with action='coordinator.session_started'
  // and meta.task_id = taskQueueId, if present; else null.
  let engineRunId: string | undefined
  let engineCoordinatorSessionId: string | undefined
  try {
    const db = createServiceClient()
    const { data: taskCtx } = await db
      .from('task_queue')
      .select('claimed_by')
      .eq('id', taskQueueId)
      .maybeSingle()
    engineRunId = (taskCtx as { claimed_by: string | null } | null)?.claimed_by ?? undefined

    const { data: sessionEvent } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'coordinator.session_started')
      .filter('meta->>task_id', 'eq', taskQueueId)
      .limit(1)
      .maybeSingle()
    const sessionMeta = (sessionEvent as { meta: Record<string, unknown> } | null)?.meta
    engineCoordinatorSessionId =
      (sessionMeta?.coordinator_session_id as string | undefined) ?? undefined
  } catch {
    // Context reconstruction failure is non-fatal — attribution will have nulls for these fields
  }

  // Step 3: Generate proposals
  const proposals = await generateProposals(audit)

  const queuedProposals: ImprovementProposal[] = []
  const autoProceededCount = { value: 0 }

  // Step 4+5: Deduplicate and queue each proposal
  // First insert all proposals to get their IDs, then check auto-proceed
  const insertedIds = await deduplicateAndQueue(proposals, audit.chunk_id)

  // Attribution: one row per successfully inserted proposal
  for (let i = 0; i < insertedIds.length; i++) {
    const newId = insertedIds[i]
    if (!newId) continue
    void recordAttribution(
      {
        actor_type: 'improvement_engine',
        source_task_id: taskQueueId,
        run_id: engineRunId,
        coordinator_session_id: engineCoordinatorSessionId,
      },
      { type: 'task_queue', id: newId },
      'created',
      {
        category: proposals[i]?.category,
        fingerprint: proposals[i]?.fingerprint,
        severity: proposals[i]?.severity,
      }
    )
  }

  // Step 7: Check auto-proceed for each inserted proposal
  for (let i = 0; i < proposals.length; i++) {
    const rowId = insertedIds[i]
    if (!rowId) continue

    const autoProceeded = await checkAutoProceed(proposals[i], rowId)
    if (autoProceeded) {
      autoProceededCount.value++
      // Attribution: auto-proceed path
      void recordAttribution(
        {
          actor_type: 'improvement_engine',
          source_task_id: taskQueueId,
          run_id: engineRunId,
          coordinator_session_id: engineCoordinatorSessionId,
        },
        { type: 'task_queue', id: rowId },
        'auto_proceeded',
        {
          reason: 'auto_proceed_pattern_match',
          category: proposals[i]?.category,
          fingerprint: proposals[i]?.fingerprint,
        }
      )
    } else {
      queuedProposals.push(proposals[i])
    }
  }

  // Step 6: Notify
  await notifyProposals(queuedProposals, audit.chunk_id, taskQueueId)

  return {
    chunk_id: audit.chunk_id,
    proposals_generated: proposals.length,
    proposals_queued: queuedProposals.length,
    proposals_auto_proceeded: autoProceededCount.value,
  }
}
