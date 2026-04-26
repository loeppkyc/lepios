/**
 * Tests for lib/harness/smoke-tests/cron-registration.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock node:fs and Supabase ─────────────────────────────────────────────────

const { mockInsert, mockFrom, mockReadFileSync } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockFrom = vi.fn()
  const mockReadFileSync = vi.fn()
  return { mockInsert, mockFrom, mockReadFileSync }
})

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  default: { readFileSync: mockReadFileSync },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  checkCronLimits,
  runCronRegistrationSmoke,
  type CronEntry,
} from '@/lib/harness/smoke-tests/cron-registration'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://lepios-one.vercel.app'

function makeInsertBuilder() {
  return { insert: mockInsert }
}

function makeConfigSelectBuilder(value: string | null) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue(
      value !== null ? { data: { value }, error: null } : { data: null, error: null }
    )
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, insert: mockInsert }
}

function makeVercelJson(crons: CronEntry[]): string {
  return JSON.stringify({ crons })
}

const DAILY_CRONS: CronEntry[] = [
  { path: '/api/cron/morning-digest', schedule: '0 12 * * *' },
  { path: '/api/cron/night-tick', schedule: '0 8 * * *' },
  { path: '/api/cron/task-pickup', schedule: '0 0 * * *' },
  { path: '/api/cron/deploy-gate-runner', schedule: '0 2 * * *' },
]

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── checkCronLimits — pure function ───────────────────────────────────────────

describe('checkCronLimits — pure function', () => {
  it('passes when no crons are registered', () => {
    const result = checkCronLimits([])
    expect(result.passed).toBe(true)
    expect(result.hourly_count).toBe(0)
    expect(result.schedules).toHaveLength(0)
  })

  it('passes when all crons are daily (hour field is a plain integer)', () => {
    const result = checkCronLimits(DAILY_CRONS)
    expect(result.passed).toBe(true)
    expect(result.hourly_count).toBe(0)
    expect(result.reason).toContain('Hobby plan compliant')
  })

  it('fails when a cron has hour field = * (runs every hour)', () => {
    const crons: CronEntry[] = [{ path: '/api/hourly', schedule: '0 * * * *' }]
    const result = checkCronLimits(crons)
    expect(result.passed).toBe(false)
    expect(result.hourly_count).toBe(1)
    expect(result.reason).toContain('0 * * * *')
    expect(result.reason).toContain('/api/hourly')
  })

  it('fails when a cron uses step notation (*/2) in the hour field', () => {
    const crons: CronEntry[] = [{ path: '/api/step', schedule: '0 */2 * * *' }]
    const result = checkCronLimits(crons)
    expect(result.passed).toBe(false)
    expect(result.hourly_count).toBe(1)
    expect(result.reason).toContain('0 */2 * * *')
  })

  it('fails when a cron uses comma-list notation in the hour field (0,12)', () => {
    const crons: CronEntry[] = [{ path: '/api/twice', schedule: '0 0,12 * * *' }]
    const result = checkCronLimits(crons)
    expect(result.passed).toBe(false)
    expect(result.hourly_count).toBe(1)
    expect(result.reason).toContain('0 0,12 * * *')
  })

  it('counts multiple hourly crons correctly', () => {
    const crons: CronEntry[] = [
      ...DAILY_CRONS,
      { path: '/api/hourly-1', schedule: '0 * * * *' },
      { path: '/api/hourly-2', schedule: '0 */3 * * *' },
    ]
    const result = checkCronLimits(crons)
    expect(result.passed).toBe(false)
    expect(result.hourly_count).toBe(2)
    expect(result.reason).toContain('/api/hourly-1')
    expect(result.reason).toContain('/api/hourly-2')
  })

  it('marks each schedule entry with is_hourly correctly', () => {
    const crons: CronEntry[] = [
      { path: '/api/daily', schedule: '0 9 * * *' },
      { path: '/api/hourly', schedule: '0 * * * *' },
      { path: '/api/weekly', schedule: '0 9 * * 0' },
    ]
    const result = checkCronLimits(crons)
    expect(result.schedules).toHaveLength(3)

    const daily = result.schedules.find((s) => s.path === '/api/daily')
    const hourly = result.schedules.find((s) => s.path === '/api/hourly')
    const weekly = result.schedules.find((s) => s.path === '/api/weekly')

    expect(daily?.is_hourly).toBe(false)
    expect(hourly?.is_hourly).toBe(true)
    expect(weekly?.is_hourly).toBe(false)
  })

  it('reason includes cron count on pass', () => {
    const result = checkCronLimits(DAILY_CRONS)
    expect(result.reason).toContain(`${DAILY_CRONS.length} crons`)
  })
})

// ── runCronRegistrationSmoke — all daily (pass) ───────────────────────────────

describe('runCronRegistrationSmoke — all daily crons (pass)', () => {
  it('returns passed=true when vercel.json has no hourly crons', async () => {
    mockReadFileSync.mockReturnValue(makeVercelJson(DAILY_CRONS))
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await runCronRegistrationSmoke(BASE_URL)

    expect(result.passed).toBe(true)
    expect(result.details.hourly_count).toBe(0)
  })

  it('inserts smoke_test_passed into agent_events on pass', async () => {
    mockReadFileSync.mockReturnValue(makeVercelJson(DAILY_CRONS))
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runCronRegistrationSmoke(BASE_URL)

    expect(mockFrom).toHaveBeenCalledWith('agent_events')
    const insertCall = mockInsert.mock.calls[0][0]
    expect(insertCall.action).toBe('smoke_test_passed')
    expect(insertCall.actor).toBe('cron-registration')
    expect(insertCall.domain).toBe('harness')
    expect(insertCall.status).toBe('success')
    expect(insertCall.meta.hourly_count).toBe(0)
  })

  it('does NOT insert outbound_notifications on pass', async () => {
    mockReadFileSync.mockReturnValue(makeVercelJson(DAILY_CRONS))
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runCronRegistrationSmoke(BASE_URL)

    const notifCalls = mockFrom.mock.calls.filter(
      (c: unknown[]) => c[0] === 'outbound_notifications'
    )
    expect(notifCalls).toHaveLength(0)
  })

  it('does NOT insert task_queue on pass', async () => {
    mockReadFileSync.mockReturnValue(makeVercelJson(DAILY_CRONS))
    mockFrom.mockReturnValue(makeInsertBuilder())

    await runCronRegistrationSmoke(BASE_URL)

    const taskCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'task_queue')
    expect(taskCalls).toHaveLength(0)
  })
})

// ── runCronRegistrationSmoke — hourly cron detected (fail) ────────────────────

describe('runCronRegistrationSmoke — hourly cron detected (fail)', () => {
  const crons: CronEntry[] = [...DAILY_CRONS, { path: '/api/hourly-leak', schedule: '0 * * * *' }]

  beforeEach(() => {
    mockReadFileSync.mockReturnValue(makeVercelJson(crons))
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })
  })

  it('returns passed=false when an hourly cron is present', async () => {
    const result = await runCronRegistrationSmoke(BASE_URL)
    expect(result.passed).toBe(false)
    expect(result.details.hourly_count).toBe(1)
    expect(result.reason).toContain('/api/hourly-leak')
    expect(result.reason).toContain('0 * * * *')
  })

  it('inserts smoke_test_failed into agent_events', async () => {
    await runCronRegistrationSmoke(BASE_URL)

    const agentCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'agent_events')
    expect(agentCalls.length).toBeGreaterThanOrEqual(1)

    const failInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return (
        typeof row === 'object' &&
        row !== null &&
        row.action === 'smoke_test_failed' &&
        row.actor === 'cron-registration'
      )
    })
    expect(failInsert).toBeDefined()
    const row = failInsert![0] as Record<string, unknown>
    expect(row.status).toBe('error')
    expect(row.domain).toBe('harness')
  })

  it('inserts outbound_notifications Telegram alert', async () => {
    await runCronRegistrationSmoke(BASE_URL)

    const notifCalls = mockFrom.mock.calls.filter(
      (c: unknown[]) => c[0] === 'outbound_notifications'
    )
    expect(notifCalls).toHaveLength(1)

    const notifInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.channel === 'telegram'
    })
    expect(notifInsert).toBeDefined()
    const row = notifInsert![0] as Record<string, unknown>
    expect((row.payload as Record<string, unknown>).text).toContain('/api/hourly-leak')
    expect(row.requires_response).toBe(false)
  })

  it('inserts task_queue row with priority=1', async () => {
    await runCronRegistrationSmoke(BASE_URL)

    const taskCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'task_queue')
    expect(taskCalls).toHaveLength(1)

    const taskInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.priority === 1
    })
    expect(taskInsert).toBeDefined()
    const row = taskInsert![0] as Record<string, unknown>
    expect(row.priority).toBe(1)
    expect(row.source).toBe('cron')
  })
})

// ── runCronRegistrationSmoke — vercel.json missing ────────────────────────────

describe('runCronRegistrationSmoke — vercel.json missing (file read error)', () => {
  beforeEach(() => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })
    mockFrom.mockReturnValue(makeInsertBuilder())
  })

  it('returns passed=false with error message in reason', async () => {
    const result = await runCronRegistrationSmoke(BASE_URL)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('vercel.json read failed')
    expect(result.reason).toContain('ENOENT')
  })

  it('inserts smoke_test_failed into agent_events on file error', async () => {
    await runCronRegistrationSmoke(BASE_URL)

    const failInsert = mockInsert.mock.calls.find((c: unknown[]) => {
      const row = c[0] as Record<string, unknown>
      return row.action === 'smoke_test_failed'
    })
    expect(failInsert).toBeDefined()
  })

  it('never throws — DB errors are swallowed too', async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error('db connection failed')
    })
    await expect(runCronRegistrationSmoke(BASE_URL)).resolves.toBeDefined()
  })
})

// ── runCronRegistrationSmoke — cronsOverride bypasses file read ───────────────

describe('runCronRegistrationSmoke — cronsOverride', () => {
  it('uses the override crons without reading vercel.json', async () => {
    mockFrom.mockReturnValue(makeInsertBuilder())

    const result = await runCronRegistrationSmoke(BASE_URL, DAILY_CRONS)

    expect(result.passed).toBe(true)
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('detects hourly cron from override without reading disk', async () => {
    const override: CronEntry[] = [{ path: '/api/hourly', schedule: '0 * * * *' }]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') return makeConfigSelectBuilder('123456')
      return makeInsertBuilder()
    })

    const result = await runCronRegistrationSmoke(BASE_URL, override)

    expect(result.passed).toBe(false)
    expect(result.details.hourly_count).toBe(1)
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })
})
