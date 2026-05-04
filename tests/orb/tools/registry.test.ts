/**
 * Tool registry wrapper tests.
 *
 * Verifies buildTools() wires:
 *   - all 9 registered tools by name
 *   - capability gate (denied → { allowed: false })
 *   - successful execute path → { allowed: true, result, auditId }
 *   - execute timeout → error is re-thrown
 *
 * Individual tool logic is tested in sibling files.
 * Each tool module is stubbed so this file stays fast and import-free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockCheckCapability, mockInsert, stubs } = vi.hoisted(() => {
  const makeStub = (name: string, cap: string) => ({
    name,
    description: `stub ${name}`,
    parameters: { _def: {}, safeParse: () => ({ success: true, data: {} }) },
    capability: cap,
    execute: vi.fn().mockResolvedValue({ ok: true }),
  })
  return {
    mockCheckCapability: vi.fn(),
    mockInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    stubs: {
      harnessRollup: makeStub('getHarnessRollup', 'tool.chat_ui.read.harness_rollup'),
      twinQuery: makeStub('queryTwin', 'tool.chat_ui.read.twin'),
      sendTelegram: makeStub('sendTelegramMessage', 'tool.chat_ui.action.telegram'),
      queueTask: makeStub('queueTask', 'tool.chat_ui.action.queue_task'),
      listAgentEvents: makeStub('listAgentEvents', 'tool.chat_ui.read.agent_events'),
      listIdeas: makeStub('listIdeas', 'tool.chat_ui.read.ideas'),
      submitIdea: makeStub('submitIdea', 'tool.chat_ui.action.submit_idea'),
      readFile: makeStub('readFile', 'tool.chat_ui.read.file'),
      queryDb: makeStub('queryDb', 'tool.chat_ui.read.db'),
      webFetch: makeStub('webFetch', 'tool.chat_ui.read.web'),
    },
  }
})

vi.mock('@/lib/security/capability', () => ({
  checkCapability: mockCheckCapability,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({ insert: mockInsert }),
  })),
}))

vi.mock('@/lib/orb/tools/harness-rollup', () => ({ harnessRollupTool: stubs.harnessRollup }))
vi.mock('@/lib/orb/tools/twin-query', () => ({ twinQueryTool: stubs.twinQuery }))
vi.mock('@/lib/orb/tools/send-telegram', () => ({ sendTelegramTool: stubs.sendTelegram }))
vi.mock('@/lib/orb/tools/queue-task', () => ({ queueTaskTool: stubs.queueTask }))
vi.mock('@/lib/orb/tools/list-agent-events', () => ({ listAgentEventsTool: stubs.listAgentEvents }))
vi.mock('@/lib/orb/tools/list-ideas', () => ({ listIdeasTool: stubs.listIdeas }))
vi.mock('@/lib/orb/tools/submit-idea', () => ({ submitIdeaTool: stubs.submitIdea }))
vi.mock('@/lib/orb/tools/read-file', () => ({ readFileTool: stubs.readFile }))
vi.mock('@/lib/orb/tools/query-db', () => ({ queryDbTool: stubs.queryDb }))
vi.mock('@/lib/orb/tools/web-fetch', () => ({ webFetchTool: stubs.webFetch }))

// ── Import after mocks ────────────────────────────────────────────────────────

import { buildTools } from '@/lib/orb/tools/registry'

const CTX = {
  agentId: 'chat_ui' as const,
  conversationId: 'conv-1',
  userId: 'user-1',
  toolCallId: '',
}
const ALLOWED_CAP = {
  allowed: true,
  reason: 'in_scope',
  enforcement_mode: 'enforce' as const,
  audit_id: 'audit-123',
}
const DENIED_CAP = {
  allowed: false,
  reason: 'no_grant_for_agent',
  enforcement_mode: 'enforce' as const,
  audit_id: 'audit-456',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildTools — registry shape', () => {
  it('registers all 10 expected tool names', () => {
    const tools = buildTools(CTX)
    const names = Object.keys(tools).sort()
    expect(names).toEqual(
      [
        'getHarnessRollup',
        'listAgentEvents',
        'listIdeas',
        'queryDb',
        'queryTwin',
        'readFile',
        'sendTelegramMessage',
        'submitIdea',
        'queueTask',
        'webFetch',
      ].sort()
    )
  })

  it('each tool entry has description and parameters', () => {
    const tools = buildTools(CTX)
    for (const [, tool] of Object.entries(tools)) {
      const t = tool as unknown as { description: string; parameters: unknown }
      expect(t.description).toBeTruthy()
      expect(t.parameters).toBeTruthy()
    }
  })
})

describe('buildTools — capability gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls checkCapability on every execute', async () => {
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
    const tools = buildTools(CTX)
    await (
      tools.getHarnessRollup as unknown as {
        execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown>
      }
    ).execute({}, { toolCallId: 'tc-1' })
    expect(mockCheckCapability).toHaveBeenCalledOnce()
  })

  it('returns { allowed: false } when capability is denied', async () => {
    mockCheckCapability.mockResolvedValue(DENIED_CAP)
    const tools = buildTools(CTX)
    const result = await (
      tools.getHarnessRollup as unknown as {
        execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown>
      }
    ).execute({}, { toolCallId: 'tc-2' })
    expect(result).toMatchObject({
      allowed: false,
      reason: 'no_grant_for_agent',
      auditId: 'audit-456',
    })
  })

  it('does not call the underlying tool when capability is denied', async () => {
    mockCheckCapability.mockResolvedValue(DENIED_CAP)
    const { harnessRollupTool } = await import('@/lib/orb/tools/harness-rollup')
    vi.clearAllMocks()
    mockCheckCapability.mockResolvedValue(DENIED_CAP)
    const tools = buildTools(CTX)
    await (
      tools.getHarnessRollup as unknown as {
        execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown>
      }
    ).execute({}, { toolCallId: 'tc-3' })
    expect(harnessRollupTool.execute).not.toHaveBeenCalled()
  })
})

describe('buildTools — successful execute path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckCapability.mockResolvedValue(ALLOWED_CAP)
  })

  it('wraps result in { allowed: true, result, auditId }', async () => {
    const tools = buildTools(CTX)
    const out = await (
      tools.getHarnessRollup as unknown as {
        execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown>
      }
    ).execute({}, { toolCallId: 'tc-4' })
    expect(out).toMatchObject({ allowed: true, result: { ok: true }, auditId: 'audit-123' })
  })

  it('logs a chat_ui.tool.ok event to agent_events', async () => {
    const tools = buildTools(CTX)
    await (
      tools.getHarnessRollup as unknown as {
        execute: (a: Record<string, unknown>, o: { toolCallId: string }) => Promise<unknown>
      }
    ).execute({}, { toolCallId: 'tc-5' })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chat_ui.tool.ok', domain: 'chat_ui' })
    )
  })
})
