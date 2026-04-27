import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/status/route'
import { getActiveSessions } from '@/lib/harness/window-tracker'
import { getComponentsWithHealth } from '@/lib/harness/component-health'

// Factories must not reference top-level variables (hoisting constraint)
vi.mock('@/lib/harness/window-tracker', () => ({ getActiveSessions: vi.fn() }))
vi.mock('@/lib/harness/component-health', () => ({ getComponentsWithHealth: vi.fn() }))
vi.mock('@/lib/harness/status-data', () => ({
  getIncidentLog: vi.fn().mockResolvedValue([]),
  get90DayBars: vi.fn().mockResolvedValue([]),
}))

const mockSessions = vi.mocked(getActiveSessions)
const mockComponents = vi.mocked(getComponentsWithHealth)

describe('GET /api/status', () => {
  it('returns HTTP 200 with correct shape', async () => {
    const sessions = [{ id: '1' }, { id: '2' }]
    const components = ['componentA', 'componentB']
    mockSessions.mockResolvedValue(sessions as never)
    mockComponents.mockResolvedValue(components as never)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active_sessions).toEqual(sessions)
    expect(body.count).toBe(sessions.length)
    expect(body.components).toEqual(components)
  })

  it('count equals sessions.length', async () => {
    const sessions = [{ id: '1' }, { id: '2' }, { id: '3' }]
    mockSessions.mockResolvedValue(sessions as never)
    mockComponents.mockResolvedValue([] as never)

    const res = await GET()
    const body = await res.json()
    expect(body.count).toBe(sessions.length)
  })

  it('response includes incident_log and uptime_bars fields', async () => {
    mockSessions.mockResolvedValue([] as never)
    mockComponents.mockResolvedValue([] as never)

    const res = await GET()
    const body = await res.json()
    expect(Array.isArray(body.incident_log)).toBe(true)
    expect(Array.isArray(body.uptime_bars)).toBe(true)
  })

  it('returns HTTP 500 when an import throws', async () => {
    mockSessions.mockRejectedValue(new Error('test error'))

    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('test error')
  })
})
