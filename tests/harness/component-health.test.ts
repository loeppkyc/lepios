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

describe('deriveComponentHealth', () => {
  describe('red cases', () => {
    it('no events → red', () => {
      const result = deriveComponentHealth(makeComponent(), [], NOW)
      expect(result.health).toBe('red')
      expect(result.last_success).toBeNull()
      expect(result.last_failure).toBeNull()
    })

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

    it('success exists but is older than 72h → red', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H72 + 1)], NOW)
      expect(result.health).toBe('red')
    })

    it('only warning events (no success or failure) → red (warning age > 72h treated as no signal)', () => {
      // warnings don't count as success or failure; successAge = Infinity → red
      const result = deriveComponentHealth(makeComponent(), [warning(H24)], NOW)
      expect(result.health).toBe('red')
    })
  })

  describe('green cases', () => {
    it('success < 24h, no failures at all → green', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H24 - 1)], NOW)
      expect(result.health).toBe('green')
      expect(result.last_success).toBe(ago(H24 - 1))
    })

    it('success < 24h, failure exists but older than 72h → green (old failure ignored)', () => {
      // Failure is > 72h old — not "recent"
      const result = deriveComponentHealth(
        makeComponent(),
        [success(H24 - 1), failure(H72 + 1)],
        NOW
      )
      expect(result.health).toBe('green')
    })

    it('multiple successes within 24h → green, last_success is most recent', () => {
      // ago(22h) = 14:00 UTC (more recent); ago(23h) = 13:00 UTC (older)
      const result = deriveComponentHealth(
        makeComponent(),
        [success(H24 - 3_600_000), success(H24 - 7_200_000)],
        NOW
      )
      expect(result.health).toBe('green')
      // H24 - 7_200_000 = 22h ago = more recent
      expect(result.last_success).toBe(ago(H24 - 7_200_000))
    })
  })

  describe('amber cases', () => {
    it('success within 24h but failure within 72h before the success → amber (recovered)', () => {
      // Failure 48h ago, success 12h ago → recovered but recently failed
      const result = deriveComponentHealth(
        makeComponent(),
        [failure(H24 * 2), success(H24 / 2)],
        NOW
      )
      expect(result.health).toBe('amber')
    })

    it('success between 24h and 72h → amber (no event in 24-72h window)', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H24 + 1)], NOW)
      expect(result.health).toBe('amber')
    })

    it('success at exactly 72h boundary (≤72h) → amber', () => {
      const result = deriveComponentHealth(makeComponent(), [success(H72)], NOW)
      expect(result.health).toBe('amber')
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

  it('maps components with no matching events to red', async () => {
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
    expect(result[0].health).toBe('red')
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
    expect(compB.health).toBe('red') // no events
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
    expect(result[0].health).toBe('red') // event didn't match
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
    expect(result[0].health).toBe('red') // null meta → no match
  })
})
