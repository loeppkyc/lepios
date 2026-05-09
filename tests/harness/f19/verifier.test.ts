/**
 * tests/harness/f19/verifier.test.ts
 *
 * AT2 — Verifier writes decisions_log row regardless of ship verdict.
 * AT3 — Verifier vetoes sibling-metric regression.
 * AT4 — Verifier re-measures independently (never reads expected_gain_pct).
 * AT6 — decisions_log row has decided_by='agent', source='f19_loop'.
 */

import { describe, it, expect, vi } from 'vitest'
import { RealVerifier } from '@/lib/harness/f19/verifier'
import type { CandidatePath } from '@/lib/harness/f19/optimizer'
import type { SupabaseClient } from '@supabase/supabase-js'

interface InsertCall {
  table: string
  data: Record<string, unknown>
}

interface UpdateCall {
  table: string
  data: Record<string, unknown>
}

interface MockDb {
  client: SupabaseClient
  inserts: InsertCall[]
  updates: UpdateCall[]
}

function buildMockDb(options: {
  agentEventsRows?: Record<string, unknown>[]
  existingDecision?: { id: string; metadata: Record<string, unknown> } | null
}): MockDb {
  const { agentEventsRows = [], existingDecision = null } = options
  const inserts: InsertCall[] = []
  const updates: UpdateCall[] = []
  const insertedDecisionId = 'mock-decision-id-' + Date.now()

  function makeChain(
    table: string,
    resolvedData: unknown,
    resolvedError: unknown = null
  ): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    let pendingInsertData: Record<string, unknown> | null = null
    let pendingUpdateData: Record<string, unknown> | null = null

    for (const m of ['select', 'eq', 'like', 'order', 'limit', 'gte', 'not', 'or']) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }

    chain['insert'] = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      pendingInsertData = data
      inserts.push({ table, data })
      return chain
    })

    chain['update'] = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      pendingUpdateData = data
      updates.push({ table, data })
      return chain
    })

    chain['delete'] = vi.fn().mockReturnValue(chain)

    chain['single'] = vi.fn().mockImplementation(() => {
      if (pendingInsertData && table === 'decisions_log') {
        return Promise.resolve({ data: { id: insertedDecisionId }, error: null })
      }
      if (pendingUpdateData) {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: resolvedData, error: resolvedError })
    })

    chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => {
      if (pendingInsertData && table === 'decisions_log') {
        return Promise.resolve({ data: null, error: null }).then(fn)
      }
      if (pendingUpdateData) {
        return Promise.resolve({ data: null, error: null }).then(fn)
      }
      return Promise.resolve({ data: resolvedData, error: resolvedError }).then(fn)
    }

    return chain
  }

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'agent_events') {
      return makeChain(table, agentEventsRows)
    }
    if (table === 'decisions_log') {
      const chain = makeChain(table, existingDecision ? [existingDecision] : [])
      return chain
    }
    return makeChain(table, [])
  })

  const client = { from: fromMock } as unknown as SupabaseClient
  return { client, inserts, updates }
}

function makeCandidate(overrides: Partial<CandidatePath> = {}): CandidatePath {
  return {
    id: 'test-candidate-' + Date.now(),
    target: 'harness:process_efficiency',
    summary: 'test optimization: spawn coordinator at queue depth >= 2',
    expected_gain_pct: 50,
    metric_key: 'queue_depth',
    proposed_change: { kind: 'process', diff_summary: 'test change' },
    rationale: 'test rationale',
    ...overrides,
  }
}

describe('AT2 — Verifier writes decisions_log row even when vetoed', () => {
  it('writes a decisions_log INSERT when candidate is vetoed (sibling regression)', async () => {
    const candidateId = 'test-at2-' + Date.now()
    const candidate = makeCandidate({ id: candidateId, metric_key: 'friction_index' })

    const agentEventsRows = [
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'baseline', value: 5 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'candidate', value: 2 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'baseline', value: 3 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'candidate', value: 3.9 } },
    ]

    const mock = buildMockDb({ agentEventsRows })
    const verifier = new RealVerifier(mock.client)
    const result = await verifier.gate(candidate)

    const decisionInsert = mock.inserts.find((i) => i.table === 'decisions_log')
    expect(decisionInsert).toBeDefined()
    expect(decisionInsert!.data.source).toBe('f19_loop')
    expect(decisionInsert!.data.category).toBe('process')
    expect(decisionInsert!.data.decided_by).toBe('agent')
    expect(decisionInsert!.data.chosen_path as string).toMatch(/^rejected:/)
    expect(result.decision_id).toBeTruthy()
  })
})

describe('AT3 — Verifier vetoes sibling-metric regression (pickup_latency +30%)', () => {
  it('returns ship: false with sibling_metric_regression veto for pickup_latency', async () => {
    const candidateId = 'test-at3-' + Date.now()
    const candidate = makeCandidate({ id: candidateId, metric_key: 'friction_index' })

    const agentEventsRows = [
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'baseline', value: 10 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'candidate', value: 5 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'baseline', value: 4 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'candidate', value: 5.2 } },
    ]

    const mock = buildMockDb({ agentEventsRows })
    const verifier = new RealVerifier(mock.client)
    const result = await verifier.gate(candidate)

    expect(result.ship).toBe(false)
    const siblingVeto = result.vetoes.find((v) => v.kind === 'sibling_metric_regression')
    expect(siblingVeto).toBeDefined()
    expect(siblingVeto).toMatchObject({ kind: 'sibling_metric_regression', metric_key: 'pickup_latency' })
  })

  it('does not short-circuit — collects ALL vetoes before returning', async () => {
    const candidateId = 'test-at3b-' + Date.now()
    const candidate = makeCandidate({ id: candidateId, metric_key: 'friction_index' })

    const agentEventsRows = [
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'baseline', value: 10 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'friction_index', phase: 'candidate', value: 5 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'baseline', value: 4 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'pickup_latency', phase: 'candidate', value: 5.2 } },
    ]

    const mock = buildMockDb({ agentEventsRows })
    const verifier = new RealVerifier(mock.client)
    const result = await verifier.gate(candidate)

    expect(Array.isArray(result.vetoes)).toBe(true)
    expect(result.vetoes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('AT4 — Verifier re-measures from agent_events, ignores expected_gain_pct=999', () => {
  it('measured_gain_pct comes from seeded agent_events rows, not from candidate.expected_gain_pct=999', async () => {
    const candidateId = 'test-at4-' + Date.now()
    const candidate = makeCandidate({ id: candidateId, metric_key: 'queue_depth', expected_gain_pct: 999 })

    const agentEventsRows = [
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'queue_depth', phase: 'baseline', value: 4 } },
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'queue_depth', phase: 'candidate', value: 2 } },
    ]

    const mock = buildMockDb({ agentEventsRows })
    const verifier = new RealVerifier(mock.client)
    const result = await verifier.gate(candidate)

    expect(result.measured_gain_pct).not.toBe(999)
    expect(result.measured_gain_pct).not.toBeNull()
    expect(result.measured_gain_pct).toBeGreaterThan(0)
    expect(result.measured_gain_pct).toBeLessThan(999)
  })
})

describe('AT6 — decisions_log row has decided_by=agent, source=f19_loop', () => {
  it('writes decided_by=agent and source=f19_loop on every call', async () => {
    const candidateId = 'test-at6-' + Date.now()
    const candidate = makeCandidate({ id: candidateId, metric_key: 'queue_depth' })

    const agentEventsRows = [
      { context: { candidate_id: candidateId, window_index: 0, metric_key: 'queue_depth', gain_pct: 30 } },
    ]

    const mock = buildMockDb({ agentEventsRows })
    const verifier = new RealVerifier(mock.client)
    await verifier.gate(candidate)

    const decisionInsert = mock.inserts.find((i) => i.table === 'decisions_log')
    expect(decisionInsert).toBeDefined()
    expect(decisionInsert!.data.decided_by).toBe('agent')
    expect(decisionInsert!.data.source).toBe('f19_loop')
  })
})
