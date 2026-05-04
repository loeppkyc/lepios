/**
 * Unit tests for submitIdeaTool.
 * Covers: dryRun default, dryRun true, dryRun false (success + error), tool metadata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { submitIdeaTool } from '@/lib/orb/tools/submit-idea'

function makeInsertBuilder(id: string | null, error: Error | null = null) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: id ? { id, status: 'parked' } : null, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitIdeaTool metadata', () => {
  it('has correct name and capability', () => {
    expect(submitIdeaTool.name).toBe('submitIdea')
    expect(submitIdeaTool.capability).toBe('tool.chat_ui.action.idea_inbox')
  })

  it('description mentions dryRun convention', () => {
    expect(submitIdeaTool.description).toContain('dryRun: true first')
  })
})

describe('submitIdeaTool execute', () => {
  it('returns preview without inserting when dryRun omitted (defaults true)', async () => {
    const result = await submitIdeaTool.execute({ title: 'Some idea' }, {} as never)
    expect(result.submitted).toBe(false)
    expect(result.preview.title).toBe('Some idea')
    expect(result.preview.score).toBe(0.5)
    expect(result.id).toBeUndefined()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns preview without inserting when dryRun: true', async () => {
    const result = await submitIdeaTool.execute(
      { title: 'Big idea', score: 0.8, tags: ['autonomy'], dryRun: true },
      {} as never,
    )
    expect(result.submitted).toBe(false)
    expect(result.preview.score).toBe(0.8)
    expect(result.preview.tags).toEqual(['autonomy'])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('inserts and returns submitted: true when dryRun: false', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('idea-uuid-1'))

    const result = await submitIdeaTool.execute(
      { title: 'Ship it', summary: 'do the thing', dryRun: false },
      {} as never,
    )
    expect(result.submitted).toBe(true)
    expect(result.id).toBe('idea-uuid-1')
    expect(result.status).toBe('parked')
    expect(result.preview.title).toBe('Ship it')
  })

  it('defaults score to 0.5 and tags to [] when not provided', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder('idea-uuid-2'))

    const result = await submitIdeaTool.execute({ title: 'Minimal', dryRun: false }, {} as never)
    expect(result.preview.score).toBe(0.5)
    expect(result.preview.tags).toEqual([])
  })

  it('throws when insert returns an error', async () => {
    mockFrom.mockReturnValueOnce(makeInsertBuilder(null, new Error('rls violation')))

    await expect(
      submitIdeaTool.execute({ title: 'Bad', dryRun: false }, {} as never),
    ).rejects.toThrow('rls violation')
  })
})
