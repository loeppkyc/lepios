/**
 * Unit tests for sendTelegramTool.
 * Covers: dryRun default, explicit dryRun true, dryRun false (success + error),
 *         tool metadata, chat_id lookup failure (graceful).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { sendTelegramTool } from '@/lib/orb/tools/send-telegram'

function makeHarnessConfigBuilder(value: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: value ? { value } : null, error: null }),
  }
}

function makeInsertBuilder(id: string | null, error: Error | null = null) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: id ? { id } : null, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendTelegramTool metadata', () => {
  it('has correct name and capability', () => {
    expect(sendTelegramTool.name).toBe('sendTelegramMessage')
    expect(sendTelegramTool.capability).toBe('tool.chat_ui.action.telegram')
  })

  it('description mentions dryRun convention', () => {
    expect(sendTelegramTool.description).toContain('dryRun: true first')
  })
})

describe('sendTelegramTool execute', () => {
  it('returns preview without sending when dryRun is omitted (defaults true)', async () => {
    const result = await sendTelegramTool.execute({ text: 'hello colin' }, {} as never)
    expect(result.sent).toBe(false)
    expect(result.preview).toBe('hello colin')
    expect(result.notification_id).toBeUndefined()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns preview without sending when dryRun: true', async () => {
    const result = await sendTelegramTool.execute({ text: 'test', dryRun: true }, {} as never)
    expect(result.sent).toBe(false)
    expect(result.preview).toBe('test')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('inserts notification and returns sent: true when dryRun: false', async () => {
    mockFrom
      .mockReturnValueOnce(makeHarnessConfigBuilder('123456789')) // harness_config
      .mockReturnValueOnce(makeInsertBuilder('notif-uuid-1'))     // outbound_notifications

    const result = await sendTelegramTool.execute({ text: 'go go go', dryRun: false }, {} as never)
    expect(result.sent).toBe(true)
    expect(result.preview).toBe('go go go')
    expect(result.notification_id).toBe('notif-uuid-1')
  })

  it('inserts without chat_id when harness_config lookup returns null', async () => {
    mockFrom
      .mockReturnValueOnce(makeHarnessConfigBuilder(null)) // no chat_id
      .mockReturnValueOnce(makeInsertBuilder('notif-uuid-2'))

    const result = await sendTelegramTool.execute({ text: 'msg', dryRun: false }, {} as never)
    expect(result.sent).toBe(true)
    expect(result.notification_id).toBe('notif-uuid-2')
  })

  it('throws when insert returns an error', async () => {
    mockFrom
      .mockReturnValueOnce(makeHarnessConfigBuilder('123'))
      .mockReturnValueOnce(makeInsertBuilder(null, new Error('db down')))

    await expect(
      sendTelegramTool.execute({ text: 'fail', dryRun: false }, {} as never),
    ).rejects.toThrow('db down')
  })
})
