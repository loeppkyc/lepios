import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase service client mock ───────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  startWindowSession,
  heartbeatWindow,
  endWindowSession,
  getActiveSessions,
} from '../../lib/harness/window-tracker'

// ── Chain builder ──────────────────────────────────────────────────────────
function makeChain(result: unknown = { data: [], error: null }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'gte', 'order', 'update', 'upsert']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // terminal — resolves with result
  chain['then'] = (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── startWindowSession ─────────────────────────────────────────────────────

describe('startWindowSession', () => {
  it('calls upsert on window_sessions with active status', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await startWindowSession('sess-1', 'Phase 1a study', { role: 'coordinator' })

    expect(mockFrom).toHaveBeenCalledWith('window_sessions')
    const upsertCall = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    const row = upsertCall[0]
    expect(row.session_id).toBe('sess-1')
    expect(row.current_task).toBe('Phase 1a study')
    expect(row.status).toBe('active')
    expect(row.metadata).toMatchObject({ role: 'coordinator' })
  })

  it('accepts no initial_task — stores null', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await startWindowSession('sess-2')

    const upsertCall = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(upsertCall[0].current_task).toBeNull()
  })
})

// ── heartbeatWindow ────────────────────────────────────────────────────────

describe('heartbeatWindow', () => {
  it('calls update with current_task and active status', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await heartbeatWindow('sess-1', 'Phase 1b twin queries')

    expect(mockFrom).toHaveBeenCalledWith('window_sessions')
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(updateCall[0].current_task).toBe('Phase 1b twin queries')
    expect(updateCall[0].status).toBe('active')
    expect(updateCall[0].last_heartbeat).toBeDefined()
  })
})

// ── endWindowSession ───────────────────────────────────────────────────────

describe('endWindowSession', () => {
  it('calls update with status=ended', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await endWindowSession('sess-1')

    expect(mockFrom).toHaveBeenCalledWith('window_sessions')
    const updateCall = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(updateCall[0].status).toBe('ended')
  })
})

// ── getActiveSessions ──────────────────────────────────────────────────────

describe('getActiveSessions', () => {
  it('returns sessions from DB filtered to active + recent heartbeat', async () => {
    const fakeSessions = [
      {
        session_id: 'sess-1',
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        current_task: 'Phase 1a',
        status: 'active',
        metadata: {},
      },
    ]
    const chain = makeChain({ data: fakeSessions, error: null })
    mockFrom.mockReturnValue(chain)

    const result = await getActiveSessions()

    expect(result).toEqual(fakeSessions)
    expect(mockFrom).toHaveBeenCalledWith('window_sessions')
    expect(chain.eq).toHaveBeenCalledWith('status', 'active')
    expect(chain.gte).toHaveBeenCalled()
  })

  it('returns empty array when no active sessions', async () => {
    const chain = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    const result = await getActiveSessions()

    expect(result).toEqual([])
  })

  it('throws when DB returns an error', async () => {
    const chain = makeChain({ data: null, error: { message: 'connection refused' } })
    mockFrom.mockReturnValue(chain)

    await expect(getActiveSessions()).rejects.toThrow('connection refused')
  })
})
