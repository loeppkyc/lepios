/**
 * Tests for lib/ai/routing.ts — Hybrid Stack Routing Rule.
 *
 * Covers:
 *   1. All 11 task types return a valid AIProvider from DEFAULT_ROUTING (no DB)
 *   2. routeAICall('scoring') → 'ollama'
 *   3. routeAICall('hard_synthesis') → 'claude'
 *   4. harness_config override for a normally-ollama task returns 'claude'
 *   5. Empty string override falls back to default provider
 *   6. Supabase error in hydrateRoutingConfig does not throw
 *   7. Cache TTL: second call within TTL skips createServiceClient
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase (hoisted so vi.mock has access to the fn reference) ─────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
const { mockCreateServiceClient } = vi.hoisted(() => ({
  mockCreateServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mockCreateServiceClient,
}))

// logEvent is fire-and-forget — mock it to avoid Supabase calls in routing tests
vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
}))

import {
  routeAICall,
  hydrateRoutingConfig,
  _resetRoutingCache,
  type AITaskType,
  type AIProvider,
} from '@/lib/ai/routing'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_TASK_TYPES: AITaskType[] = [
  'scoring',
  'filtering',
  'embedding',
  'pre_research',
  'llm_safety_review',
  'twin_qa',
  'lightweight_synthesis',
  'ocr',
  'hard_synthesis',
  'validation',
  'structured_extraction',
]

const VALID_PROVIDERS: AIProvider[] = ['ollama', 'claude']

/** Build a Supabase-style query chain that resolves to `result`. */
function makeQueryChain(rows: Array<{ key: string; value: string }>) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'like', 'eq']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
    Promise.resolve({ data: rows, error: null }).then(fn)
  return chain
}

function makeErrorChain() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'like', 'eq']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['then'] = (fn: Parameters<Promise<unknown>['then']>[0]) =>
    Promise.resolve({ data: null, error: { message: 'db error' } }).then(fn)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetRoutingCache()
})

// ── Test 1: All 11 task types return a valid AIProvider ───────────────────────

describe('DEFAULT_ROUTING — all task types return valid provider', () => {
  it('covers all 11 task types without a DB call', () => {
    // No hydrateRoutingConfig call → _overrides is empty → uses DEFAULT_ROUTING
    for (const task of ALL_TASK_TYPES) {
      const provider = routeAICall(task)
      expect(VALID_PROVIDERS).toContain(provider)
    }
    // No DB calls should have been made
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })
})

// ── Test 2: scoring → ollama ──────────────────────────────────────────────────

describe("routeAICall('scoring')", () => {
  it("returns 'ollama' (default, no DB)", () => {
    expect(routeAICall('scoring')).toBe('ollama')
  })
})

// ── Test 3: hard_synthesis → claude ──────────────────────────────────────────

describe("routeAICall('hard_synthesis')", () => {
  it("returns 'claude' (default, no DB)", () => {
    expect(routeAICall('hard_synthesis')).toBe('claude')
  })
})

// ── Test 4: harness_config override for a normally-ollama task ───────────────

describe('harness_config override — ollama task promoted to claude', () => {
  it("returns 'claude' for 'scoring' when harness_config overrides it", async () => {
    mockFrom.mockReturnValue(
      makeQueryChain([
        { key: 'ai.routing.scoring', value: 'claude' },
      ])
    )

    await hydrateRoutingConfig(true)
    const provider = routeAICall('scoring')
    expect(provider).toBe('claude')
  })

  it('does not affect other task types when only one is overridden', async () => {
    mockFrom.mockReturnValue(
      makeQueryChain([
        { key: 'ai.routing.twin_qa', value: 'claude' },
      ])
    )

    await hydrateRoutingConfig(true)
    expect(routeAICall('twin_qa')).toBe('claude')
    expect(routeAICall('scoring')).toBe('ollama') // unaffected
    expect(routeAICall('hard_synthesis')).toBe('claude') // own default
  })
})

// ── Test 5: Empty string override falls back to default ───────────────────────

describe('harness_config empty string — falls back to default', () => {
  it("treats empty value as 'no override' and returns DEFAULT_ROUTING", async () => {
    mockFrom.mockReturnValue(
      makeQueryChain([
        { key: 'ai.routing.scoring', value: '' },
        { key: 'ai.routing.hard_synthesis', value: '' },
      ])
    )

    await hydrateRoutingConfig(true)
    expect(routeAICall('scoring')).toBe('ollama')       // empty → default
    expect(routeAICall('hard_synthesis')).toBe('claude') // empty → default
  })
})

// ── Test 6: Supabase error does not throw ─────────────────────────────────────

describe('hydrateRoutingConfig — DB error handling', () => {
  it('does not throw when Supabase returns an error', async () => {
    mockFrom.mockReturnValue(makeErrorChain())

    await expect(hydrateRoutingConfig(true)).resolves.toBeUndefined()
    // Falls back to default routing
    expect(routeAICall('scoring')).toBe('ollama')
    expect(routeAICall('ocr')).toBe('claude')
  })

  it('does not throw when createServiceClient throws', async () => {
    mockCreateServiceClient.mockImplementationOnce(() => {
      throw new Error('connection refused')
    })

    await expect(hydrateRoutingConfig(true)).resolves.toBeUndefined()
    // Default routing still works
    expect(routeAICall('embedding')).toBe('ollama')
  })
})

// ── Test 7: Cache TTL — second call within TTL skips createServiceClient ──────

describe('cache TTL', () => {
  it('skips createServiceClient on second call within TTL', async () => {
    mockFrom.mockReturnValue(makeQueryChain([]))

    await hydrateRoutingConfig(true)
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1)

    // Second call without force=true — should use cache
    await hydrateRoutingConfig()
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when force=true ignores cache', async () => {
    mockFrom.mockReturnValue(makeQueryChain([]))

    await hydrateRoutingConfig(true)
    await hydrateRoutingConfig(true) // force again
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(2)
  })
})

// ── Bonus: valid provider constraint ─────────────────────────────────────────

describe('routeAICall — invalid harness_config value is ignored', () => {
  it('falls back to default when harness_config contains an unrecognised provider', async () => {
    mockFrom.mockReturnValue(
      makeQueryChain([
        // 'gpt4' is not a valid AIProvider — should be ignored
        { key: 'ai.routing.scoring', value: 'gpt4' },
      ])
    )

    await hydrateRoutingConfig(true)
    // isValidProvider('gpt4') = false → override not stored → falls back to 'ollama'
    expect(routeAICall('scoring')).toBe('ollama')
  })
})
