import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockFrom,
  mockPostMessage,
  mockFetchHistory,
  mockScoreMorningDigest,
  mockGetDigestStallSummary,
  mockBuildBranchGuardLine,
  mockBuildProcessEfficiencyLines,
  mockBuildFtsFallbackLine,
  mockBuildDrainStatsLine,
  mockBuildReviewTimeoutLine,
  mockBuildQuotaCliffLine,
  mockBuildHarnessRollupLine,
  mockBuildQuotaGuardLine,
  mockBuildStartupForecastLine,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPostMessage: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockScoreMorningDigest: vi.fn(),
  mockGetDigestStallSummary: vi.fn(),
  mockBuildBranchGuardLine: vi.fn(),
  mockBuildProcessEfficiencyLines: vi.fn(),
  mockBuildFtsFallbackLine: vi.fn(),
  mockBuildDrainStatsLine: vi.fn(),
  mockBuildReviewTimeoutLine: vi.fn(),
  mockBuildQuotaCliffLine: vi.fn(),
  mockBuildHarnessRollupLine: vi.fn(),
  mockBuildQuotaGuardLine: vi.fn(),
  mockBuildStartupForecastLine: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/orchestrator/scoring', () => ({
  fetchHistoricalContext: mockFetchHistory,
  scoreMorningDigest: mockScoreMorningDigest,
}))

vi.mock('@/lib/orchestrator/telegram', () => {
  class MissingTelegramConfigError extends Error {
    override readonly name = 'MissingTelegramConfigError'
    constructor() {
      super('missing telegram config')
    }
  }
  return { postMessage: mockPostMessage, MissingTelegramConfigError }
})

// Mock stall-check so getDigestStallSummary does not consume mockFrom slots.
// Individual tests can override this mock to test stall-summary line behaviour.
vi.mock('@/lib/harness/stall-check', () => ({
  getDigestStallSummary: mockGetDigestStallSummary,
}))

// Mock branch-guard so buildBranchGuardLine does not consume mockFrom slots.
vi.mock('@/lib/harness/branch-guard', () => ({
  buildBranchGuardLine: mockBuildBranchGuardLine,
}))

// Mock process-efficiency so buildProcessEfficiencyLines does not consume mockFrom slots.
vi.mock('@/lib/harness/process-efficiency', () => ({
  buildProcessEfficiencyLines: mockBuildProcessEfficiencyLines,
}))

// Mock fts-fallback so buildFtsFallbackLine does not consume mockFrom slots.
vi.mock('@/lib/twin/fts-fallback', () => ({
  buildFtsFallbackLine: mockBuildFtsFallbackLine,
}))

// Mock telegram-stats so drain/review-timeout lines do not consume mockFrom slots.
vi.mock('@/lib/harness/telegram-stats', () => ({
  buildDrainStatsLine: mockBuildDrainStatsLine,
  buildReviewTimeoutLine: mockBuildReviewTimeoutLine,
}))

// Mock quota-cliff so buildQuotaCliffLine does not consume mockFrom slots.
vi.mock('@/lib/harness/quota-cliff', () => ({
  buildQuotaCliffLine: mockBuildQuotaCliffLine,
}))

// Mock rollup so buildHarnessRollupLine does not consume mockFrom slots.
vi.mock('@/lib/harness/rollup', () => ({
  buildHarnessRollupLine: mockBuildHarnessRollupLine,
}))

// Mock quota-guard so buildQuotaGuardLine does not consume mockFrom slots.
vi.mock('@/lib/harness/quota-guard', () => ({
  buildQuotaGuardLine: mockBuildQuotaGuardLine,
}))

// Mock quota-forecast so buildStartupForecastLine does not consume mockFrom slots.
vi.mock('@/lib/harness/quota-forecast', () => ({
  buildStartupForecastLine: mockBuildStartupForecastLine,
}))

import { composeMorningDigest, sendMorningDigest } from '@/lib/orchestrator/digest'
import { MissingTelegramConfigError } from '@/lib/orchestrator/telegram'
import type { TickResult } from '@/lib/orchestrator/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    tick_id: 'aaaa-bbbb-cccc-dddd',
    run_id: 'run-1234-5678',
    mode: 'overnight_readonly',
    started_at: '2026-04-19T08:00:00.000Z',
    finished_at: '2026-04-19T08:00:05.000Z',
    duration_ms: 5000,
    status: 'completed',
    checks: [
      {
        name: 'site_health',
        status: 'pass',
        flags: [],
        counts: { pass: 3, fail: 0 },
        duration_ms: 100,
      },
      {
        name: 'scan_integrity',
        status: 'pass',
        flags: [],
        counts: { total: 10 },
        duration_ms: 200,
      },
      {
        name: 'event_log_consistency',
        status: 'pass',
        flags: [],
        counts: { total: 25 },
        duration_ms: 150,
      },
    ],
    ...overrides,
  }
}

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

// Returns a query chain that resolves to empty data — used for the F18 Ollama stats queries
// (buildOllamaStatsLine calls from() twice: once for ollama.generate, once for twin.ask)
function makeOllamaStatsBuilder(data: unknown[] = []) {
  const result = { data, error: null }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue(result),
  }
}

const MOCK_QUALITY_SCORE = {
  aggregate: 75.0,
  capacity_tier: 'tier_1_laptop_ollama',
  dimensions: { completeness: 100, signal_quality: 50, efficiency: 50, hygiene: 100 },
  weights_version: 'v1',
  scored_at: '2026-04-21T08:00:00.000Z',
  scored_by: 'rule_based_v1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPostMessage.mockResolvedValue(undefined)
  mockFetchHistory.mockResolvedValue({
    task_type: 'morning_digest',
    capacity_tier: 'tier_1_laptop_ollama',
    prior_durations_ms: [],
  })
  mockScoreMorningDigest.mockReturnValue(MOCK_QUALITY_SCORE)
  // Default: no stalled tasks — stall summary line omitted
  mockGetDigestStallSummary.mockResolvedValue({ count: 0, descriptions: [] })
  // Default: 0 branch guard fires — guard is working silently
  mockBuildBranchGuardLine.mockResolvedValue('Branch guard fires (24h): 0 ✅')
  // Default: 0 FTS fallback fires — vector path healthy
  mockBuildFtsFallbackLine.mockResolvedValue('Twin FTS fallback (24h): 0 ✅')
  // Default: healthy process efficiency
  mockBuildProcessEfficiencyLines.mockResolvedValue(
    'Process efficiency (24h):\n• Queue throughput: no tasks created\n• Pickup latency: no pickups in 24h | 💡 Check pickup cron is firing\n• Queue depth: 0 tasks waiting ✅\n• Friction: 0 grounding blocks / retries ✅'
  )
  // Default: drain ran 0 times (first run after deploy), no review timeouts
  mockBuildDrainStatsLine.mockResolvedValue('Drain runs (24h): 0, messages: 0')
  mockBuildReviewTimeoutLine.mockResolvedValue(null)
  // Default: quota cliff clean — no 429 errors, no stuck tasks
  mockBuildQuotaCliffLine.mockResolvedValue('Routines quota: clean (24h) ✅')
  // Default: healthy harness rollup with no prior event (first run)
  mockBuildHarnessRollupLine.mockResolvedValue('Harness rollup: 84.6% (13/18 components complete)')
  // Default: quota guard clean — no pickup skips in 24h
  mockBuildQuotaGuardLine.mockResolvedValue('Quota guard skips (24h): 0 ✅')
  // Default: no coordinator startup skips in 24h
  mockBuildStartupForecastLine.mockResolvedValue('Coordinator startup skips (24h): 0 ✅')
})

// ── composeMorningDigest ──────────────────────────────────────────────────────

describe('composeMorningDigest', () => {
  it('includes the date from tick.started_at', () => {
    expect(composeMorningDigest(makeTickResult())).toContain('2026-04-19')
  })

  it('shows ✅ for all-pass tick', () => {
    const msg = composeMorningDigest(makeTickResult())
    expect(msg).toContain('✅ Site health: 3/3 pass')
    expect(msg).toContain('✅ Scan integrity: 10 scans, 0 flags')
    expect(msg).toContain('✅ Event log: 25 events, 0 flagged')
  })

  it('shows ⚠️ for warn check', () => {
    const tick = makeTickResult({
      checks: [
        {
          name: 'site_health',
          status: 'warn',
          flags: [{ severity: 'warn', message: 'sub-check failed' }],
          counts: { pass: 2, fail: 1 },
          duration_ms: 50,
        },
        {
          name: 'scan_integrity',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
        {
          name: 'event_log_consistency',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
      ],
    })
    expect(composeMorningDigest(tick)).toContain('⚠️ Site health')
  })

  it('shows ❌ for fail check', () => {
    const tick = makeTickResult({
      checks: [
        {
          name: 'site_health',
          status: 'fail',
          flags: [{ severity: 'critical', message: 'db down' }],
          counts: { pass: 0, fail: 3 },
          duration_ms: 50,
        },
        {
          name: 'scan_integrity',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
        {
          name: 'event_log_consistency',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
      ],
    })
    expect(composeMorningDigest(tick)).toContain('❌ Site health')
  })

  it('includes tick duration in seconds', () => {
    expect(composeMorningDigest(makeTickResult())).toContain('5.0s')
  })

  it('includes first 8 chars of tick_id', () => {
    expect(composeMorningDigest(makeTickResult())).toContain('aaaa-bbb')
  })

  it('includes Flags section when flags exist', () => {
    const tick = makeTickResult({
      checks: [
        {
          name: 'scan_integrity',
          status: 'warn',
          flags: [
            { severity: 'warn', message: 'scan row missing asin', entity_id: 'scan-001-abc' },
          ],
          counts: { total: 1 },
          duration_ms: 50,
        },
        { name: 'site_health', status: 'pass', flags: [], counts: { pass: 3 }, duration_ms: 50 },
        {
          name: 'event_log_consistency',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
      ],
    })
    const msg = composeMorningDigest(tick)
    expect(msg).toContain('Flags:')
    expect(msg).toContain('scan row missing asin')
    expect(msg).toContain('[scan-001')
  })

  it('shows max 5 flags even with more', () => {
    const manyFlags = Array.from({ length: 10 }, (_, i) => ({
      severity: 'warn' as const,
      message: `flag ${i}`,
    }))
    const tick = makeTickResult({
      checks: [
        {
          name: 'scan_integrity',
          status: 'warn',
          flags: manyFlags,
          counts: { total: 10 },
          duration_ms: 50,
        },
        { name: 'site_health', status: 'pass', flags: [], counts: { pass: 3 }, duration_ms: 50 },
        {
          name: 'event_log_consistency',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
      ],
    })
    const msg = composeMorningDigest(tick)
    const bulletCount = (msg.match(/^•/gm) ?? []).length
    expect(bulletCount).toBeLessThanOrEqual(5)
  })

  it('shows at most 5 flag bullets even with many flags', () => {
    const manyFlags = Array.from({ length: 20 }, (_, i) => ({
      severity: 'warn' as const,
      message: `flag ${i}`,
    }))
    const tick = makeTickResult({
      checks: [
        {
          name: 'scan_integrity',
          status: 'warn',
          flags: manyFlags,
          counts: { total: 20 },
          duration_ms: 50,
        },
        { name: 'site_health', status: 'pass', flags: [], counts: { pass: 3 }, duration_ms: 50 },
        {
          name: 'event_log_consistency',
          status: 'pass',
          flags: [],
          counts: { total: 0 },
          duration_ms: 50,
        },
      ],
    })
    const msg = composeMorningDigest(tick)
    const bulletCount = (msg.match(/^•/gm) ?? []).length
    expect(bulletCount).toBeLessThanOrEqual(5)
  })
})

// ── sendMorningDigest ─────────────────────────────────────────────────────────

describe('sendMorningDigest — status paths', () => {
  it('returns sent when tick found and Telegram succeeds', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('sent')
    expect(mockPostMessage).toHaveBeenCalledTimes(1)
  })

  it('returns no_tick_found when no tick row exists', async () => {
    const qb = makeQueryBuilder({ data: null, error: { message: 'no rows' } })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('no_tick_found')
    expect(mockPostMessage).toHaveBeenCalledWith(expect.stringContaining('No night tick found'))
  })

  it('returns telegram_failed when postMessage throws MissingTelegramConfigError', async () => {
    mockPostMessage.mockRejectedValue(new MissingTelegramConfigError())
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('telegram_failed')
  })

  it('returns telegram_failed when postMessage throws generic error', async () => {
    mockPostMessage.mockRejectedValue(new Error('network error'))
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('telegram_failed')
  })
})

describe('sendMorningDigest — agent_events row (dual status assertions)', () => {
  it('writes column=success + meta.digest_status=sent', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    const row = ib.insert.mock.calls[0][0]
    expect(row.status).toBe('success')
    expect(row.meta.digest_status).toBe('sent')
  })

  it('writes column=warning + meta.digest_status=no_tick_found', async () => {
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    const row = ib.insert.mock.calls[0][0]
    expect(row.status).toBe('warning')
    expect(row.meta.digest_status).toBe('no_tick_found')
  })

  it('writes column=error + meta.digest_status=telegram_failed', async () => {
    mockPostMessage.mockRejectedValue(new MissingTelegramConfigError())
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    const row = ib.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.meta.digest_status).toBe('telegram_failed')
  })

  it('always writes exactly one agent_events row per call', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(ib.insert).toHaveBeenCalledTimes(1)
    const row = ib.insert.mock.calls[0][0]
    expect(row.action).toBe('morning_digest')
    expect(row.domain).toBe('orchestrator')
    expect(row.actor).toBe('night_watchman')
  })

  it('meta includes mapped_from=spec_v1', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(ib.insert.mock.calls[0][0].meta.mapped_from).toBe('spec_v1')
  })
})

describe('sendMorningDigest — quality scoring', () => {
  it('row has task_type=morning_digest', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(ib.insert.mock.calls[0][0].task_type).toBe('morning_digest')
  })

  it('row has quality_score with expected shape', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    const qs = ib.insert.mock.calls[0][0].quality_score
    expect(qs.aggregate).toBe(75.0)
    expect(qs.capacity_tier).toBe('tier_1_laptop_ollama')
    expect(qs.scored_by).toBe('rule_based_v1')
    expect(qs.dimensions).toBeDefined()
  })

  it('fetchHistoricalContext called with task_type=morning_digest and current tier', async () => {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(mockFetchHistory).toHaveBeenCalledWith(
      expect.anything(),
      'morning_digest',
      'tier_1_laptop_ollama'
    )
  })

  it('scoring failure → row still writes with fallback scored_by', async () => {
    mockFetchHistory.mockRejectedValue(new Error('history fetch failed'))
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    // Slot 1: night_tick query | Slots 2-3: F18 Ollama stats (generate + twin.ask) | Slot 4+: writeDigestEvent (scoring + insert)
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(ib.insert).toHaveBeenCalledTimes(1)
    const qs = ib.insert.mock.calls[0][0].quality_score
    expect(qs.scored_by).toBe('rule_based_v1_fallback')
    expect(qs.aggregate).toBeNull()
  })
})

// ── sendMorningDigest — branch guard F18 line ─────────────────────────────────

describe('sendMorningDigest — branch guard F18 line', () => {
  function makeSlots() {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)
    return { ib }
  }

  it('includes "Branch guard fires" line when 0 events (guard silent)', async () => {
    mockBuildBranchGuardLine.mockResolvedValue('Branch guard fires (24h): 0 ✅')
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Branch guard fires (24h): 0 ✅')
    )
  })

  it('includes count and task_ids when guard has fired', async () => {
    mockBuildBranchGuardLine.mockResolvedValue(
      'Branch guard fires (24h): 2 — task_ids: [abc123, def456]'
    )
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Branch guard fires (24h): 2 — task_ids: [abc123, def456]')
    )
  })

  it('still sends digest when buildBranchGuardLine returns unavailable', async () => {
    mockBuildBranchGuardLine.mockResolvedValue('Branch guard: status unavailable')
    makeSlots()
    const status = await sendMorningDigest()
    expect(status).toBe('sent')
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Branch guard: status unavailable')
    )
  })
})

// ── sendMorningDigest — FTS fallback F18 line ─────────────────────────────────

describe('sendMorningDigest — FTS fallback F18 line', () => {
  function makeSlots() {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)
    return { ib }
  }

  it('includes "Twin FTS fallback" line when 0 fires (vector path healthy)', async () => {
    mockBuildFtsFallbackLine.mockResolvedValue('Twin FTS fallback (24h): 0 ✅')
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Twin FTS fallback (24h): 0 ✅')
    )
  })

  it('includes count when FTS fallback has fired', async () => {
    mockBuildFtsFallbackLine.mockResolvedValue('Twin FTS fallback (24h): 5')
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Twin FTS fallback (24h): 5')
    )
  })

  it('still sends digest when buildFtsFallbackLine returns unavailable', async () => {
    mockBuildFtsFallbackLine.mockResolvedValue('Twin FTS fallback: status unavailable')
    makeSlots()
    const status = await sendMorningDigest()
    expect(status).toBe('sent')
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Twin FTS fallback: status unavailable')
    )
  })
})

// ── sendMorningDigest — drain stats + review timeout lines (P6+P1) ────────────

describe('sendMorningDigest — drain stats line (P6)', () => {
  function makeSlots() {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)
    return { ib }
  }

  it('includes drain stats line in sent message', async () => {
    mockBuildDrainStatsLine.mockResolvedValue('Drain runs (24h): 24, messages: 3')
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Drain runs (24h): 24, messages: 3')
    )
  })

  it('still sends when drain stats line returns "unavailable"', async () => {
    mockBuildDrainStatsLine.mockResolvedValue('Drain runs (24h): unavailable')
    makeSlots()
    const status = await sendMorningDigest()
    expect(status).toBe('sent')
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('Drain runs (24h): unavailable')
    )
  })
})

describe('sendMorningDigest — review timeout line (P1)', () => {
  function makeSlots() {
    const qb = makeQueryBuilder({
      data: { output_summary: JSON.stringify(makeTickResult()) },
      error: null,
    })
    const ib = makeInsertBuilder()
    mockFrom
      .mockReturnValueOnce(qb)
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(makeOllamaStatsBuilder())
      .mockReturnValueOnce(ib)
    return { ib }
  }

  it('omits review timeout line when buildReviewTimeoutLine returns null (healthy)', async () => {
    mockBuildReviewTimeoutLine.mockResolvedValue(null)
    makeSlots()
    await sendMorningDigest()
    const sentMsg = mockPostMessage.mock.calls[0][0] as string
    expect(sentMsg).not.toContain('Review timeouts swept')
  })

  it('includes review timeout line when N > 0', async () => {
    mockBuildReviewTimeoutLine.mockResolvedValue('⚠️ Review timeouts swept (24h): 2')
    makeSlots()
    await sendMorningDigest()
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ Review timeouts swept (24h): 2')
    )
  })

  it('still sends digest when review timeout line returns null', async () => {
    mockBuildReviewTimeoutLine.mockResolvedValue(null)
    makeSlots()
    const status = await sendMorningDigest()
    expect(status).toBe('sent')
  })
})
