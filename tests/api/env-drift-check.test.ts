/**
 * Unit tests for app/api/cron/env-drift-check/route.ts.
 *
 * Spec: docs/specs/env-drift-check.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { GET } from '@/app/api/cron/env-drift-check/route'

const ORIGINAL_ENV = { ...process.env }
const VALID_SECRET = 'test-cron-secret-1234567890'

function authedRequest(): Request {
  return new Request('http://localhost/api/cron/env-drift-check', {
    headers: { authorization: `Bearer ${VALID_SECRET}` },
  })
}

function unauthedRequest(): Request {
  return new Request('http://localhost/api/cron/env-drift-check', {
    headers: { authorization: 'Bearer wrong' },
  })
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  process.env.CRON_SECRET = VALID_SECRET
  mockFrom.mockReset()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('env-drift-check', () => {
  it('returns 401 when unauthorized', async () => {
    const res = await GET(unauthedRequest())
    expect(res.status).toBe(401)
  })

  it('clean path: matching values for all shared keys → 200, mismatches:0, agent_events row written', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    process.env.TELEGRAM_CHAT_ID = '1234567890'

    const harnessRows = [
      { key: 'CRON_SECRET', value: VALID_SECRET },
      { key: 'TELEGRAM_CHAT_ID', value: '1234567890' },
    ]

    const inserts: unknown[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: harnessRows, error: null }),
          }),
        }
      }
      if (table === 'agent_events') {
        return { insert: (row: unknown) => { inserts.push(row); return Promise.resolve({ error: null }) } }
      }
      return { insert: () => Promise.resolve({ error: null }) }
    })

    const res = await GET(authedRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mismatches).toBe(0)
    expect(body.keys_checked).toBe(2)
    expect(inserts).toHaveLength(1)
    const ev = inserts[0] as { status: string; action: string }
    expect(ev.action).toBe('env.drift_check')
    expect(ev.status).toBe('success')
  })

  it('mismatch path: secrets differ → 200 ok:false, agent_events error, telegram queued, NO full secret leaked', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    process.env.TELEGRAM_CHAT_ID = '1234567890'

    const harnessRows = [
      { key: 'CRON_SECRET', value: 'WRONG-secret-different-value' },
      { key: 'TELEGRAM_CHAT_ID', value: '1234567890' },
    ]

    const inserts: { table: string; row: unknown }[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: harnessRows, error: null }),
            eq: () => ({
              single: () => Promise.resolve({ data: { value: '1234567890' }, error: null }),
            }),
          }),
        }
      }
      return { insert: (row: unknown) => { inserts.push({ table, row }); return Promise.resolve({ error: null }) } }
    })

    const res = await GET(authedRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.mismatches).toBe(1)

    const eventInsert = inserts.find((i) => i.table === 'agent_events')!
    expect(eventInsert).toBeDefined()
    expect((eventInsert.row as { status: string }).status).toBe('error')

    const notifInsert = inserts.find((i) => i.table === 'outbound_notifications')!
    expect(notifInsert).toBeDefined()
    const text = ((notifInsert.row as { payload: { text: string } }).payload).text
    expect(text).toContain('Env drift detected')
    expect(text).toContain('CRON_SECRET')
    // CRITICAL: never leak the full secret
    expect(text).not.toContain(VALID_SECRET)
    expect(text).not.toContain('WRONG-secret-different-value')
  })

  it('missing-vercel path: env var not set → flagged as mismatch with vercel_present:false', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    delete process.env.TELEGRAM_CHAT_ID

    const harnessRows = [
      { key: 'CRON_SECRET', value: VALID_SECRET },
      { key: 'TELEGRAM_CHAT_ID', value: '1234567890' },
    ]

    const inserts: { table: string; row: unknown }[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: harnessRows, error: null }),
            eq: () => ({
              single: () => Promise.resolve({ data: { value: '1234567890' }, error: null }),
            }),
          }),
        }
      }
      return { insert: (row: unknown) => { inserts.push({ table, row }); return Promise.resolve({ error: null }) } }
    })

    const res = await GET(authedRequest())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.mismatches).toBe(1)
    const tg = body.comparisons.find((c: { key: string }) => c.key === 'TELEGRAM_CHAT_ID')
    expect(tg.vercel_present).toBe(false)
    expect(tg.harness_present).toBe(true)
  })

  it('missing-harness path: harness_config row absent → flagged as mismatch with harness_present:false', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    process.env.TELEGRAM_CHAT_ID = '1234567890'

    // harness_config returns no rows
    const inserts: { table: string; row: unknown }[] = []
    mockFrom.mockImplementation((table: string) => {
      if (table === 'harness_config') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }
      }
      return { insert: (row: unknown) => { inserts.push({ table, row }); return Promise.resolve({ error: null }) } }
    })

    const res = await GET(authedRequest())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.mismatches).toBe(2) // both keys missing in harness
    expect(body.comparisons.every((c: { harness_present: boolean }) => c.harness_present === false)).toBe(true)
  })
})
