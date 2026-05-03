/**
 * chat_ui Slice 1 acceptance tests.
 *
 * Covers: AC-B (registry + types), AC-C (cap-check fires), AC-C.1 (agent_events outcome),
 *         AC-D (tool result shape), AC-D.1 (30s timeout), AC-F (denied path, no throw).
 *
 * AC-E (LLM integration) and AC-G (production smoke) are manual / E2E.
 *
 * Spec: docs/harness/CHAT_UI_SPEC.md §Slice 1 acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockCheckCapability,
  mockInsert,
  mockComputeHarnessRollup,
} = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
  mockInsert: vi.fn().mockResolvedValue({ error: null }),
  mockComputeHarnessRollup: vi.fn(),
}))

vi.mock('@/lib/security/capability', () => ({
  checkCapability: mockCheckCapability,
  requireCapability: mockCheckCapability,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: mockInsert })),
  })),
}))

vi.mock('@/lib/harness/rollup', () => ({
  computeHarnessRollup: mockComputeHarnessRollup,
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  buildTools,
  TOOL_TIMEOUT_MS,
  type ChatToolContext,
  type ChatToolResult,
} from '@/lib/orb/tools/registry'
import { harnessRollupTool } from '@/lib/orb/tools/harness-rollup'

const BASE_CTX: ChatToolContext = {
  agentId: 'chat_ui',
  conversationId: 'conv-test-123',
  userId: 'user-test-456',
  toolCallId: '',
}

const ALLOWED_CAP = {
  allowed: true,
  reason: 'in_scope',
  enforcement_mode: 'log_only' as const,
  audit_id: 'audit-abc-123',
}

const DENIED_CAP = {
  allowed: false,
  reason: 'no_grant_for_agent',
  enforcement_mode: 'enforce' as const,
  audit_id: 'audit-denied-456',
}

const ROLLUP_FIXTURE = {
  rollup_pct: 74.13,
  components: Array.from({ length: 21 }, (_, i) => ({
    id: `harness:component_${i}`,
    display_name: `Component ${i}`,
    weight_pct: 4,
    completion_pct: 80,
  })),
  complete_count: 12,
  total_count: 21,
  points_remaining: 26.0,
  computed_at: '2026-05-03T22:00:00.000Z',
}

afterEach(() => {
  vi.clearAllMocks()
})

// ── AC-B: registry exports + types ───────────────────────────────────────────

describe('AC-B: tool registry exports', () => {
  it('buildTools returns a record keyed by tool name', () => {
    const tools = buildTools(BASE_CTX)
    expect(tools).toHaveProperty('getHarnessRollup')
    expect(typeof tools['getHarnessRollup']).toBe('object')
  })

  it('harnessRollupTool has expected name and capability', () => {
    expect(harnessRollupTool.name).toBe('getHarnessRollup')
    expect(harnessRollupTool.capability).toBe('tool.chat_ui.read.harness_rollup')
  })

  it('TOOL_TIMEOUT_MS is 30_000', () => {
    expect(TOOL_TIMEOUT_MS).toBe(30_000)
  })
})

// ── AC-C: cap-check fires on allowed path ─────────────────────────────────────

describe('AC-C: cap-check fires (allowed)', () => {
  beforeEach(() => {
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
    mockComputeHarnessRollup.mockResolvedValue(ROLLUP_FIXTURE)
    mockInsert.mockResolvedValue({ error: null })
  })

  it('calls checkCapability with correct agentId and capability', async () => {
    const tools = buildTools(BASE_CTX)
    const toolCallId = 'call-xyz-789'
    // @ts-expect-error — execute is typed as the SDK expects, but we call it directly in tests
    await tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId })

    expect(mockCheckCapability).toHaveBeenCalledWith({
      agentId: 'chat_ui',
      capability: 'tool.chat_ui.read.harness_rollup',
      context: { sessionId: BASE_CTX.conversationId, reason: 'getHarnessRollup' },
    })
  })
})

// ── AC-C.1: agent_events outcome row ─────────────────────────────────────────

describe('AC-C.1: agent_events outcome row (ok)', () => {
  beforeEach(() => {
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
    mockComputeHarnessRollup.mockResolvedValue(ROLLUP_FIXTURE)
    mockInsert.mockResolvedValue({ error: null })
  })

  it('inserts chat_ui.tool.ok event after successful execute', async () => {
    const tools = buildTools(BASE_CTX)
    const toolCallId = 'call-ok-001'
    // @ts-expect-error
    await tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'chat_ui',
        action: 'chat_ui.tool.ok',
        actor: 'chat_ui',
        meta: expect.objectContaining({
          tool: 'getHarnessRollup',
          correlation_id: ALLOWED_CAP.audit_id,
          conversation_id: BASE_CTX.conversationId,
          tool_call_id: toolCallId,
        }),
      }),
    )
  })
})

// ── AC-D: tool result shape ────────────────────────────────────────────────────

describe('AC-D: tool result shape', () => {
  beforeEach(() => {
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
    mockComputeHarnessRollup.mockResolvedValue(ROLLUP_FIXTURE)
    mockInsert.mockResolvedValue({ error: null })
  })

  it('returns allowed:true with rollupPct from computeHarnessRollup', async () => {
    const tools = buildTools(BASE_CTX)
    // @ts-expect-error
    const result = (await tools['getHarnessRollup'].execute(
      { tier: 'all' },
      { toolCallId: 'call-d-001' },
    )) as ChatToolResult<{ rollupPct: number }>

    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.result.rollupPct).toBe(ROLLUP_FIXTURE.rollup_pct)
      expect(result.auditId).toBe(ALLOWED_CAP.audit_id)
    }
  })

  it('returns componentCount matching fixture', async () => {
    const tools = buildTools(BASE_CTX)
    // @ts-expect-error
    const result = (await tools['getHarnessRollup'].execute(
      {},
      { toolCallId: 'call-d-002' },
    )) as ChatToolResult<{ componentCount: number }>

    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.result.componentCount).toBe(ROLLUP_FIXTURE.components.length)
    }
  })
})

// ── AC-D.1: 30s timeout ───────────────────────────────────────────────────────

describe('AC-D.1: tool timeout', () => {
  beforeEach(() => {
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
    mockInsert.mockResolvedValue({ error: null })
  })

  it('rejects after TOOL_TIMEOUT_MS when execute hangs', async () => {
    // Override harnessRollupTool's execute to hang
    mockComputeHarnessRollup.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, TOOL_TIMEOUT_MS + 5_000)),
    )

    const tools = buildTools(BASE_CTX)
    const t0 = Date.now()

    await expect(
      // @ts-expect-error
      tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId: 'call-timeout-001' }),
    ).rejects.toThrow()

    const elapsed = Date.now() - t0
    // Should reject at ~30s, not at 35s (the mock's sleep)
    expect(elapsed).toBeLessThan(TOOL_TIMEOUT_MS + 2_000)
  }, TOOL_TIMEOUT_MS + 5_000)

  it('writes chat_ui.tool.timeout event on timeout', async () => {
    mockComputeHarnessRollup.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, TOOL_TIMEOUT_MS + 5_000)),
    )

    const tools = buildTools(BASE_CTX)
    await expect(
      // @ts-expect-error
      tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId: 'call-timeout-002' }),
    ).rejects.toThrow()

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chat_ui.tool.timeout' }),
    )
  }, TOOL_TIMEOUT_MS + 5_000)
})

// ── AC-F: denied path — structured error, no throw ───────────────────────────

describe('AC-F: denied path', () => {
  beforeEach(() => {
    mockCheckCapability.mockResolvedValue(DENIED_CAP)
    mockInsert.mockResolvedValue({ error: null })
  })

  it('returns allowed:false with reason and auditId', async () => {
    const tools = buildTools(BASE_CTX)
    // @ts-expect-error
    const result = (await tools['getHarnessRollup'].execute(
      { tier: 'all' },
      { toolCallId: 'call-denied-001' },
    )) as ChatToolResult<never>

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe(DENIED_CAP.reason)
      expect(result.auditId).toBe(DENIED_CAP.audit_id)
    }
  })

  it('does NOT call computeHarnessRollup when denied', async () => {
    const tools = buildTools(BASE_CTX)
    // @ts-expect-error
    await tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId: 'call-denied-002' })
    expect(mockComputeHarnessRollup).not.toHaveBeenCalled()
  })

  it('does NOT insert an agent_events outcome row when denied', async () => {
    const tools = buildTools(BASE_CTX)
    // @ts-expect-error
    await tools['getHarnessRollup'].execute({ tier: 'all' }, { toolCallId: 'call-denied-003' })
    // logToolEvent is only called on execute success/error/timeout, not on deny
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
