/**
 * Unit tests for lib/oss/scout.ts — scoutCheck() decision logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase (oss_packages cache query) ──────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock Telegram (sendScoutBlockAlert uses postMessage) ──────────────────────

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}))

vi.mock('@/lib/orchestrator/telegram', () => ({
  postMessage: mockPostMessage,
}))

import { scoutCheck, sendScoutBlockAlert } from '@/lib/oss/scout'
import type { TaskRow } from '@/lib/harness/task-pickup'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-uuid-abcd1234',
    task: 'Build OSS scout gate',
    description: null,
    priority: 1,
    status: 'in_progress',
    source: 'manual',
    metadata: {},
    result: null,
    retry_count: 0,
    max_retries: 2,
    created_at: '2026-05-10T10:00:00Z',
    claimed_at: '2026-05-10T10:00:05Z',
    claimed_by: 'run-test',
    last_heartbeat_at: null,
    completed_at: null,
    error_message: null,
    ...overrides,
  }
}

// oss_packages cache returns no rows by default (empty cache)
function makeEmptyCache() {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPostMessage.mockResolvedValue(undefined)
  mockFrom.mockReturnValue(makeEmptyCache())
})

// ── No external_deps → pass ───────────────────────────────────────────────────

describe('scoutCheck — no external_deps', () => {
  it('returns pass with no_deps scorer when metadata has no external_deps', async () => {
    const result = await scoutCheck(makeTask())
    expect(result.decision).toBe('pass')
    expect(result.scorer).toBe('no_deps')
    expect(result.verdicts).toHaveLength(0)
  })

  it('returns pass when external_deps is an empty array', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: [] } }))
    expect(result.decision).toBe('pass')
    expect(result.scorer).toBe('no_deps')
  })

  it('does not query oss_packages when deps is empty', async () => {
    await scoutCheck(makeTask())
    expect(mockFrom).not.toHaveBeenCalledWith('oss_packages')
  })

  it('returns latency_ms as a number', async () => {
    const result = await scoutCheck(makeTask())
    expect(typeof result.latency_ms).toBe('number')
  })
})

// ── Known absorb-patterns dep → warn ─────────────────────────────────────────

describe('scoutCheck — absorb-patterns dep → warn', () => {
  it('returns warn for a known absorb-patterns dep (sheets)', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['sheets'] } }))
    expect(result.decision).toBe('warn')
    expect(result.scorer).toBe('rule_based_v1')
  })

  it('returns warn for ollama (absorb-patterns)', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['ollama'] } }))
    expect(result.decision).toBe('warn')
  })

  it('includes the dep verdict in verdicts array', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['sheets'] } }))
    const v = result.verdicts.find((v) => v.dep === 'sheets')
    expect(v).toBeDefined()
    expect(v?.verdict).toBe('absorb-patterns')
  })

  it('includes lepios_alternative when known', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['sheets'] } }))
    const v = result.verdicts.find((v) => v.dep === 'sheets')
    expect(v?.lepios_alternative).toBe('supabase')
  })
})

// ── keep/complement-with deps → pass ─────────────────────────────────────────

describe('scoutCheck — keep/complement deps → pass', () => {
  it('returns pass for sp_api (keep)', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['sp_api'] } }))
    expect(result.decision).toBe('pass')
  })

  it('returns pass for keepa (complement-with)', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['keepa'] } }))
    expect(result.decision).toBe('pass')
  })

  it('returns pass for unknown dep (fallback = keep)', async () => {
    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['some-unknown-lib'] } }))
    expect(result.decision).toBe('pass')
  })
})

// ── replace verdict from oss_packages cache → block ──────────────────────────

describe('scoutCheck — oss_packages cache hit with replace verdict', () => {
  it('returns block when cache has a dep with fit_score < 30 (replace verdict)', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ name: 'bad-lib', fit_score: 10, lepios_alternative: 'lib/internal/' }],
        error: null,
      }),
    })

    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['bad-lib'] } }))
    expect(result.decision).toBe('block')
    expect(result.scorer).toBe('oss_packages_cache')
    const v = result.verdicts.find((v) => v.dep === 'bad-lib')
    expect(v?.verdict).toBe('replace')
    expect(v?.lepios_alternative).toBe('lib/internal/')
  })

  it('returns warn when cache has fit_score between 50-79 (absorb-patterns)', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ name: 'mid-lib', fit_score: 60, lepios_alternative: null }],
        error: null,
      }),
    })

    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['mid-lib'] } }))
    expect(result.decision).toBe('warn')
  })

  it('falls back to rule_based_v1 when cache query throws', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockRejectedValue(new Error('db down')),
    })

    const result = await scoutCheck(makeTask({ metadata: { external_deps: ['sheets'] } }))
    // Should still return warn via rule_based_v1 fallback
    expect(result.decision).toBe('warn')
    expect(result.scorer).toBe('rule_based_v1')
  })
})

// ── sendScoutBlockAlert ───────────────────────────────────────────────────────

describe('sendScoutBlockAlert', () => {
  it('calls postMessage with task id and block dep', async () => {
    const task = makeTask()
    const result = {
      decision: 'block' as const,
      verdicts: [{ dep: 'bad-dep', verdict: 'replace' as const, lepios_alternative: 'lib/better/' }],
      scorer: 'rule_based_v1' as const,
      latency_ms: 5,
    }

    await sendScoutBlockAlert(task, result)

    expect(mockPostMessage).toHaveBeenCalledTimes(1)
    const msg: string = mockPostMessage.mock.calls[0][0]
    expect(msg).toContain('blocked')
    expect(msg).toContain('bad-dep')
    expect(msg).toContain('lib/better/')
  })

  it('does not throw when postMessage rejects', async () => {
    mockPostMessage.mockRejectedValue(new Error('telegram down'))
    const task = makeTask()
    const result = {
      decision: 'block' as const,
      verdicts: [{ dep: 'x', verdict: 'replace' as const }],
      scorer: 'rule_based_v1' as const,
      latency_ms: 1,
    }

    await expect(sendScoutBlockAlert(task, result)).resolves.toBeUndefined()
  })
})
