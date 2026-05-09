/**
 * tests/harness/f19/persistence.test.ts
 *
 * AT5a — 3 gain windows → metadata.f19_status = 'accepted', f19_window_count = 3
 * AT5b — 2 gain + 1 regression (within ±5%) → 'pending' (NOT 'accepted')
 * AT5c — 1 gain + 2 regression (>±5%) → 'vetoed', vetoes include metric_regression
 */

import { describe, it, expect, vi } from 'vitest'
import { RealVerifier } from '@/lib/harness/f19/verifier'
import type { CandidatePath } from '@/lib/harness/f19/optimizer'
import type { SupabaseClient } from '@supabase/supabase-js'

interface DecisionRow {
  id: string
  metadata: Record<string, unknown>
  chosen_path: string
  options_considered: unknown[]
  reason: string
}

interface PerWindowMock {
  client: SupabaseClient
  getDecisionRow(): DecisionRow | null
  inserts: Array<{ table: string; data: Record<string, unknown> }>
  updates: Array<{ table: string; data: Record<string, unknown> }>
}

function buildPerWindowMock(options: {
  candidateId: string
  windows: Array<{
    gain_pct: number
    siblingRegressions?: Array<{ metric_key: string; baseline: number; candidate: number }>
  }>
}): PerWindowMock {
  const { candidateId, windows } = options

  let currentDecisionRow: DecisionRow | null = null
  let gateCallCount = 0
  const inserts: Array<{ table: string; data: Record<string, unknown> }> = []
  const updates: Array<{ table: string; data: Record<string, unknown> }> = []

  const fromMock = vi.fn().mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    let insertData: Record<string, unknown> | null = null
    let updateData: Record<string, unknown> | null = null

    for (const m of ['select', 'eq', 'like', 'gte', 'order', 'not', 'or', 'limit']) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }

    chain['insert'] = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      insertData = data
      inserts.push({ table, data })
      if (table === 'decisions_log') {
        currentDecisionRow = {
          id: 'mock-persist-id',
          metadata: (data.metadata as Record<string, unknown>) ?? {},
          chosen_path: (data.chosen_path as string) ?? '',
          options_considered: (data.options_considered as unknown[]) ?? [],
          reason: (data.reason as string) ?? '',
        }
        gateCallCount++
      }
      return chain
    })

    chain['update'] = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      updateData = data
      updates.push({ table, data })
      if (table === 'decisions_log' && currentDecisionRow) {
        currentDecisionRow = {
          ...currentDecisionRow,
          metadata: (data.metadata as Record<string, unknown>) ?? currentDecisionRow.metadata,
          chosen_path: (data.chosen_path as string) ?? currentDecisionRow.chosen_path,
          options_considered: (data.options_considered as unknown[]) ?? currentDecisionRow.options_considered,
          reason: (data.reason as string) ?? currentDecisionRow.reason,
        }
        gateCallCount++
      }
      return chain
    })

    chain['single'] = vi.fn().mockImplementation(() => {
      if (insertData && table === 'decisions_log') {
        return Promise.resolve({ data: { id: 'mock-persist-id' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) => {
      if (table === 'agent_events') {
        const windowIdx = Math.min(gateCallCount, windows.length - 1)
        const win = windows[windowIdx]
        const rows: Record<string, unknown>[] = [
          { context: { candidate_id: candidateId, window_index: windowIdx, metric_key: 'queue_depth', gain_pct: win.gain_pct } },
        ]
        for (const sib of win.siblingRegressions ?? []) {
          rows.push({ context: { candidate_id: candidateId, window_index: windowIdx, metric_key: sib.metric_key, phase: 'baseline', value: sib.baseline } })
          rows.push({ context: { candidate_id: candidateId, window_index: windowIdx, metric_key: sib.metric_key, phase: 'candidate', value: sib.candidate } })
        }
        return Promise.resolve({ data: rows, error: null }).then(fn)
      }
      if (table === 'decisions_log' && !insertData && !updateData) {
        const rows = currentDecisionRow ? [currentDecisionRow] : []
        return Promise.resolve({ data: rows, error: null }).then(fn)
      }
      if (insertData) return Promise.resolve({ data: null, error: null }).then(fn)
      if (updateData) return Promise.resolve({ data: null, error: null }).then(fn)
      return Promise.resolve({ data: [], error: null }).then(fn)
    }

    return chain
  })

  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    getDecisionRow: () => currentDecisionRow,
    inserts,
    updates,
  }
}

function makeCandidate(candidateId: string): CandidatePath {
  return {
    id: candidateId,
    target: 'harness:process_efficiency',
    summary: 'spawn coordinator at queue depth >= 2',
    expected_gain_pct: 50,
    metric_key: 'queue_depth',
    proposed_change: { kind: 'process', diff_summary: 'test persistence change' },
    rationale: 'persistence test candidate',
  }
}

describe('AT5a — 3 consecutive gain windows → accepted', () => {
  it('final metadata.f19_status = accepted, f19_window_count = 3', async () => {
    const candidateId = 'test-at5a-' + Date.now()
    const candidate = makeCandidate(candidateId)
    const mock = buildPerWindowMock({
      candidateId,
      windows: [{ gain_pct: 30 }, { gain_pct: 25 }, { gain_pct: 35 }],
    })
    const verifier = new RealVerifier(mock.client)
    await verifier.gate(candidate)
    await verifier.gate(candidate)
    await verifier.gate(candidate)

    const row = mock.getDecisionRow()
    expect(row).not.toBeNull()
    const metadata = row!.metadata as { f19_status: string; f19_window_count: number }
    expect(metadata.f19_status).toBe('accepted')
    expect(metadata.f19_window_count).toBe(3)
  })
})

describe('AT5b — 2 gain + 1 small regression → pending (NOT accepted)', () => {
  it('final metadata.f19_status is pending or vetoed, never accepted', async () => {
    const candidateId = 'test-at5b-' + Date.now()
    const candidate = makeCandidate(candidateId)
    const mock = buildPerWindowMock({
      candidateId,
      windows: [{ gain_pct: 30 }, { gain_pct: 25 }, { gain_pct: -3 }],
    })
    const verifier = new RealVerifier(mock.client)
    await verifier.gate(candidate)
    await verifier.gate(candidate)
    await verifier.gate(candidate)

    const row = mock.getDecisionRow()
    expect(row).not.toBeNull()
    const metadata = row!.metadata as { f19_status: string }
    expect(metadata.f19_status).not.toBe('accepted')
    expect(['pending', 'vetoed']).toContain(metadata.f19_status)
  })
})

describe('AT5c — 1 gain + 2 regression windows → vetoed', () => {
  it('final metadata.f19_status = vetoed with metric_regression veto', async () => {
    const candidateId = 'test-at5c-' + Date.now()
    const candidate = makeCandidate(candidateId)
    const mock = buildPerWindowMock({
      candidateId,
      windows: [{ gain_pct: 30 }, { gain_pct: -20 }, { gain_pct: -25 }],
    })
    const verifier = new RealVerifier(mock.client)
    await verifier.gate(candidate)
    const result2 = await verifier.gate(candidate)
    const result3 = await verifier.gate(candidate)

    const row = mock.getDecisionRow()
    expect(row).not.toBeNull()
    const metadata = row!.metadata as { f19_status: string }
    expect(metadata.f19_status).toBe('vetoed')

    const allVetoes = [...result2.vetoes, ...result3.vetoes]
    const hasMetricRegression = allVetoes.some((v) => v.kind === 'metric_regression')
    expect(hasMetricRegression).toBe(true)
  })
})
