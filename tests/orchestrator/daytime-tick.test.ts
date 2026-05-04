import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock checks ───────────────────────────────────────────────────────────────

const { mockOllamaHealth, mockSignalReview, mockSiteHealth } = vi.hoisted(() => ({
  mockOllamaHealth: vi.fn(),
  mockSignalReview: vi.fn(),
  mockSiteHealth: vi.fn(),
}))

vi.mock('@/lib/orchestrator/checks/ollama-health-check', () => ({
  checkOllamaHealth: mockOllamaHealth,
}))
vi.mock('@/lib/orchestrator/checks/signal-review', () => ({
  checkSignalReview: mockSignalReview,
}))
vi.mock('@/lib/orchestrator/checks/site-health', () => ({
  checkSiteHealth: mockSiteHealth,
}))

// ── Mock scoring ──────────────────────────────────────────────────────────────

const { mockFetchHistory, mockScoreDaytime } = vi.hoisted(() => ({
  mockFetchHistory: vi.fn(),
  mockScoreDaytime: vi.fn(),
}))

vi.mock('@/lib/orchestrator/scoring', () => ({
  fetchHistoricalContext: mockFetchHistory,
  scoreDaytimeTick: mockScoreDaytime,
}))

import { runDaytimeTick } from '@/lib/orchestrator/daytime-tick'
import type { CheckResult } from '@/lib/orchestrator/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function passCheck(name: string): CheckResult {
  return { name, status: 'pass', flags: [], counts: { pass: 1 }, duration_ms: 10 }
}
function warnCheck(name: string, msg = 'minor issue'): CheckResult {
  return {
    name,
    status: 'warn',
    flags: [{ severity: 'warn', message: msg }],
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

const MOCK_QUALITY_SCORE = {
  aggregate: 78.5,
  capacity_tier: 'tier_1_laptop_ollama',
  dimensions: { completeness: 100, signal_quality: 50, efficiency: 50, hygiene: 100 },
  weights_version: 'v1',
  scored_at: '2026-05-04T18:00:00.000Z',
  scored_by: 'rule_based_v1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOllamaHealth.mockResolvedValue(passCheck('ollama_health'))
  mockSignalReview.mockResolvedValue(passCheck('signal_review'))
  mockSiteHealth.mockResolvedValue(passCheck('site_health'))
  mockFetchHistory.mockResolvedValue({
    task_type: 'daytime_tick',
    capacity_tier: 'tier_1_laptop_ollama',
    prior_durations_ms: [],
  })
  mockScoreDaytime.mockReturnValue(MOCK_QUALITY_SCORE)
})

// ── AC-1: shape ───────────────────────────────────────────────────────────────

describe('runDaytimeTick — shape (AC-1)', () => {
  it('returns a DaytimeTickResult with all required fields', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    expect(result.tick_id).toBeTruthy()
    expect(result.run_id).toBeTruthy()
    expect(result.mode).toBe('daytime_ollama')
    expect(result.checks).toHaveLength(3)
    expect(result.started_at).toBeTruthy()
    expect(result.finished_at).toBeTruthy()
    expect(typeof result.duration_ms).toBe('number')
    expect(typeof result.tunnel_used).toBe('boolean')
    expect(['completed', 'partial_failure', 'failed']).toContain(result.status)
  })

  it('check names are exactly ollama_health, signal_review, site_health', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    const names = result.checks.map((c) => c.name)
    expect(names).toContain('ollama_health')
    expect(names).toContain('signal_review')
    expect(names).toContain('site_health')
    expect(names).toHaveLength(3)
  })
})

// ── AC-3: exactly one agent_events row per invocation ─────────────────────────

describe('runDaytimeTick — agent_events write (AC-3)', () => {
  it('writes exactly one agent_events row per call', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    expect(b.insert).toHaveBeenCalledTimes(1)
  })

  it('row has domain=orchestrator, action=daytime_tick, actor=daytime_watchman', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    const row = b.insert.mock.calls[0][0]
    expect(row.domain).toBe('orchestrator')
    expect(row.action).toBe('daytime_tick')
    expect(row.actor).toBe('daytime_watchman')
  })

  it('tags include daytime_tick, step6.5, ollama, read_only', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    const tags = b.insert.mock.calls[0][0].tags as string[]
    expect(tags).toContain('daytime_tick')
    expect(tags).toContain('step6.5')
    expect(tags).toContain('ollama')
    expect(tags).toContain('read_only')
  })

  it('task_type = daytime_tick', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    expect(b.insert.mock.calls[0][0].task_type).toBe('daytime_tick')
  })
})

// ── AC-4: agent_events row shape and quality_score ────────────────────────────

describe('runDaytimeTick — quality_score (AC-4)', () => {
  it('row has quality_score with expected shape', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    const qs = b.insert.mock.calls[0][0].quality_score
    expect(qs.aggregate).toBe(78.5)
    expect(qs.capacity_tier).toBe('tier_1_laptop_ollama')
    expect(qs.scored_by).toBe('rule_based_v1')
    expect(qs.dimensions).toBeDefined()
  })

  it('meta includes mode=daytime_ollama, mapped_from=spec_v1, tunnel_used', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    const result = await runDaytimeTick()
    const meta = b.insert.mock.calls[0][0].meta
    expect(meta.mode).toBe('daytime_ollama')
    expect(meta.mapped_from).toBe('spec_v1')
    expect(meta.tick_id).toBe(result.tick_id)
    expect(meta.run_id).toBe(result.run_id)
    expect(typeof meta.tunnel_used).toBe('boolean')
  })

  it('fetchHistoricalContext called with task_type=daytime_tick', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    await runDaytimeTick()
    expect(mockFetchHistory).toHaveBeenCalledWith(
      expect.anything(),
      'daytime_tick',
      'tier_1_laptop_ollama'
    )
  })
})

// ── AC-5: Ollama unreachable → partial_failure ────────────────────────────────

describe('runDaytimeTick — Ollama unreachable (AC-5)', () => {
  beforeEach(() => {
    mockOllamaHealth.mockResolvedValue(failCheck('ollama_health'))
    mockSignalReview.mockResolvedValue(warnCheck('signal_review', 'skipped — Ollama unreachable'))
  })

  it('status = partial_failure when ollama_health fails', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    expect(result.status).toBe('partial_failure')
  })

  it('column status = warning when partial_failure', async () => {
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    expect(b.insert.mock.calls[0][0].status).toBe('warning')
  })

  it('checks contain ollama_health=fail and signal_review=warn', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    const oh = result.checks.find((c) => c.name === 'ollama_health')
    const sr = result.checks.find((c) => c.name === 'signal_review')
    expect(oh?.status).toBe('fail')
    expect(sr?.status).toBe('warn')
  })
})

// ── AC-6: timeout → status warn, signal_review=warn ──────────────────────────

describe('runDaytimeTick — generate timeout (AC-6)', () => {
  it('signal_review=warn with timed out flag when generate times out', async () => {
    mockSignalReview.mockResolvedValue(
      warnCheck('signal_review', 'Ollama generate timed out after 45s — signal_review degraded')
    )
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    const sr = result.checks.find((c) => c.name === 'signal_review')
    expect(sr?.status).toBe('warn')
    expect(sr?.flags[0].message).toContain('timed out')
  })
})

// ── AC-7: tunnel_used reflected in meta ───────────────────────────────────────

describe('runDaytimeTick — tunnel_used (AC-7)', () => {
  it('tunnel_used=false when OLLAMA_TUNNEL_URL is unset', async () => {
    const orig = process.env.OLLAMA_TUNNEL_URL
    delete process.env.OLLAMA_TUNNEL_URL
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    expect(result.tunnel_used).toBe(false)
    if (orig !== undefined) process.env.OLLAMA_TUNNEL_URL = orig
  })

  it('tunnel_used=true when OLLAMA_TUNNEL_URL is a non-localhost URL', async () => {
    process.env.OLLAMA_TUNNEL_URL = 'https://my-tunnel.trycloudflare.com'
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    expect(result.tunnel_used).toBe(true)
    delete process.env.OLLAMA_TUNNEL_URL
  })
})

// ── AC-8: feature flag ────────────────────────────────────────────────────────
// Feature flag is gated in the route, not runDaytimeTick itself.
// Tested here via the route handler; runDaytimeTick always runs when called.

// ── AC-11: heartbeat row written even when all checks fail ────────────────────

describe('runDaytimeTick — heartbeat guarantee (AC-11)', () => {
  it('writes agent_events row even when all checks fail', async () => {
    mockOllamaHealth.mockResolvedValue(failCheck('ollama_health'))
    mockSignalReview.mockResolvedValue(failCheck('signal_review'))
    mockSiteHealth.mockResolvedValue(failCheck('site_health'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    expect(b.insert).toHaveBeenCalledTimes(1)
    const row = b.insert.mock.calls[0][0]
    expect(row.status).toBe('error')
  })

  it('does not throw when a check rejects', async () => {
    mockOllamaHealth.mockRejectedValue(new Error('check crashed'))
    mockFrom.mockReturnValue(makeInsertBuilder())
    await expect(runDaytimeTick()).resolves.toBeDefined()
  })

  it('does not throw when agent_events insert throws', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('db crash')
    })
    await expect(runDaytimeTick()).resolves.toBeDefined()
  })

  it('status = failed when all 3 checks fail', async () => {
    mockOllamaHealth.mockResolvedValue(failCheck('ollama_health'))
    mockSignalReview.mockResolvedValue(failCheck('signal_review'))
    mockSiteHealth.mockResolvedValue(failCheck('site_health'))
    mockFrom.mockReturnValue(makeInsertBuilder())
    const result = await runDaytimeTick()
    expect(result.status).toBe('failed')
  })
})

// ── Scoring fallback ──────────────────────────────────────────────────────────

describe('runDaytimeTick — scoring fallback', () => {
  it('writes fallback quality_score when scoring throws', async () => {
    mockFetchHistory.mockRejectedValue(new Error('history fetch failed'))
    const b = makeInsertBuilder()
    mockFrom.mockReturnValue(b)
    await runDaytimeTick()
    expect(b.insert).toHaveBeenCalledTimes(1)
    const qs = b.insert.mock.calls[0][0].quality_score
    expect(qs.scored_by).toBe('rule_based_v1_fallback')
    expect(qs.aggregate).toBeNull()
  })
})

// ── AC-9: vercel.json cron entry ──────────────────────────────────────────────

describe('vercel.json daytime-tick cron entry (AC-9)', () => {
  it('vercel.json contains the daytime-tick cron at 0 18 * * *', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const vercelPath = path.resolve(process.cwd(), 'vercel.json')
    const content = fs.readFileSync(vercelPath, 'utf-8')
    const config = JSON.parse(content) as { crons?: Array<{ path: string; schedule: string }> }
    const entry = config.crons?.find((c) => c.path === '/api/cron/daytime-tick')
    expect(entry).toBeDefined()
    expect(entry?.schedule).toBe('0 18 * * *')
  })
})
