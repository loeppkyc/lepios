/**
 * Unit tests for queueTaskTool.
 * Covers: dryRun default, explicit dryRun true, dryRun false (success + error),
 *         priority defaulting, tool metadata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { queueTaskTool } from '@/lib/orb/tools/queue-task'

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

describe('queueTaskTool metadata', () => {
  it('has correct name and capability', () => {
    expect(queueTaskTool.name).toBe('queueTask')
    expect(queueTaskTool.capability).toBe('tool.chat_ui.action.queue_task')
  })

  it('description mentions dryRun convention', () => {
    expect(queueTaskTool.description).toContain('dryRun: true first')
  })
})

describe('queueTaskTool execute', () => {
  it('returns preview without queuing when dryRun is omitted (defaults true)', async () => {
    const result = await queueTaskTool.execute({ task: 'Fix thing' }, {} as never)
    expect(result.queued).toBe(false)
    expect(result.preview.task).toBe('Fix thing')
    expect(result.preview.priority).toBe(3)
    expect(result.task_id).toBeUndefined()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns preview without queuing when dryRun: true', async () => {
    const result = await queueTaskTool.execute(
      { task: 'Do something', priority: 1, dryRun: true },
      {} as never,
    )
    expect(result.queued).toBe(false)
    expect(result.preview.priority).toBe(1)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('inserts task and returns queued: true when dryRun: false', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('task-uuid-1'))

    const result = await queueTaskTool.execute(
      { task: 'Ship it', description: 'details here', priority: 2, dryRun: false },
      {} as never,
    )
    expect(result.queued).toBe(true)
    expect(result.task_id).toBe('task-uuid-1')
    expect(result.preview.task).toBe('Ship it')
    expect(result.preview.description).toBe('details here')
    expect(result.preview.priority).toBe(2)
  })

  it('defaults priority to 3 when not provided and dryRun: false', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('task-uuid-2'))

    const result = await queueTaskTool.execute({ task: 'Default prio', dryRun: false }, {} as never)
    expect(result.preview.priority).toBe(3)
    expect(result.queued).toBe(true)
  })

  it('throws when insert returns an error', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder(null, new Error('constraint violation')))

    await expect(
      queueTaskTool.execute({ task: 'Bad task', dryRun: false }, {} as never),
    ).rejects.toThrow('constraint violation')
  })
})
