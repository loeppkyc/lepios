/**
 * Tests for lib/harness/prestage/index.ts (runPreStage).
 *
 * Validates AC-B3 (dedup) and AC-B4 (auto-promotion respects tier ceiling)
 * with a mocked DB. The from_failures parser itself is covered separately
 * in prestage-from-failures.test.ts.
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4 + AC-B3, AC-B4.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

const { mockFromFailures } = vi.hoisted(() => ({
  mockFromFailures: vi.fn(),
}))

vi.mock('@/lib/harness/prestage/sources/from_failures', () => ({
  fromFailures: mockFromFailures,
}))

import { runPreStage } from '@/lib/harness/prestage'

// ── Builder helpers (mirror the chains the runner makes) ──────────────────────

function makeConfigRow(value: string | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: value === null ? null : { value }, error: null }),
      }),
    }),
  }
}

function makeOpenTasksBuilder(rows: Array<{ task: string }>) {
  return {
    select: () => ({
      in: () => Promise.resolve({ data: rows, error: null }),
    }),
  }
}

function makeExistingRefsBuilder(refs: string[]) {
  return {
    select: () => ({
      eq: () => ({
        in: () => ({
          in: () =>
            Promise.resolve({ data: refs.map((source_ref) => ({ source_ref })), error: null }),
        }),
      }),
    }),
  }
}

function makeProposalInsertBuilder(generatedId = 'prop-uuid-1') {
  return {
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: generatedId }, error: null }),
      }),
    }),
  }
}

function makeTaskQueueInsertBuilder(generatedId = 'task-uuid-1') {
  return {
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: generatedId }, error: null }),
      }),
    }),
  }
}

function makeProposalUpdateBuilder() {
  return {
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }),
  }
}

function makeAgentEventsInsertBuilder() {
  return {
    insert: () => Promise.resolve({ data: null, error: null }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReset()
  mockFromFailures.mockReset()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runPreStage — auto-promotion (AC-B4)', () => {
  it('auto-promotes a low-risk high-confidence proposal under tier=low', async () => {
    // Sources: failures_md returns one proposal with confidence=0.9, risk_score=15
    mockFromFailures.mockResolvedValueOnce([
      {
        task: 'Resolve F-N99 — test failure',
        description: 'body',
        source_ref: 'F-N99',
        confidence: 0.9,
        risk_score: 15,
      },
    ])

    // Mock chain order matches runPreStage flow:
    //  1) readRiskTier → harness_config row 'DEPLOY_GATE_RISK_TIER'
    //  2) isSourceEnabled('failures_md') → harness_config row
    //  3..6) isSourceEnabled for each remaining source
    //  7) fetchOpenTaskTexts → task_queue
    //  8) fetchExistingRefs → task_proposals (none)
    //  9) insertProposal → task_proposals
    // 10) promoteProposal: insert task_queue + update task_proposals
    // 11) update task_proposals
    // 12) heartbeat insert agent_events
    mockFrom
      .mockReturnValueOnce(makeConfigRow('low')) // DEPLOY_GATE_RISK_TIER
      .mockReturnValueOnce(makeConfigRow('true')) // PRESTAGE_SOURCE_FAILURES_MD_ENABLED
      .mockReturnValueOnce(makeConfigRow(null)) // env_audit
      .mockReturnValueOnce(makeConfigRow(null)) // gpu_day_gap
      .mockReturnValueOnce(makeConfigRow(null)) // self_repair_dlq
      .mockReturnValueOnce(makeConfigRow(null)) // morning_digest
      .mockReturnValueOnce(makeOpenTasksBuilder([])) // fetchOpenTaskTexts
      .mockReturnValueOnce(makeExistingRefsBuilder([])) // no existing
      .mockReturnValueOnce(makeProposalInsertBuilder('prop-1')) // proposal insert
      .mockReturnValueOnce(makeTaskQueueInsertBuilder('task-1')) // promote: task_queue insert
      .mockReturnValueOnce(makeProposalUpdateBuilder()) // promote: task_proposals update
      .mockReturnValue(makeAgentEventsInsertBuilder()) // agent_events heartbeat

    const summary = await runPreStage()

    expect(mockFromFailures).toHaveBeenCalledTimes(1)
    expect(summary.ok).toBe(true)
    expect(summary.new_proposals).toBe(1)
    expect(summary.auto_promoted).toBe(1)
    expect(summary.per_source.failures_md.promoted).toBe(1)
  })

  it('does NOT auto-promote when risk_score exceeds tier ceiling (AC-B4 negative case)', async () => {
    mockFromFailures.mockResolvedValueOnce([
      {
        task: 'Resolve F-N100 — risky',
        description: 'body',
        source_ref: 'F-N100',
        confidence: 0.9,
        risk_score: 45, // > 20 ceiling for tier='low'
      },
    ])

    mockFrom
      .mockReturnValueOnce(makeConfigRow('low'))
      .mockReturnValueOnce(makeConfigRow('true'))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeOpenTasksBuilder([]))
      .mockReturnValueOnce(makeExistingRefsBuilder([]))
      .mockReturnValueOnce(makeProposalInsertBuilder('prop-2'))
      .mockReturnValue(makeAgentEventsInsertBuilder())

    const summary = await runPreStage()

    expect(summary.new_proposals).toBe(1)
    expect(summary.auto_promoted).toBe(0) // risk_score=45 → medium-tier required, configured low
    expect(summary.per_source.failures_md.inserted).toBe(1)
    expect(summary.per_source.failures_md.promoted).toBe(0)
  })

  it('does NOT auto-promote when confidence < 0.8 (AC-B4 confidence floor)', async () => {
    mockFromFailures.mockResolvedValueOnce([
      {
        task: 'Resolve F-N101 — uncertain',
        description: 'body',
        source_ref: 'F-N101',
        confidence: 0.7, // below floor
        risk_score: 10,
      },
    ])

    mockFrom
      .mockReturnValueOnce(makeConfigRow('low'))
      .mockReturnValueOnce(makeConfigRow('true'))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeOpenTasksBuilder([]))
      .mockReturnValueOnce(makeExistingRefsBuilder([]))
      .mockReturnValueOnce(makeProposalInsertBuilder('prop-3'))
      .mockReturnValue(makeAgentEventsInsertBuilder())

    const summary = await runPreStage()

    expect(summary.new_proposals).toBe(1)
    expect(summary.auto_promoted).toBe(0)
  })
})

describe('runPreStage — dedup (AC-B3)', () => {
  it('skips proposals whose source_ref already exists in pending/promoted', async () => {
    mockFromFailures.mockResolvedValueOnce([
      {
        task: 'Resolve F-N102 — first',
        description: 'body',
        source_ref: 'F-N102',
        confidence: 0.9,
        risk_score: 10,
      },
      {
        task: 'Resolve F-N103 — second',
        description: 'body',
        source_ref: 'F-N103',
        confidence: 0.9,
        risk_score: 10,
      },
    ])

    mockFrom
      .mockReturnValueOnce(makeConfigRow('low'))
      .mockReturnValueOnce(makeConfigRow('true'))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeOpenTasksBuilder([]))
      // F-N102 already exists; F-N103 is new
      .mockReturnValueOnce(makeExistingRefsBuilder(['F-N102']))
      .mockReturnValueOnce(makeProposalInsertBuilder('prop-103'))
      .mockReturnValueOnce(makeTaskQueueInsertBuilder('task-103'))
      .mockReturnValueOnce(makeProposalUpdateBuilder())
      .mockReturnValue(makeAgentEventsInsertBuilder())

    const summary = await runPreStage()

    expect(summary.total_proposals_seen).toBe(2)
    expect(summary.new_proposals).toBe(1) // only F-N103 inserted
  })
})

describe('runPreStage — disabled sources', () => {
  it('skips a disabled source entirely', async () => {
    mockFromFailures.mockResolvedValueOnce([
      { task: 'X', description: '', source_ref: 'F-N200', confidence: 1, risk_score: 0 },
    ])

    mockFrom
      .mockReturnValueOnce(makeConfigRow('low'))
      .mockReturnValueOnce(makeConfigRow('false')) // failures_md DISABLED
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeOpenTasksBuilder([]))
      .mockReturnValue(makeAgentEventsInsertBuilder())

    const summary = await runPreStage()

    expect(mockFromFailures).not.toHaveBeenCalled()
    expect(summary.new_proposals).toBe(0)
    expect(summary.total_proposals_seen).toBe(0)
  })
})

describe('runPreStage — dry run', () => {
  it('reports counts without DB writes when dryRun=true', async () => {
    mockFromFailures.mockResolvedValueOnce([
      { task: 'X', description: '', source_ref: 'F-N300', confidence: 0.9, risk_score: 10 },
    ])

    mockFrom
      .mockReturnValueOnce(makeConfigRow('low'))
      .mockReturnValueOnce(makeConfigRow('true'))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeConfigRow(null))
      .mockReturnValueOnce(makeOpenTasksBuilder([]))
      .mockReturnValueOnce(makeExistingRefsBuilder([]))
    // No insert/update calls expected after this point in dry run

    const summary = await runPreStage({ dryRun: true })

    expect(summary.new_proposals).toBe(1)
    expect(summary.auto_promoted).toBe(1)
    // Only 8 mockFrom calls (no insert/update/heartbeat in dry run)
    expect(mockFrom.mock.calls.length).toBe(8)
  })
})
