/**
 * Acceptance tests for migration 0050: RLS on gmail_messages,
 * gmail_statement_arrivals, gmail_known_senders, window_sessions.
 *
 * F17 contract:
 *   - anon SELECT       -> 0 rows (RLS denies all)
 *   - anon INSERT       -> rejected (any error)
 *   - service_role SELECT -> succeeds (bypasses RLS)
 *
 * Skipif pattern (matches 0044): tests run only when live env vars set.
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               SUPABASE_SERVICE_ROLE_KEY
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)

const TABLES = [
  'gmail_messages',
  'gmail_statement_arrivals',
  'gmail_known_senders',
  'window_sessions',
] as const

function fakeRowFor(table: string): Record<string, unknown> {
  const stamp = `test-anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  switch (table) {
    case 'gmail_known_senders':
      return { email_address: `${stamp}@example.com` }
    case 'window_sessions':
      return { session_id: stamp }
    case 'gmail_messages':
      return { message_id: stamp, from_address: 'a@b.test', subject: '' }
    case 'gmail_statement_arrivals':
      return { message_id: stamp, account_name: 'X', arrival_date: '2026-01-01' }
    default:
      throw new Error(`unknown table ${table}`)
  }
}

describe.skipIf(!hasLiveDb)('migration 0050 — RLS on gmail + window_sessions', () => {
  let anonDb: SupabaseClient
  let serviceDb: SupabaseClient

  beforeAll(() => {
    anonDb = createClient(SUPABASE_URL!, ANON_KEY!)
    serviceDb = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  describe.each(TABLES)('table %s', (table) => {
    it('anon SELECT returns 0 rows', async () => {
      const { data, error } = await anonDb.from(table).select('*').limit(10)
      // PostgREST with RLS-no-policy returns empty array, not error
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('anon INSERT is rejected', async () => {
      const { error } = await anonDb.from(table).insert(fakeRowFor(table))
      expect(error).not.toBeNull()
    })

    it('service_role SELECT succeeds (bypasses RLS)', async () => {
      const { error, count } = await serviceDb
        .from(table)
        .select('*', { count: 'exact', head: true })
      expect(error).toBeNull()
      expect(typeof count).toBe('number')
    })
  })

  it('gmail_known_senders has the seeded merchant rows (service-role read)', async () => {
    const { count, error } = await serviceDb
      .from('gmail_known_senders')
      .select('*', { count: 'exact', head: true })
    expect(error).toBeNull()
    expect(count).toBeGreaterThanOrEqual(60) // 63 today, allow drift
  })
})
