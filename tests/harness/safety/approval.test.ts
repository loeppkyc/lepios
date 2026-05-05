/**
 * Unit tests for lib/harness/safety/approval.ts (Safety Agent Phase 3).
 *
 * Spec: docs/specs/safety-agent.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  buildSafetyCallbackData,
  decideApproval,
  getApprovalStatus,
  parseSafetyCallbackData,
  requestApproval,
  SAFETY_CALLBACK_PREFIX,
  sendApprovalCard,
} from '@/lib/harness/safety/approval'

const SAMPLE_UUID = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'

/** Build a chainable Supabase-builder mock. Every method returns the same
 *  object; terminal operations (`.single()`, `.then()`) resolve to `data`. */
function chainable(data: unknown, error: unknown = null) {
  const result = { data, error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  c.select = () => c
  c.eq = () => c
  c.filter = () => c
  c.order = () => c
  c.limit = () => c
  c.single = () => Promise.resolve(result)
  c.insert = (..._args: unknown[]) => {
    void _args
    // for `.insert(...).select().single()` (used in requestApproval)
    return c
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return c
}

beforeEach(() => {
  mockFrom.mockReset()
})

describe('callback data round-trip', () => {
  it('builds and parses approve', () => {
    const data = buildSafetyCallbackData('approve', SAMPLE_UUID)
    expect(data).toBe(`${SAFETY_CALLBACK_PREFIX}:ap:${SAMPLE_UUID}`)
    expect(parseSafetyCallbackData(data)).toEqual({ decision: 'approve', approvalId: SAMPLE_UUID })
  })

  it('builds and parses block', () => {
    expect(parseSafetyCallbackData(buildSafetyCallbackData('block', SAMPLE_UUID))).toEqual({
      decision: 'block',
      approvalId: SAMPLE_UUID,
    })
  })

  it('builds and parses defer', () => {
    expect(parseSafetyCallbackData(buildSafetyCallbackData('defer', SAMPLE_UUID))).toEqual({
      decision: 'defer',
      approvalId: SAMPLE_UUID,
    })
  })

  it('rejects wrong prefix', () => {
    expect(parseSafetyCallbackData(`xx:ap:${SAMPLE_UUID}`)).toBeNull()
  })

  it('rejects unknown action', () => {
    expect(parseSafetyCallbackData(`sr:zz:${SAMPLE_UUID}`)).toBeNull()
  })

  it('rejects non-UUID id', () => {
    expect(parseSafetyCallbackData('sr:ap:not-a-uuid')).toBeNull()
  })
})

describe('requestApproval', () => {
  it('inserts a pending event with worst-severity merged from static + llm', async () => {
    const inserted: Record<string, unknown>[] = []
    mockFrom.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {}
      c.insert = (row: Record<string, unknown>) => {
        inserted.push(row)
        c.select = () => ({ single: () => Promise.resolve({ data: { id: 'inserted-uuid' }, error: null }) })
        return c
      }
      return c
    })

    const r = await requestApproval({
      context: 'DROP TABLE foo proposed by builder',
      proposedAction: { sql: 'DROP TABLE foo;' },
      staticResult: {
        severity: 'block',
        findings: [
          { severity: 'block', category: 'destructive_sql', rule: 'DROP', evidence: 'DROP TABLE foo' },
        ],
      },
      llmResult: { severity: 'warn', rationale: 'might lose data', model: 'qwen2.5:7b', latency_ms: 100 },
      requestedBy: 'builder_session_xyz',
    })
    expect(r.id).toBe('inserted-uuid')
    expect(r.worst).toBe('block')
    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    expect(row.action).toBe('safety.review.requested')
    expect(row.status).toBe('pending')
    expect((row.meta as { worst_severity: string }).worst_severity).toBe('block')
  })

  it('throws on insert error', async () => {
    mockFrom.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {}
      c.insert = () => {
        c.select = () => ({ single: () => Promise.resolve({ data: null, error: { message: 'rls denied' } }) })
        return c
      }
      return c
    })
    await expect(
      requestApproval({
        context: 'x',
        proposedAction: {},
        staticResult: { severity: 'pass', findings: [] },
        requestedBy: 'test',
      }),
    ).rejects.toThrow('rls denied')
  })
})

describe('decideApproval', () => {
  function setupDecideMocks(parentData: unknown, existingDecisions: unknown[]) {
    let callCount = 0
    const inserted: Record<string, unknown>[] = []
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return chainable(parentData)
      if (callCount === 2) return chainable(existingDecisions)
      // 3rd call: insert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {}
      c.insert = (row: Record<string, unknown>) => {
        inserted.push(row)
        return Promise.resolve({ error: null })
      }
      return c
    })
    return inserted
  }

  it('approves a pending request', async () => {
    const inserted = setupDecideMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: { context: 'foo', worst_severity: 'block' } },
      [],
    )
    const r = await decideApproval({ approvalId: SAMPLE_UUID, decision: 'approve', decidedBy: 'colin' })
    expect(r.ok).toBe(true)
    expect(r.status.state).toBe('approved')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].action).toBe('safety.review.approved')
    expect((inserted[0].meta as { parent_id: string }).parent_id).toBe(SAMPLE_UUID)
  })

  it('blocks a pending request', async () => {
    setupDecideMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: { context: 'foo', worst_severity: 'block' } },
      [],
    )
    const r = await decideApproval({
      approvalId: SAMPLE_UUID,
      decision: 'block',
      decidedBy: 'colin',
      rationale: 'too risky',
    })
    expect(r.status.state).toBe('blocked')
  })

  it('defers a pending request', async () => {
    setupDecideMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: {} },
      [],
    )
    const r = await decideApproval({ approvalId: SAMPLE_UUID, decision: 'defer', decidedBy: 'colin' })
    expect(r.status.state).toBe('deferred')
  })

  it('throws when parent not found', async () => {
    mockFrom.mockImplementation(() => chainable(null, { message: 'no row' }))
    await expect(
      decideApproval({ approvalId: SAMPLE_UUID, decision: 'approve', decidedBy: 'colin' }),
    ).rejects.toThrow('not found')
  })

  it('throws when parent is not a safety.review.requested row', async () => {
    setupDecideMocks(
      { id: SAMPLE_UUID, action: 'orchestrator.tick', meta: {} },
      [],
    )
    await expect(
      decideApproval({ approvalId: SAMPLE_UUID, decision: 'approve', decidedBy: 'colin' }),
    ).rejects.toThrow('not a safety.review.requested')
  })

  it('throws when already decided', async () => {
    setupDecideMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: {} },
      [{ id: 'prior-decision-uuid', action: 'safety.review.approved' }],
    )
    await expect(
      decideApproval({ approvalId: SAMPLE_UUID, decision: 'approve', decidedBy: 'colin' }),
    ).rejects.toThrow('already decided')
  })
})

describe('sendApprovalCard', () => {
  it('queues a notification with Approve/Block/Defer buttons keyed to approvalId', async () => {
    const inserted: Record<string, unknown>[] = []
    mockFrom.mockImplementation(() => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return Promise.resolve({ error: null })
      },
    }))

    const r = await sendApprovalCard({
      approvalId: SAMPLE_UUID,
      summary: 'Builder wants to DROP TABLE foo',
      worstSeverity: 'block',
      rationale: 'foo holds production data',
    })

    expect(r.ok).toBe(true)
    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    expect(row.channel).toBe('telegram')
    expect(row.requires_response).toBe(true)
    const payload = row.payload as { text: string; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } }
    expect(payload.text).toContain('BLOCK')
    expect(payload.text).toContain('Builder wants to DROP TABLE foo')
    expect(payload.text).toContain('foo holds production data')
    const buttons = payload.reply_markup.inline_keyboard[0]
    expect(buttons).toHaveLength(3)
    expect(buttons[0].callback_data).toBe(`sr:ap:${SAMPLE_UUID}`)
    expect(buttons[1].callback_data).toBe(`sr:bk:${SAMPLE_UUID}`)
    expect(buttons[2].callback_data).toBe(`sr:df:${SAMPLE_UUID}`)
  })

  it('returns ok:false when insert fails', async () => {
    mockFrom.mockImplementation(() => ({
      insert: () => Promise.resolve({ error: { message: 'rls denied' } }),
    }))
    const r = await sendApprovalCard({
      approvalId: SAMPLE_UUID,
      summary: 'x',
      worstSeverity: 'warn',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('rls denied')
  })
})

describe('getApprovalStatus', () => {
  function setupStatusMocks(parentData: unknown, decisions: unknown[]) {
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return chainable(parentData)
      return chainable(decisions)
    })
  }

  it('returns pending state when no decision exists', async () => {
    setupStatusMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: { context: 'x', worst_severity: 'warn' } },
      [],
    )
    const s = await getApprovalStatus(SAMPLE_UUID)
    expect(s?.state).toBe('pending')
    expect(s?.worst_severity).toBe('warn')
  })

  it('returns approved state when decision row exists', async () => {
    setupStatusMocks(
      { id: SAMPLE_UUID, action: 'safety.review.requested', meta: { context: 'x', worst_severity: 'block' } },
      [{ id: 'dec', action: 'safety.review.approved', actor: 'colin', created_at: '2026-05-05T00:00Z' }],
    )
    const s = await getApprovalStatus(SAMPLE_UUID)
    expect(s?.state).toBe('approved')
    expect(s?.decided_by).toBe('colin')
  })

  it('returns null when id is not a request row', async () => {
    setupStatusMocks({ id: SAMPLE_UUID, action: 'unrelated' }, [])
    expect(await getApprovalStatus(SAMPLE_UUID)).toBeNull()
  })
})
