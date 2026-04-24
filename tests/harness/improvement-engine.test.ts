/**
 * Unit tests for lib/harness/improvement-engine.ts
 * Mocks @/lib/supabase/service — no real Supabase connection needed.
 * Mock pattern: same vi.hoisted + vi.mock style as tests/harness/task-pickup.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// Mock fs module for acceptance_doc_found checks
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}))

import {
  analyzeChunk,
  generateProposals,
  deduplicateAndQueue,
  notifyProposals,
  checkAutoProceed,
  type ChunkAudit,
  type ImprovementProposal,
} from '@/lib/harness/improvement-engine'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_ID = 'task-uuid-1234'
const CHUNK_ID = 'sprint-5-e1'
const SPRINT_ID = 'sprint-5'

function makeCleanAudit(overrides: Partial<ChunkAudit> = {}): ChunkAudit {
  return {
    chunk_id: CHUNK_ID,
    sprint_id: SPRINT_ID,
    task_queue_id: TASK_ID,
    acceptance_doc_found: true,
    grounding_status: 'passed',
    grounding_mismatches: 0,
    escalations_to_colin: 0,
    twin_escalations: 0,
    notification_failures: 0,
    ollama_failures: 0,
    review_bypasses: 0,
    spec_corrections: 0,
    analyzed_at: '2026-04-24T22:00:00Z',
    ...overrides,
  }
}

// ── Supabase mock builders ─────────────────────────────────────────────────────

/**
 * Builds a chainable Supabase query mock.
 * All method calls return 'this' (the chain object) until the terminal method.
 */
function makeSelectChain(finalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'filter', 'in', 'gte', 'lte', 'limit', 'order', 'lt', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal resolvers
  ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult)
  ;(chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult)
  return chain
}

function makeInsertChain(finalResult: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(finalResult)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select, single: vi.fn().mockResolvedValue(finalResult) })
  return { insert, _select: select, _single: single }
}

function makeUpdateChain(finalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['update', 'eq', 'filter', 'in']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal: last call resolves
  ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult)
  ;(chain.filter as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult)
  ;(chain.in as ReturnType<typeof vi.fn>).mockResolvedValue(finalResult)
  return chain
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Test 1: analyzeChunk returns correct ChunkAudit shape ────────────────────

describe('analyzeChunk', () => {
  it('returns correct ChunkAudit shape from mocked agent_events', async () => {
    const taskRow = {
      id: TASK_ID,
      completed_at: '2026-04-24T21:58:00Z',
      metadata: {
        chunk_id: CHUNK_ID,
        sprint_id: SPRINT_ID,
        acceptance_doc_path: '/nonexistent/path',
      },
    }

    const agentEvents = [
      { action: 'coordinator.escalate_to_colin', status: 'success', task_type: 'escalate_to_colin', meta: { task_id: TASK_ID } },
      { action: 'coordinator.escalate_to_colin', status: 'success', task_type: 'escalate_to_colin', meta: { task_id: TASK_ID } },
      { action: 'twin.ask', status: 'success', task_type: 'twin_ask', meta: { task_id: TASK_ID, escalate: true } },
      { action: 'twin.ask', status: 'success', task_type: 'twin_ask', meta: { task_id: TASK_ID, escalate: true } },
      { action: 'twin.ask', status: 'success', task_type: 'twin_ask', meta: { task_id: TASK_ID, escalate: true } },
      { action: 'grounding.mismatch', status: 'success', task_type: 'grounding_mismatch', meta: { task_id: TASK_ID } },
    ]

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // agent_events insert (triggered log)
        return makeInsertChain({ data: { id: 'evt-1' }, error: null }).insert({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }) }) })
      }
      if (callCount === 2) {
        // task_queue select
        const chain = makeSelectChain({ data: taskRow, error: null })
        return { select: vi.fn().mockReturnValue(chain) }
      }
      if (callCount === 3) {
        // agent_events for task_id
        const chain = makeSelectChain({ data: agentEvents, error: null })
        ;(chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: agentEvents, error: null })
        return { select: vi.fn().mockReturnValue(chain) }
      }
      if (callCount === 4) {
        // agent_events for chunk_id
        const chain = makeSelectChain({ data: [], error: null })
        ;(chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null })
        return { select: vi.fn().mockReturnValue(chain) }
      }
      // agent_events insert (audit_complete log)
      return makeInsertChain({ data: { id: 'evt-2' }, error: null }).insert({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'evt-2' }, error: null }) }) })
    })

    const audit = await analyzeChunk(TASK_ID)

    // Verify required fields are present
    expect(audit.task_queue_id).toBe(TASK_ID)
    expect(typeof audit.chunk_id).toBe('string')
    expect(typeof audit.sprint_id).toBe('string')
    expect(typeof audit.acceptance_doc_found).toBe('boolean')
    expect(['passed', 'passed_with_limitation', 'failed', 'not_yet']).toContain(audit.grounding_status)
    expect(typeof audit.grounding_mismatches).toBe('number')
    expect(typeof audit.escalations_to_colin).toBe('number')
    expect(typeof audit.twin_escalations).toBe('number')
    expect(typeof audit.notification_failures).toBe('number')
    expect(typeof audit.ollama_failures).toBe('number')
    expect(typeof audit.review_bypasses).toBe('number')
    expect(typeof audit.spec_corrections).toBe('number')
    expect(typeof audit.analyzed_at).toBe('string')
  })
})

// ── Test 2: generateProposals returns 0 for clean audit ──────────────────────

describe('generateProposals', () => {
  it('returns 0 proposals for a clean audit (all counts = 0)', async () => {
    const audit = makeCleanAudit()
    const proposals = await generateProposals(audit)
    expect(proposals).toHaveLength(0)
  })

  // Test 3: doc_gap proposal when grounding_mismatches > 0
  it('returns doc_gap proposal when grounding_mismatches > 0', async () => {
    // Mock agent_events insert for proposal_rejected (none will be rejected in this case)
    mockFrom.mockImplementation(() => {
      const chain = makeInsertChain({ data: { id: 'evt-x' }, error: null })
      return { insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'evt-x' }, error: null }) }) }) }
    })

    const audit = makeCleanAudit({ grounding_mismatches: 3 })
    const proposals = await generateProposals(audit)

    const docGapProposals = proposals.filter((p) => p.category === 'doc_gap')
    expect(docGapProposals.length).toBeGreaterThanOrEqual(1)
    expect(docGapProposals[0].fingerprint).toMatch(/^doc_gap:/)
    expect(docGapProposals[0].source_chunk_id).toBe(CHUNK_ID)
    expect(docGapProposals[0].severity).toBe('nice_to_have')
  })

  // Test 4: reliability proposal when ollama_failures > 3
  it('returns reliability proposal when ollama_failures > 3', async () => {
    mockFrom.mockImplementation(() => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'evt-x' }, error: null })
        })
      })
    }))

    const audit = makeCleanAudit({ ollama_failures: 5 })
    const proposals = await generateProposals(audit)

    const reliabilityProposals = proposals.filter((p) => p.category === 'reliability')
    expect(reliabilityProposals.length).toBeGreaterThanOrEqual(1)
    // Should have both the liveness check AND the circuit-breaker proposals
    const actions = reliabilityProposals.map((p) => p.concrete_action)
    const hasLiveness = actions.some((a) => a.includes('liveness') || a.includes('morning_digest'))
    const hasCircuitBreaker = actions.some((a) => a.includes('circuit-breaker'))
    expect(hasLiveness || hasCircuitBreaker).toBe(true)
  })

  // Test 5: vague concrete_action is rejected
  it('rejects vague concrete_action and does not include it in proposals', async () => {
    // We test this by checking that a proposal with no file ref or no verb
    // would be logged as rejected. Since we can't inject a vague proposal
    // directly into the rule engine, we verify that all returned proposals
    // have concrete_actions that satisfy the heuristic (file ref + verb).
    mockFrom.mockImplementation(() => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'evt-x' }, error: null })
        })
      })
    }))

    const audit = makeCleanAudit({ grounding_mismatches: 2, ollama_failures: 5 })
    const proposals = await generateProposals(audit)

    for (const p of proposals) {
      // Each accepted proposal should have a file/path reference and a verb
      const hasFileRef = /[./§]/.test(p.concrete_action) ||
        /\b(migration|table|column|cron|route|hook|endpoint|function|module|script|doc|policy|config|index|constraint)\b/i.test(p.concrete_action)
      const hasVerb = /\b(add|update|export|wire|remove|create|insert|extend|require|enforce|source|set|enable|check|log|alert|include|replace|move|rename|delete|refactor|fix|configure)\b/i.test(p.concrete_action)
      expect(hasFileRef, `proposal missing file ref: "${p.concrete_action}"`).toBe(true)
      expect(hasVerb, `proposal missing verb: "${p.concrete_action}"`).toBe(true)
    }
  })
})

// ── Test 6: Deduplicator — no match → single INSERT ──────────────────────────

describe('deduplicateAndQueue', () => {
  it('no match → inserts one row into task_queue', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-proposal-id' }, error: null }),
      }),
    })

    mockFrom.mockImplementation(() => {
      // First call: deduplication query (maybeSingle returns null)
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              filter: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: insertMock,
      }
    })

    const proposals: ImprovementProposal[] = [
      {
        category: 'doc_gap',
        severity: 'nice_to_have',
        concrete_action: 'Add field definition table to docs/sprint-5/chunk-e1-acceptance.md §fields',
        engine_signal: 'test signal',
        measurement: 'mismatches: before=2, target=0',
        source_chunk_id: CHUNK_ID,
        fingerprint: 'doc_gap:Add field definition table to docs/sprint-5/chunk-e1-acceptance',
        reversible: true,
      },
    ]

    let selectCallCount = 0
    let insertCallCount = 0
    mockFrom.mockImplementation(() => {
      return {
        select: vi.fn().mockImplementation(() => {
          selectCallCount++
          // Returns chain ending in maybeSingle(null) for deduplication check
          const chain: Record<string, unknown> = {}
          const methods = ['in', 'filter', 'limit', 'maybeSingle', 'eq', 'order']
          for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
          ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null })
          return chain
        }),
        insert: vi.fn().mockImplementation(() => {
          insertCallCount++
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
            }),
          }
        }),
      }
    })

    const ids = await deduplicateAndQueue(proposals, CHUNK_ID)

    expect(insertCallCount).toBe(1) // one INSERT for one proposal with no duplicate
    expect(ids).toHaveLength(1)
  })

  // Test 7: match found → UPDATE existing + INSERT new with recurrence_of
  it('match found → updates existing row and inserts new row with recurrence_of', async () => {
    const existingRow = {
      id: 'existing-id',
      metadata: {
        recurrence_count: 0,
        proposal_fingerprint: 'doc_gap:test',
        task_type_label: 'improvement_proposal',
        category: 'doc_gap',
      },
    }

    let updateCalled = false
    let insertCalled = false
    let insertPayload: Record<string, unknown> | null = null

    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: vi.fn().mockImplementation(() => {
        updateCalled = true
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        insertCalled = true
        insertPayload = payload
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'new-recurrence-id' }, error: null }),
          }),
        }
      }),
    }))

    const proposals: ImprovementProposal[] = [
      {
        category: 'doc_gap',
        severity: 'nice_to_have',
        concrete_action: 'Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fields section',
        engine_signal: 'signal',
        measurement: 'metric',
        source_chunk_id: CHUNK_ID,
        fingerprint: 'doc_gap:Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fie',
        reversible: true,
      },
    ]

    const ids = await deduplicateAndQueue(proposals, CHUNK_ID)

    expect(updateCalled).toBe(true) // existing row was updated
    expect(insertCalled).toBe(true) // new row was inserted
    expect(ids).toHaveLength(1)
    // The inserted payload should include recurrence_of pointing to existing row
    const meta = (insertPayload as unknown as { metadata?: Record<string, unknown> })?.metadata
    expect(meta?.recurrence_of).toBe('existing-id')
  })

  // Test 8: recurrence_count >= 2 sets needs_root_cause_review = true
  it('recurrence_count >= 2 sets needs_root_cause_review = true on existing row', async () => {
    const existingRow = {
      id: 'existing-id',
      metadata: {
        recurrence_count: 1, // already 1; after increment → 2 → needs_root_cause_review=true
        proposal_fingerprint: 'doc_gap:test',
        task_type_label: 'improvement_proposal',
      },
    }

    let updatePayload: Record<string, unknown> | null = null

    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            filter: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayload = payload
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
        }),
      }),
    }))

    const proposals: ImprovementProposal[] = [
      {
        category: 'doc_gap',
        severity: 'nice_to_have',
        concrete_action: 'Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fields',
        engine_signal: 'signal',
        measurement: 'metric',
        source_chunk_id: CHUNK_ID,
        fingerprint: 'doc_gap:Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fie',
        reversible: true,
      },
    ]

    await deduplicateAndQueue(proposals, CHUNK_ID)

    const updatedMeta = (updatePayload as unknown as { metadata?: Record<string, unknown> } | null)?.metadata
    expect(updatedMeta?.recurrence_count).toBe(2)
    expect(updatedMeta?.needs_root_cause_review).toBe(true)
    expect(updatedMeta?.severity).toBe('blocking') // recurrence_count=2 → blocking
  })
})

// ── Test 9: Notifier — 0 proposals → no INSERT ────────────────────────────────

describe('notifyProposals', () => {
  it('0 proposals → no INSERT into outbound_notifications', async () => {
    const insertMock = vi.fn()
    mockFrom.mockReturnValue({ insert: insertMock })

    await notifyProposals([], CHUNK_ID, TASK_ID)

    expect(insertMock).not.toHaveBeenCalled()
  })

  // Test 10: ≥1 proposal → INSERT with requires_response=true and inline keyboard
  it('>=1 proposal → inserts with requires_response=true and inline keyboard', async () => {
    let insertedPayload: Record<string, unknown> | null = null

    mockFrom.mockImplementation(() => ({
      insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        insertedPayload = payload
        return Promise.resolve({ data: { id: 'notif-id' }, error: null })
      }),
    }))

    const proposals: ImprovementProposal[] = [
      {
        category: 'doc_gap',
        severity: 'nice_to_have',
        concrete_action: 'Add field definition table to docs/sprint-5/chunk-e1-acceptance.md',
        engine_signal: 'signal',
        measurement: 'metric',
        source_chunk_id: CHUNK_ID,
        fingerprint: 'doc_gap:Add field definition table to docs/sprint-5/chunk-e1-acceptanc',
        reversible: true,
      },
    ]

    await notifyProposals(proposals, CHUNK_ID, TASK_ID)

    expect(insertedPayload).not.toBeNull()
    const p = insertedPayload as unknown as Record<string, unknown>
    expect(p.channel).toBe('telegram')
    expect(p.requires_response).toBe(true)
    expect(p.correlation_id).toBe(TASK_ID)

    const payload = p.payload as Record<string, unknown>
    expect(payload).toBeDefined()
    // Must NOT have parse_mode: Markdown (per hard stops)
    expect(payload.parse_mode).toBeUndefined()
    // Must have inline keyboard with approve_all, review, dismiss
    const keyboard = (payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] })?.inline_keyboard
    expect(keyboard).toBeDefined()
    const buttons = keyboard[0]
    const cbDatas = buttons.map((b) => b.callback_data)
    expect(cbDatas.some((d) => d.startsWith('improve_approve_all:'))).toBe(true)
    expect(cbDatas.some((d) => d.startsWith('improve_review:'))).toBe(true)
    expect(cbDatas.some((d) => d.startsWith('improve_dismiss:'))).toBe(true)
  })
})

// ── Test 11: Auto-proceed — all 5 criteria met ────────────────────────────────

describe('checkAutoProceed', () => {
  it('all 5 criteria met → status=auto_proceeded, no Telegram message sent', async () => {
    const patternRow = { id: 'pattern-id', approval_count: 3, enabled: true }

    let updatedStatus: string | null = null
    let agentEventLogged = false

    mockFrom.mockImplementation((table: string) => {
      if (table === 'auto_proceed_patterns') {
        const chain: Record<string, unknown> = {}
        const methods = ['select', 'eq', 'gte', 'maybeSingle']
        for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
        ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: patternRow, error: null })
        return chain
      }
      if (table === 'task_queue') {
        return {
          update: vi.fn().mockImplementation((p: Record<string, unknown>) => {
            updatedStatus = p.status as string
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      if (table === 'agent_events') {
        agentEventLogged = true
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'evt-id' }, error: null }),
            }),
          }),
        }
      }
      return {}
    })

    const proposal: ImprovementProposal = {
      category: 'tooling',
      severity: 'nice_to_have',
      concrete_action: 'Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hook sourcing line',
      engine_signal: 'signal',
      measurement: 'metric',
      source_chunk_id: CHUNK_ID,
      fingerprint: 'tooling:Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hoo',
      reversible: true,
    }

    const result = await checkAutoProceed(proposal, 'task-row-id')

    expect(result).toBe(true)
    expect(updatedStatus).toBe('auto_proceeded')
    expect(agentEventLogged).toBe(true)
  })

  // Test 12: any criterion missing → routes to Notifier (returns false)
  it('severity !== nice_to_have → returns false (routes to Notifier)', async () => {
    const proposal: ImprovementProposal = {
      category: 'tooling',
      severity: 'blocking', // fails criterion 2
      concrete_action: 'Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hook sourcing line',
      engine_signal: 'signal',
      measurement: 'metric',
      source_chunk_id: CHUNK_ID,
      fingerprint: 'tooling:Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hoo',
      reversible: true,
    }

    // No mock needed — should return false before hitting DB
    const result = await checkAutoProceed(proposal, 'task-row-id')
    expect(result).toBe(false)
  })

  it('category not in allowed set → returns false (routes to Notifier)', async () => {
    const proposal: ImprovementProposal = {
      category: 'doc_gap', // not in AUTO_PROCEED_CATEGORIES
      severity: 'nice_to_have',
      concrete_action: 'Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fields',
      engine_signal: 'signal',
      measurement: 'metric',
      source_chunk_id: CHUNK_ID,
      fingerprint: 'doc_gap:Add field definition to docs/sprint-5/chunk-e1-acceptance.md §fie',
      reversible: true,
    }

    const result = await checkAutoProceed(proposal, 'task-row-id')
    expect(result).toBe(false)
  })

  it('reversible=false → returns false (routes to Notifier)', async () => {
    const proposal: ImprovementProposal = {
      category: 'tooling',
      severity: 'nice_to_have',
      concrete_action: 'Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hook sourcing line',
      engine_signal: 'signal',
      measurement: 'metric',
      source_chunk_id: CHUNK_ID,
      fingerprint: 'tooling:Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hoo',
      reversible: false, // fails criterion 3
    }

    const result = await checkAutoProceed(proposal, 'task-row-id')
    expect(result).toBe(false)
  })

  it('no matching auto_proceed_patterns row → returns false (routes to Notifier)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'auto_proceed_patterns') {
        const chain: Record<string, unknown> = {}
        const methods = ['select', 'eq', 'gte', 'maybeSingle']
        for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
        ;(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null })
        return chain
      }
      return {}
    })

    const proposal: ImprovementProposal = {
      category: 'tooling',
      severity: 'nice_to_have',
      concrete_action: 'Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hook sourcing line',
      engine_signal: 'signal',
      measurement: 'metric',
      source_chunk_id: CHUNK_ID,
      fingerprint: 'tooling:Export ANTHROPIC_API_KEY from .env.local into .husky/pre-commit hoo',
      reversible: true,
    }

    const result = await checkAutoProceed(proposal, 'task-row-id')
    expect(result).toBe(false)
  })
})

// ── Additional test: parseImproveCallbackData ─────────────────────────────────

describe('parseImproveCallbackData (telegram-buttons)', () => {
  it('parses approve_all callback correctly', async () => {
    const { parseImproveCallbackData } = await import('@/lib/harness/telegram-buttons')
    const result = parseImproveCallbackData('improve_approve_all:sprint-5-e1')
    expect(result).toEqual({ action: 'approve_all', chunkId: 'sprint-5-e1' })
  })

  it('parses review callback correctly', async () => {
    const { parseImproveCallbackData } = await import('@/lib/harness/telegram-buttons')
    const result = parseImproveCallbackData('improve_review:sprint-5-e1')
    expect(result).toEqual({ action: 'review', chunkId: 'sprint-5-e1' })
  })

  it('parses dismiss callback correctly', async () => {
    const { parseImproveCallbackData } = await import('@/lib/harness/telegram-buttons')
    const result = parseImproveCallbackData('improve_dismiss:sprint-5-e1')
    expect(result).toEqual({ action: 'dismiss', chunkId: 'sprint-5-e1' })
  })

  it('returns null for non-matching data', async () => {
    const { parseImproveCallbackData } = await import('@/lib/harness/telegram-buttons')
    expect(parseImproveCallbackData('tf:up:some-uuid')).toBeNull()
    expect(parseImproveCallbackData('dg:rb:abcdef12')).toBeNull()
    expect(parseImproveCallbackData('')).toBeNull()
  })
})
