import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import {
  deriveComponentHealth,
  getComponentsWithHealth,
  type ComponentEvent,
  type ComponentHealthInput,
} from '@/lib/harness/component-health'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeComponent(overrides: Partial<ComponentHealthInput> = {}): ComponentHealthInput {
  return {
    id: 'harness:test_comp',
    display_name: 'Test Component',
    weight_pct: 10,
    completion_pct: 100,
    ...overrides,
  }
}

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

const NOW = new Date('2026-04-27T12:00:00.000Z')
const H24 = 24 * 3_600_000
const H72 = 72 * 3_600_000

function success(ageMs: number): ComponentEvent {
  return { occurred_at: ago(ageMs), status: 'success', error_message: null, action: 'test_action' }
}

function failure(ageMs: number, msg = 'boom'): ComponentEvent {
  return { occurred_at: ago(ageMs), status: 'error', error_message: msg, action: 'test_action' }
}

function warning(ageMs: number): ComponentEvent {
  return { occurred_at: ago(ageMs), status: 'warning', error_message: null, action: 'test_action' }
}

// ── deriveComponentHealth — status cases ──────────────────────────────────────
//
// Semantics (Colin, 2026-05-06):
//   red   = last event is an unrecovered error
//   amber = completion_pct < 100 (still being built)
//   green = built and not currently broken

describe('deriveComponentHealth', () => {
  describe('red cases (broken)', () => {
    it('most recent event is failure → red', () => {
      const result = deriveComponentHealth(
        makeComponent(),
        [success(H24 + 1), failure(H24 - 1)], // failure is newer
        NOW
      )
      expect(result.health).toBe('red')
      expect(result.last_failure).toBe(ago(H24 - 1))
    })

    it('only failures, no success → red', () => {
      const result = deriveComponentHealth(makeComponent(), [failure(H24 + 1)], NOW)
      expect(result.health).toBe('red')
    })

    it('component still being built (50%) but currently failing → red (failure wins over completion)', () => {
      const result = deriveComponentHealth(
        makeComponent({ completion_pct: 50 }),
        [failure(H24 - 1)],
        NOW
      )
      expect(result.health).toBe('red')
    })
  })

  describe('amber cases (in progress)', () => {
    it('completion 50%, no events → amber', () => {
      const result = deriveComponentHealth(makeComponent({ completion_pct: 50 }), [], NOW)
      expect(result.health).toBe('amber')
    })

    it('completion 0%, no events → amber', () => {
      const result = deriveComponentHealth(makeComponent({ completion_pct: 0 }), [], NOW)
      expect(result.health).toBe('amber')
    })

    it('completion 99% with recent success → amber (still in progress)', () => {
      const result = deriveComponentHealth(
        makeComponent({ completion_pct: 99 }),
        [success(H24 - 1)],
        NOW
      )
      expect(result.health).toBe('amber')
    })
  })

  describe('green cases (built and working)', () => {
    it('completion 100%, no events → green', () => {
      const result = deriveComponentHealth(makeComponent(), [], NOW)
      expect(result.health).toBe('green')
      expect(result.last_success).toBeNull()
      expect(result.last_failure).toBeNull()
    })

    it('completion 100%, recent success → green', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H24 - 1)], NOW)
      expect(result.health).toBe('green')
      expect(result.last_success).toBe(ago(H24 - 1))
    })

    it('completion 100%, only old success (>72h) → green (silence is fine)', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H72 + 1)], NOW)
      expect(result.health).toBe('green')
    })

    it('completion 100%, only warning events → green (warnings are not failures)', () => {
      const result = deriveComponentHealth(makeComponent(), [warning(H24)], NOW)
      expect(result.health).toBe('green')
    })

    it('completion 100%, recovered (failure then later success) → green', () => {
      // Failure 48h ago, success 12h ago → currently working, history shows the failure
      const result = deriveComponentHealth(
        makeComponent(),
        [failure(H24 * 2), success(H24 / 2)],
        NOW
      )
      expect(result.health).toBe('green')
      expect(result.last_failure).toBe(ago(H24 * 2))
    })

    it('multiple successes → green, last_success is most recent', () => {
      const result = deriveComponentHealth(
        makeComponent(),
        [success(H24 - 3_600_000), success(H24 - 7_200_000)],
        NOW
      )
      expect(result.health).toBe('green')
      expect(result.last_success).toBe(ago(H24 - 7_200_000))
    })
  })

  describe('output fields', () => {
    it('passes component fields through unchanged', () => {
      const comp = makeComponent({
        id: 'harness:foo',
        display_name: 'Foo',
        weight_pct: 5,
        completion_pct: 30,
      })
      const result = deriveComponentHealth(comp, [], NOW)
      expect(result.id).toBe('harness:foo')
      expect(result.display_name).toBe('Foo')
      expect(result.weight_pct).toBe(5)
      expect(result.completion_pct).toBe(30)
    })

    it('exposes last_error from the most recent failure event', () => {
      const result = deriveComponentHealth(
        makeComponent(),
        [success(H24 / 2), failure(H24 * 2, 'DB timeout')],
        NOW
      )
      expect(result.last_error).toBe('DB timeout')
    })

    it('last_error is null when no failure events exist', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H24 / 2)], NOW)
      expect(result.last_error).toBeNull()
    })
  })
})

// ── getComponentsWithHealth — DB ──────────────────────────────────────────────

describe('getComponentsWithHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeComponentsBuilder(rows: unknown[]) {
    return {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }
  }

  function makeEventsBuilder(rows: unknown[]) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }
  }

  it('returns empty array when harness_components errors', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })
    const result = await getComponentsWithHealth()
    expect(result).toEqual([])
  })

  it('returns empty array when harness_components is empty', async () => {
    mockFrom.mockReturnValueOnce(makeComponentsBuilder([]))
    const result = await getComponentsWithHealth()
    expect(result).toEqual([])
  })

  it('maps components in progress (completion < 100) with no matching events to amber', async () => {
    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          {
            id: 'harness:twin_ollama',
            display_name: 'Twin Ollama',
            weight_pct: 4,
            completion_pct: 0,
          },
        ])
      )
      .mockReturnValueOnce(makeEventsBuilder([]))

    const result = await getComponentsWithHealth()
    expect(result).toHaveLength(1)
    expect(result[0].health).toBe('amber')
    expect(result[0].last_success).toBeNull()
  })

  it('maps fully-built components with no matching events to green', async () => {
    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          {
            id: 'harness:built_thing',
            display_name: 'Built Thing',
            weight_pct: 4,
            completion_pct: 100,
          },
        ])
      )
      .mockReturnValueOnce(makeEventsBuilder([]))

    const result = await getComponentsWithHealth()
    expect(result).toHaveLength(1)
    expect(result[0].health).toBe('green')
    expect(result[0].last_success).toBeNull()
  })

  it('assigns events to the correct component by meta.id', async () => {
    const recentSuccess = new Date(Date.now() - 1_000).toISOString() // 1 second ago

    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          { id: 'harness:comp_a', display_name: 'A', weight_pct: 5, completion_pct: 100 },
          { id: 'harness:comp_b', display_name: 'B', weight_pct: 5, completion_pct: 100 },
        ])
      )
      .mockReturnValueOnce(
        makeEventsBuilder([
          {
            occurred_at: recentSuccess,
            status: 'success',
            error_message: null,
            action: 'harness_component_bumped',
            meta: { id: 'harness:comp_a' },
          },
        ])
      )

    const result = await getComponentsWithHealth()
    const compA = result.find((r) => r.id === 'harness:comp_a')!
    const compB = result.find((r) => r.id === 'harness:comp_b')!

    expect(compA.health).toBe('green')
    expect(compB.health).toBe('green') // built (100%), no events but silence is fine
  })

  it('flags fully-built component as red when most recent event is an error', async () => {
    const recentFailure = new Date(Date.now() - 1_000).toISOString()

    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          { id: 'harness:comp_a', display_name: 'A', weight_pct: 10, completion_pct: 100 },
        ])
      )
      .mockReturnValueOnce(
        makeEventsBuilder([
          {
            occurred_at: recentFailure,
            status: 'error',
            error_message: 'DB unreachable',
            action: 'some_action',
            meta: { id: 'harness:comp_a' },
          },
        ])
      )

    const result = await getComponentsWithHealth()
    expect(result[0].health).toBe('red')
    expect(result[0].last_error).toBe('DB unreachable')
  })

  it('ignores events with meta.id not matching any component slug', async () => {
    const recentSuccess = new Date(Date.now() - 1_000).toISOString()

    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          { id: 'harness:comp_a', display_name: 'A', weight_pct: 10, completion_pct: 100 },
        ])
      )
      .mockReturnValueOnce(
        makeEventsBuilder([
          {
            occurred_at: recentSuccess,
            status: 'success',
            error_message: null,
            action: 'some_action',
            meta: { id: 'harness:unknown_slug' }, // no matching component
          },
        ])
      )

    const result = await getComponentsWithHealth()
    expect(result[0].health).toBe('green') // built, no errors → green regardless of unmatched events
  })

  it('handles events with null meta gracefully', async () => {
    mockFrom
      .mockReturnValueOnce(
        makeComponentsBuilder([
          { id: 'harness:comp_a', display_name: 'A', weight_pct: 10, completion_pct: 100 },
        ])
      )
      .mockReturnValueOnce(
        makeEventsBuilder([
          {
            occurred_at: new Date().toISOString(),
            status: 'success',
            error_message: null,
            action: 'some_action',
            meta: null,
          },
        ])
      )

    const result = await getComponentsWithHealth()
    expect(result[0].health).toBe('green') // built, null meta event ignored, no errors
  })
})
