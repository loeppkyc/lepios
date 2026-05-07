/**
 * Tests for app/api/vehicles-data/* routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(
    (): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser }, from: mockFrom })),
}))

import { GET } from '@/app/api/vehicles-data/route'
import { POST as postMaint, DELETE as delMaint } from '@/app/api/vehicles-data/maintenance/route'

beforeEach(() => {
  mockFrom.mockReset()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-06T12:00:00Z'))
})

describe('GET /api/vehicles-data', () => {
  it('returns 401 unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockFrom.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('computes km_driven and km_per_month per vehicle', async () => {
    const seenTables: string[] = []
    mockFrom.mockImplementation((table: string) => {
      seenTables.push(table)
      if (table === 'vehicles') {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'tesla',
                    name: 'Tesla',
                    year: 2022,
                    make: 'Tesla',
                    model: 'Model Y',
                    trim: 'LR',
                    classification: 'business',
                    business_use_pct: 100,
                    purchased_at: '2025-01-15',
                    purchase_price: 40500,
                    km_at_purchase: 72000,
                    current_km: 112800,
                    current_value_estimate: 32000,
                    current_value_source: 'manual',
                    current_value_notes: null,
                    current_value_updated_at: null,
                    loan_status: 'paid_off',
                    loan_paid_off_at: '2026-04-13',
                    loan_remaining: 0,
                    notes: null,
                    display_order: 1,
                  },
                ],
                error: null,
              }),
          }),
        }
      }
      if (table === 'vehicle_maintenance') {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'm1',
                    vehicle_id: 'tesla',
                    service_date: '2026-04-01',
                    km: 110000,
                    service: 'Tire rotation',
                    cost: 80,
                    notes: null,
                  },
                ],
                error: null,
              }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })
    const res = await GET()
    const body = await res.json()
    const tesla = body.vehicles[0]
    expect(tesla.km_driven).toBe(40800)
    expect(tesla.months_owned).toBeGreaterThan(15)
    expect(tesla.km_per_month).toBeGreaterThan(2000)
    expect(tesla.maintenance).toHaveLength(1)
    expect(tesla.total_maintenance_cost).toBe(80)
    expect(body.totalCurrentValue).toBe(32000)
    expect(body.totalMaintenanceCost).toBe(80)
  })
})

describe('POST /api/vehicles-data/maintenance', () => {
  it('rejects missing vehicle_id', async () => {
    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      }),
    })
    const res = await postMaint(
      new Request('http://localhost/api/vehicles-data/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_date: '2026-04-01', service: 'Tire' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects malformed service_date', async () => {
    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      }),
    })
    const res = await postMaint(
      new Request('http://localhost/api/vehicles-data/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: 'v1', service_date: '04/01/2026', service: 'Tire' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('inserts a valid maintenance row', async () => {
    let captured: unknown = null
    mockFrom.mockReturnValue({
      insert: (row: unknown) => {
        captured = row
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'new', ...(row as object) }, error: null }),
          }),
        }
      },
    })
    const res = await postMaint(
      new Request('http://localhost/api/vehicles-data/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: 'v1',
          service_date: '2026-04-01',
          km: 110000,
          service: 'Tire rotation',
          cost: 80,
        }),
      })
    )
    expect(res.status).toBe(200)
    expect((captured as Record<string, unknown>).service).toBe('Tire rotation')
    expect((captured as Record<string, unknown>).cost).toBe(80)
  })
})

describe('DELETE /api/vehicles-data/maintenance', () => {
  it('rejects missing id', async () => {
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })
    const res = await delMaint(new Request('http://localhost/api/vehicles-data/maintenance'))
    expect(res.status).toBe(400)
  })
})
