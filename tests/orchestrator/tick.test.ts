import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock checks ───────────────────────────────────────────────────────────────

const { mockSiteHealth, mockScanIntegrity, mockEventLog } = vi.hoisted(() => ({
  mockSiteHealth: vi.fn(),
  mockScanIntegrity: vi.fn(),
  mockEventLog: vi.fn(),
}))

vi.mock('@/lib/orchestrator/checks/site-health', () => ({ checkSiteHealth: mockSiteHealth }))
vi.mock('@/lib/orchestrator/checks/scan-integrity', () => ({
  checkScanIntegrity: mockScanIntegrity,
}))
vi.mock('@/lib/orchestrator/checks/event-log-consistency', () => ({
  checkEventLogConsistency: mockEventLog,
}))

import { runNightTick } from '@/lib/orchestrator/tick'
import type { CheckResult } from '@/lib/orchestrator/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function passCheck(name: string): CheckResult {
  return { name, status: 'pass', flags: [], counts: { pass: 3 }, duration_ms: 10 }
}
function warnCheck(name: string): CheckResult {
  return {
    name,
    status: 'warn',
    flags: [{ severity: 'warn', message: 'minor issue' }],
    counts: {},
    duration_ms: 10,
  }
}
function failCheck(name: string): CheckResult {
  return {
    name,
    status: 'fail',
    flags: [{ severity: 'critical', message: 'broken' }],
    counts: {},
    duration_ms: 10,
  }
}

function makeInsertBuilder() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSiteHealth.mockResolvedValue(passCheck('site_health'))
  mockScanIntegrity.mockResolvedValue(passCheck('scan_integrity'))
  mockEventLog.mockResolvedValue(passCheck('event_log_consistency'))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runNightTick — shape', () => {
  it('returns a TickResult with all required fields', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runNightTick()
    expect(result.tick_id).toBeTruthy()
    expect(result.run_id).toBeTruthy()
    expect(result.mode).toBe('overnight_readonly')
    expect(result.checks).toHaveLength(3)
    expect(result.started_at).toBeTruthy()
    expect(result.finished_at).toBeTruthy()
    expect(typeof result.duration_ms).toBe('number')
  })

  it('check names match expected set', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runNightTick()
    const names = result.checks.map((c) => c.name)
    expect(names).toContain('site_health')
    expect(names).toContain('scan_integrity')
    expect(names).toContain('event_log_consistency')
  })
})

describe('runNightTick — status mapping (dual assertions: column + meta)', () => {
  it('all pass → column=success, meta.tick_status=completed', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('success')
    expect(row.meta.tick_status).toBe('completed')
  })

  it('one warn → column=warning, meta.tick_status=partial_failure', async () => {
    mockScanIntegrity.mockResolvedValue(warnCheck('scan_integrity'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('warning')
    expect(row.meta.tick_status).toBe('partial_failure')
  })

  it('one fail (not all) → column=warning, meta.tick_status=partial_failure', async () => {
    mockSiteHealth.mockResolvedValue(failCheck('site_health'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('warning')
    expect(row.meta.tick_status).toBe('partial_failure')
  })

  it('all fail → column=error, meta.tick_status=failed', async () => {
    mockSiteHealth.mockResolvedValue(failCheck('site_health'))
    mockScanIntegrity.mockResolvedValue(failCheck('scan_integrity'))
    mockEventLog.mockResolvedValue(failCheck('event_log_consistency'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
    expect(row.meta.tick_status).toBe('failed')
  })

  it('meta includes mapped_from=spec_v1', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    expect(b.insert.mock.calls[0][0].meta.mapped_from).toBe('spec_v1')
  })

  it('meta.tick_id and meta.run_id match the returned result', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const result = await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.meta.tick_id).toBe(result.tick_id)
    expect(row.meta.run_id).toBe(result.run_id)
  })
})

describe('runNightTick — agent_events write', () => {
  it('writes exactly one agent_events row per call', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(b.insert).toHaveBeenCalledTimes(1)
  })

  it('row has domain=orchestrator, action=night_tick, actor=night_watchman', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.domain).toBe('orchestrator')
    expect(row.action).toBe('night_tick')
    expect(row.actor).toBe('night_watchman')
  })

  it('tags include night_tick, step6, read_only', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    const tags = b.insert.mock.calls[0][0].tags as string[]
    expect(tags).toContain('night_tick')
    expect(tags).toContain('step6')
    expect(tags).toContain('read_only')
  })

  it('output_summary is JSON-parseable TickResult', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const result = await runNightTick()
    const row = b.insert.mock.calls[0][0]
    const parsed = JSON.parse(row.output_summary)
    expect(parsed.tick_id).toBe(result.tick_id)
    expect(Array.isArray(parsed.checks)).toBe(true)
  })
})

describe('runNightTick — never throws', () => {
  it('does not throw when a check rejects', async () => {
    mockSiteHealth.mockRejectedValue(new Error('check crashed'))
    mockFrom.mockReturnValue(makeInsertBuilder())
    await expect(runNightTick()).resolves.toBeDefined()
  })

  it('does not throw when the agent_events insert throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('db crash')
    })
    await expect(runNightTick()).resolves.toBeDefined()
  })

  it('still writes the event row even when two checks fail', async () => {
    mockSiteHealth.mockResolvedValue(failCheck('site_health'))
    mockScanIntegrity.mockResolvedValue(failCheck('scan_integrity'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runNightTick()
    expect(b.insert).toHaveBeenCalledTimes(1)
  })
})
