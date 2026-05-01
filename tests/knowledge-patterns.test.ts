/**
 * Unit tests for lib/knowledge/patterns.ts — analyzeFailedApproaches aggregation.
 *
 * Regression guard for the 31-stub duplicate incident (2026-04-28).
 * Root cause: analyzeFailedApproaches emitted one candidate per failure event
 * (O(n)) instead of one per unique (domain::action::entity) pattern (O(1)).
 * A persistent Ollama failure over 31 nights produced 31 byte-identical rows.
 *
 * These tests verify the aggregated behaviour without a live Supabase connection.
 * The function is pure (no I/O); no mocks are required.
 */

import { describe, it, expect } from 'vitest'
import { analyzeFailedApproaches } from '@/lib/knowledge/patterns'
import type { AgentEventRow } from '@/lib/knowledge/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFailure(
  id: string,
  opts: {
    domain?: string
    action?: string
    entity?: string | null
    errorMessage?: string
    occurredAt?: string
  } = {}
): AgentEventRow {
  return {
    id,
    occurred_at:
      opts.occurredAt ?? `2026-04-${String(Number(id.slice(-2)) || 1).padStart(2, '0')}T02:00:00Z`,
    domain: opts.domain ?? 'ollama',
    action: opts.action ?? 'ollama.generate',
    actor: 'system',
    status: 'failure',
    entity: opts.entity ?? null,
    error_message: opts.errorMessage ?? 'Ollama is unreachable',
    error_type: 'OllamaUnreachableError',
  }
}

function makeSuccess(
  id: string,
  domain: string,
  action: string,
  entity: string | null = null
): AgentEventRow {
  return {
    id,
    occurred_at: '2026-04-28T03:00:00Z',
    domain,
    action,
    actor: 'system',
    status: 'success',
    entity,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('analyzeFailedApproaches — aggregation', () => {
  it('31 identical-shape failures → exactly 1 candidate', () => {
    const events: AgentEventRow[] = Array.from({ length: 31 }, (_, i) =>
      makeFailure(`evt-${String(i + 1).padStart(2, '0')}`, {
        occurredAt: `2026-04-${String(i + 1).padStart(2, '0')}T02:00:00Z`,
      })
    )

    const candidates = analyzeFailedApproaches(events)

    expect(candidates).toHaveLength(1)
  })

  it('31 identical-shape failures → candidate.sourceEvents has 31 entries', () => {
    const events: AgentEventRow[] = Array.from({ length: 31 }, (_, i) =>
      makeFailure(`evt-${String(i + 1).padStart(2, '0')}`, {
        occurredAt: `2026-04-${String(i + 1).padStart(2, '0')}T02:00:00Z`,
      })
    )

    const [candidate] = analyzeFailedApproaches(events)

    expect(candidate.sourceEvents).toHaveLength(31)
    // All original event IDs must be present
    for (let i = 1; i <= 31; i++) {
      expect(candidate.sourceEvents).toContain(`evt-${String(i).padStart(2, '0')}`)
    }
  })

  it('31 failures across 3 distinct action values → 3 candidates', () => {
    const actions = ['ollama.generate', 'coach.ask', 'translate'] as const
    const events: AgentEventRow[] = Array.from({ length: 31 }, (_, i) =>
      makeFailure(`evt-${i}`, {
        action: actions[i % 3],
        occurredAt: `2026-04-01T${String(i).padStart(2, '0')}:00:00Z`,
      })
    )

    const candidates = analyzeFailedApproaches(events)

    expect(candidates).toHaveLength(3)
    const titles = candidates.map((c) => c.title).sort()
    expect(titles).toEqual([
      'Unresolved: coach.ask failed',
      'Unresolved: ollama.generate failed',
      'Unresolved: translate failed',
    ])
  })

  it('each candidate sourceEvents only contains IDs for its own action', () => {
    const actions = ['ollama.generate', 'coach.ask'] as const
    const events: AgentEventRow[] = Array.from({ length: 10 }, (_, i) =>
      makeFailure(`evt-${i}`, {
        action: actions[i % 2],
        occurredAt: `2026-04-01T${String(i).padStart(2, '0')}:00:00Z`,
      })
    )

    const candidates = analyzeFailedApproaches(events)
    expect(candidates).toHaveLength(2)

    const ollama = candidates.find((c) => c.title.includes('ollama'))!
    const coach = candidates.find((c) => c.title.includes('coach'))!

    expect(ollama.sourceEvents).toHaveLength(5)
    expect(coach.sourceEvents).toHaveLength(5)

    // No ID cross-contamination
    const ollamaIds = new Set(ollama.sourceEvents)
    for (const id of coach.sourceEvents ?? []) {
      expect(ollamaIds.has(id)).toBe(false)
    }
  })

  it('candidate uses the most-recent failure error_message (last in array)', () => {
    const events: AgentEventRow[] = [
      makeFailure('evt-1', { occurredAt: '2026-04-01T01:00:00Z', errorMessage: 'first message' }),
      makeFailure('evt-2', { occurredAt: '2026-04-02T01:00:00Z', errorMessage: 'first message' }),
      makeFailure('evt-3', {
        occurredAt: '2026-04-03T01:00:00Z',
        errorMessage: 'most recent message',
      }),
    ]

    const [candidate] = analyzeFailedApproaches(events)
    expect(candidate.problem).toBe('most recent message')
  })

  it('failure is excluded when same domain::action::entity has a success', () => {
    const events: AgentEventRow[] = [
      makeFailure('evt-fail', { action: 'scan' }),
      makeSuccess('evt-ok', 'ollama', 'scan', null),
    ]

    const candidates = analyzeFailedApproaches(events)
    expect(candidates).toHaveLength(0)
  })

  it('failures on different entities are separate candidates even with same domain+action', () => {
    const events: AgentEventRow[] = [
      makeFailure('evt-1', { action: 'scan', entity: 'isbn-111' }),
      makeFailure('evt-2', { action: 'scan', entity: 'isbn-222' }),
    ]

    const candidates = analyzeFailedApproaches(events)
    expect(candidates).toHaveLength(2)
  })

  it('empty event array → empty candidates', () => {
    expect(analyzeFailedApproaches([])).toEqual([])
  })

  it('all events are successes → empty candidates', () => {
    const events: AgentEventRow[] = [
      makeSuccess('evt-1', 'ollama', 'generate'),
      makeSuccess('evt-2', 'ollama', 'generate'),
    ]
    expect(analyzeFailedApproaches(events)).toHaveLength(0)
  })
})
