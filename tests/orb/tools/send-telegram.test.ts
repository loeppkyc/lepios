/**
 * sendTelegramTool + queueTaskTool approval-gate tests.
 *
 * Verifies the dryRun=true default: the tool must preview without
 * touching the DB. Only dryRun: false actually inserts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSingle, mockInsert, mockSelect } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockSingle,
    }),
  })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { sendTelegramTool } from '@/lib/orb/tools/send-telegram'
import { queueTaskTool } from '@/lib/orb/tools/queue-task'

const CTX = { agentId: 'chat_ui' as const, conversationId: 'c', userId: 'u', toolCallId: 't' }

// ── sendTelegramTool ──────────────────────────────────────────────────────────

describe('sendTelegramTool — dryRun gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dryRun=true (default) returns preview without inserting to DB', async () => {
    const result = await sendTelegramTool.execute({ text: 'Hello Colin' }, CTX)
    expect(result).toMatchObject({ sent: false, preview: 'Hello Colin' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('dryRun=false inserts to outbound_notifications', async () => {
    mockSingle.mockResolvedValue({ data: { value: '123456789' }, error: null })
    const mockInsertChain = { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'notif-1' }, error: null }) }) }
    mockInsert.mockReturnValue(mockInsertChain)

    const result = await sendTelegramTool.execute({ text: 'Send this', dryRun: false }, CTX)
    expect(result).toMatchObject({ sent: true, preview: 'Send this', notification_id: 'notif-1' })
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('capability is an action capability', () => {
    expect(sendTelegramTool.capability).toContain('action')
  })
})

// ── queueTaskTool ─────────────────────────────────────────────────────────────

describe('queueTaskTool — dryRun gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dryRun=true (default) returns preview without inserting', async () => {
    const result = await queueTaskTool.execute({ task: 'Fix the bug' }, CTX)
    expect(result).toMatchObject({ queued: false, preview: { task: 'Fix the bug', priority: 3 } })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('dryRun=false inserts to task_queue', async () => {
    const mockInsertChain = { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'task-uuid-1' }, error: null }) }) }
    mockInsert.mockReturnValue(mockInsertChain)

    const result = await queueTaskTool.execute({ task: 'Fix the bug', dryRun: false }, CTX)
    expect(result).toMatchObject({ queued: true, task_id: 'task-uuid-1' })
    expect(mockInsert).toHaveBeenCalledOnce()
  })
})
