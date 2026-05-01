import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getIncidentLog, get90DayBars } from '@/lib/harness/status-data'

// ── Mock Supabase service client ──────────────────────────────────────────────

const mockSelect = vi.fn()
const mockIn = vi.fn()
const mockEq = vi.fn()
const mockGte = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()

const chainableQuery = {
  select: mockSelect,
  in: mockIn,
  eq: mockEq,
  gte: mockGte,
  order: mockOrder,
  limit: mockLimit,
}

// Each chained method returns the same object so tests can chain freely
mockSelect.mockReturnValue(chainableQuery)
mockIn.mockReturnValue(chainableQuery)
mockEq.mockReturnValue(chainableQuery)
mockGte.mockReturnValue(chainableQuery)
mockOrder.mockReturnValue(chainableQuery)
mockLimit.mockReturnValue({ data: [], error: null })

const mockFrom = vi.fn(() => chainableQuery)

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

// ── getIncidentLog ────────────────────────────────────────────────────────────

describe('getIncidentLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array on DB error', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: new Error('db down') })
    const result = await getIncidentLog()
    expect(result).toEqual([])
  })

  it('returns mapped incidents on success', async () => {
    const row = {
      id: 'abc',
      occurred_at: '2026-04-27T12:00:00Z',
      domain: 'orchestrator',
      action: 'drain_trigger_failed',
      actor: 'coordinator',
      status: 'warning',
      error_message: 'http 403',
    }
    mockLimit.mockResolvedValueOnce({ data: [row], error: null })
    const result = await getIncidentLog(10)
    expect(result).toHaveLength(1)
    expect(result[0].action).toBe('drain_trigger_failed')
    expect(result[0].status).toBe('warning')
  })

  it('queries only error and warning statuses', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })
    await getIncidentLog()
    expect(mockIn).toHaveBeenCalledWith('status', ['error', 'warning'])
  })
})

// ── get90DayBars ──────────────────────────────────────────────────────────────

describe('get90DayBars', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns exactly 90 bars', async () => {
    // mockGte resolves at the end of the chain without .limit() for this query
    mockGte.mockResolvedValueOnce({ data: [] })
    const bars = await get90DayBars()
    expect(bars).toHaveLength(90)
  })

  it('marks days with no events as "none"', async () => {
    mockGte.mockResolvedValueOnce({ data: [] })
    const bars = await get90DayBars()
    expect(bars.every((b) => b.status === 'none')).toBe(true)
  })

  it('marks a day green when only success events', async () => {
    const today = new Date().toISOString()
    mockGte.mockResolvedValueOnce({
      data: [{ occurred_at: today, status: 'success' }],
    })
    const bars = await get90DayBars()
    const last = bars[bars.length - 1]
    expect(last.status).toBe('green')
    expect(last.successCount).toBe(1)
    expect(last.errorCount).toBe(0)
  })

  it('marks a day red when only error events', async () => {
    const today = new Date().toISOString()
    mockGte.mockResolvedValueOnce({
      data: [{ occurred_at: today, status: 'error' }],
    })
    const bars = await get90DayBars()
    const last = bars[bars.length - 1]
    expect(last.status).toBe('red')
  })

  it('marks a day amber when mixed success and error', async () => {
    const today = new Date().toISOString()
    mockGte.mockResolvedValueOnce({
      data: [
        { occurred_at: today, status: 'success' },
        { occurred_at: today, status: 'error' },
      ],
    })
    const bars = await get90DayBars()
    const last = bars[bars.length - 1]
    expect(last.status).toBe('amber')
  })

  it('counts warning as error for bar coloring', async () => {
    const today = new Date().toISOString()
    mockGte.mockResolvedValueOnce({
      data: [{ occurred_at: today, status: 'warning' }],
    })
    const bars = await get90DayBars()
    const last = bars[bars.length - 1]
    expect(last.status).toBe('red')
    expect(last.errorCount).toBe(1)
  })
})
