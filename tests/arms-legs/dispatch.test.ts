/**
 * Unit tests for lib/harness/arms-legs/dispatch.ts
 *
 * All external calls are mocked:
 *   - @/lib/security/capability  (checkCapability — note: NOT requireCapability)
 *   - @/lib/supabase/service     (agent_events logging)
 *
 * http-handlers is NOT imported — dispatch.ts is tested in isolation.
 * Handlers are registered manually per test, then cleaned up via _resetHandlerRegistryForTests.
 *
 * Coverage:
 *   - Happy path: allowed cap + handler succeeds → ok:true + agent_events insert
 *   - Capability denied → ok:false code:'capability_denied' + denied event logged, handler not called
 *   - Handler throws → ok:false code:'handler_error' + error event logged
 *   - Handler times out → ok:false code:'timeout' + timeout event logged
 *   - Unregistered capability → ok:false code:'no_handler', checkCapability not called, no insert
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock checkCapability ──────────────────────────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return {
    ...actual,
    checkCapability: mockCheckCapability,
  }
})

// ── Mock Supabase (agent_events logging) ─────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Import under test ─────────────────────────────────────────────────────────

import {
  runAction,
  registerHandler,
  _resetHandlerRegistryForTests,
} from '@/lib/harness/arms-legs/dispatch'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeCapAllowed(auditId = 'audit-1') {
  mockCheckCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: auditId,
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  _resetHandlerRegistryForTests()
  mockFrom.mockReturnValue(makeInsertChain())
})

// ── Test 1: Happy path ────────────────────────────────────────────────────────

describe('dispatch — happy path', () => {
  it('returns ok:true with handler data and logs arms_legs.dispatch.ok', async () => {
    makeCapAllowed('audit-1')

    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    registerHandler('net.outbound.telegram', async (_payload, _ctx) => {
      return { ok: true, messageId: 42 }
    })

    const result = await runAction({
      capability: 'net.outbound.telegram',
      payload: { message: 'hello' },
      caller: { agent: 'coordinator' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ ok: true, messageId: 42 })
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.capAuditId).toBe('audit-1')
    }

    // Verify agent_events insert with correct action and status
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertedRow = insertChain.insert.mock.calls[0][0] as {
      action: string
      status: string
      meta: { capability: string }
    }
    expect(insertedRow.action).toBe('arms_legs.dispatch.ok')
    expect(insertedRow.status).toBe('success')
    expect(insertedRow.meta.capability).toBe('net.outbound.telegram')
  })
})

// ── Test 2: Capability denied ─────────────────────────────────────────────────

describe('dispatch — capability denied', () => {
  it('returns ok:false code:capability_denied, logs denied event, does NOT call handler', async () => {
    mockCheckCapability.mockResolvedValue({
      allowed: false,
      reason: 'no_grant_for_agent',
      enforcement_mode: 'enforce',
      audit_id: 'audit-2',
    })

    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    const handlerSpy = vi.fn().mockResolvedValue({ ok: true })
    registerHandler('net.outbound.telegram', handlerSpy)

    const result = await runAction({
      capability: 'net.outbound.telegram',
      payload: { message: 'hello' },
      caller: { agent: 'coordinator' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('capability_denied')
      expect(result.error.retriable).toBe(false)
    }

    // Handler must not be called
    expect(handlerSpy).not.toHaveBeenCalled()

    // Denied event logged
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertedRow = insertChain.insert.mock.calls[0][0] as {
      action: string
      status: string
    }
    expect(insertedRow.action).toBe('arms_legs.dispatch.denied')
    expect(insertedRow.status).toBe('warning')
  })
})

// ── Test 3: Handler throws ────────────────────────────────────────────────────

describe('dispatch — handler error', () => {
  it('returns ok:false code:handler_error and logs arms_legs.dispatch.error', async () => {
    makeCapAllowed('audit-3')

    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    registerHandler('net.outbound.telegram', async (_payload, _ctx) => {
      throw new Error('network error')
    })

    const result = await runAction({
      capability: 'net.outbound.telegram',
      payload: { message: 'hello' },
      caller: { agent: 'coordinator' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('handler_error')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    }

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertedRow = insertChain.insert.mock.calls[0][0] as {
      action: string
      status: string
    }
    expect(insertedRow.action).toBe('arms_legs.dispatch.error')
    expect(insertedRow.status).toBe('error')
  })
})

// ── Test 4: Handler timeout ───────────────────────────────────────────────────

describe('dispatch — timeout', () => {
  it('returns ok:false code:timeout within ~200ms when handler never resolves', async () => {
    makeCapAllowed('audit-4')

    const insertChain = makeInsertChain()
    mockFrom.mockReturnValue(insertChain)

    registerHandler('net.outbound.telegram', async (_payload, _ctx) => {
      // Never resolves
      return new Promise<never>(() => {})
    })

    const start = Date.now()
    const result = await runAction({
      capability: 'net.outbound.telegram',
      payload: { message: 'hello' },
      caller: { agent: 'coordinator' },
      timeoutMs: 50,
    })
    const elapsed = Date.now() - start

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('timeout')
    }
    // Should complete within ~200ms of the 50ms timeout
    expect(elapsed).toBeLessThan(200)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertedRow = insertChain.insert.mock.calls[0][0] as {
      action: string
    }
    expect(insertedRow.action).toBe('arms_legs.dispatch.timeout')
  })
})

// ── Test 5: Unregistered capability ──────────────────────────────────────────

describe('dispatch — no_handler', () => {
  it('returns ok:false code:no_handler without calling checkCapability or inserting events', async () => {
    // No handler registered at all

    const result = await runAction({
      capability: 'fs.read',
      payload: {},
      caller: { agent: 'builder' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('no_handler')
      expect(result.capAuditId).toBeNull()
    }

    // checkCapability must NOT be called
    expect(mockCheckCapability).not.toHaveBeenCalled()

    // agent_events insert must NOT be called
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
