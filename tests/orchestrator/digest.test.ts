import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFrom, mockPostMessage } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPostMessage: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
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

beforeEach(() => {
  vi.clearAllMocks()
  mockPostMessage.mockResolvedValue(undefined)
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
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('sent')
    expect(mockPostMessage).toHaveBeenCalledTimes(1)
  })

  it('returns no_tick_found when no tick row exists', async () => {
    const qb = makeQueryBuilder({ data: null, error: { message: 'no rows' } })
    const ib = makeInsertBuilder()
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

    const status = await sendMorningDigest()
    expect(status).toBe('no_tick_found')
    expect(mockPostMessage).toHaveBeenCalledWith(expect.stringContaining('No night tick found'))
  })

  it('returns telegram_failed when postMessage throws MissingTelegramConfigError', async () => {
    mockPostMessage.mockRejectedValue(new MissingTelegramConfigError())
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

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
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

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
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

    await sendMorningDigest()
    const row = ib.insert.mock.calls[0][0]
    expect(row.status).toBe('success')
    expect(row.meta.digest_status).toBe('sent')
  })

  it('writes column=warning + meta.digest_status=no_tick_found', async () => {
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

    await sendMorningDigest()
    const row = ib.insert.mock.calls[0][0]
    expect(row.status).toBe('warning')
    expect(row.meta.digest_status).toBe('no_tick_found')
  })

  it('writes column=error + meta.digest_status=telegram_failed', async () => {
    mockPostMessage.mockRejectedValue(new MissingTelegramConfigError())
    const qb = makeQueryBuilder({ data: null, error: null })
    const ib = makeInsertBuilder()
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

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
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

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
    mockFrom.mockReturnValueOnce(qb).mockReturnValueOnce(ib)

    await sendMorningDigest()
    expect(ib.insert.mock.calls[0][0].meta.mapped_from).toBe('spec_v1')
  })
})
