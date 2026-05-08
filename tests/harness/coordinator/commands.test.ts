/**
 * Tests for coordinator Telegram command handlers.
 *
 * Verifies: task insertion, pickup trigger, queue status, halt/resume.
 * Uses fake Supabase client — no real DB calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: vi.fn(),
}))

const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

import { createServiceClient } from '@/lib/supabase/service'
import { postMessage } from '@/lib/orchestrator/telegram'
import {
  handleRunCommand,
  handleQueueAddCommand,
  handleQueueRunCommand,
  handleQueueStatusCommand,
  handleHaltCommand,
  handleResumeCommand,
} from '@/lib/harness/coordinator-commands'

// ── DB factory helpers ────────────────────────────────────────────────────────

function makeInsertDb(insertResult: {
  data: { id: string } | null
  error: null | { message: string }
}) {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => insertResult),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { value: 'test-secret' } })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [] })),
        count: 0,
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  }
}

function makeQueueStatusDb(rows: { status: string }[], halted = false) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'harness_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { value: halted ? 'true' : 'false' } })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        }
      }
      // task_queue
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: rows })),
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { value: 'test-secret' } })),
            count: rows.filter((r) => r.status === 'queued').length,
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'test-id' }, error: null })),
          })),
        })),
      }
    }),
  }
}

function makeHaltDb(updateError: null | { message: string }) {
  return {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: updateError })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { value: 'test-secret' } })),
        })),
      })),
    })),
  }
}

function makeQueueRunDb(queuedCount: number) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'harness_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { value: 'test-secret' } })),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            count: queuedCount,
          })),
        })),
      }
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleRunCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    vi.mocked(postMessage).mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  it('posts usage message when task is empty', async () => {
    await handleRunCommand('/run')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })

  it('posts usage message when task is whitespace', async () => {
    await handleRunCommand('/run   ')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })

  it('inserts task and posts confirmation on success', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeInsertDb({ data: { id: 'abc-123' }, error: null }) as never
    )
    await handleRunCommand('/run Fix the login bug')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('abc-123'))
  })

  it('posts DB error message when insert fails', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeInsertDb({ data: null, error: { message: 'insert failed' } }) as never
    )
    await handleRunCommand('/run Fix the login bug')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('DB error'))
  })
})

describe('handleQueueAddCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(postMessage).mockResolvedValue(undefined)
  })

  it('posts usage message when task is empty', async () => {
    await handleQueueAddCommand('/queue add')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })

  it('inserts task without triggering pickup', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeInsertDb({ data: { id: 'task-999' }, error: null }) as never
    )
    await handleQueueAddCommand('/queue add Port receipt scanner')
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Added to queue'))
    // fetch should NOT be called (no pickup trigger)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('handleQueueRunCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(postMessage).mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  it('posts empty-queue message when count is 0', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeQueueRunDb(0) as never)
    await handleQueueRunCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Queue is empty'))
  })
})

describe('handleQueueStatusCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(postMessage).mockResolvedValue(undefined)
  })

  it('includes queue counts in status reply', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeQueueStatusDb([
        { status: 'queued' },
        { status: 'queued' },
        { status: 'running' },
      ]) as never
    )
    await handleQueueStatusCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('Queue:'))
  })

  it('includes halted indicator when HARNESS_HALTED is true', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeQueueStatusDb([{ status: 'queued' }], true) as never
    )
    await handleQueueStatusCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('HALTED'))
  })
})

describe('handleHaltCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(postMessage).mockResolvedValue(undefined)
  })

  it('posts halt confirmation on success', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeHaltDb(null) as never)
    await handleHaltCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('halted'))
  })

  it('posts DB error message on failure', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeHaltDb({ message: 'update failed' }) as never
    )
    await handleHaltCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('DB error'))
  })
})

describe('handleResumeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(postMessage).mockResolvedValue(undefined)
  })

  it('posts resume confirmation on success', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeHaltDb(null) as never)
    await handleResumeCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('resumed'))
  })

  it('posts DB error message on failure', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeHaltDb({ message: 'update failed' }) as never
    )
    await handleResumeCommand()
    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(expect.stringContaining('DB error'))
  })
})
