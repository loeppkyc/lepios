/**
 * AD7 GRANT-lockdown verification for the agent_actions table.
 *
 * Spec: SECURITY_LAYER_SPEC.md §AD7 — "Runtime (live enforcement)" layer.
 * Verifies that service_role (the role used by createServiceClient) can INSERT and SELECT
 * on agent_actions but receives permission denied on UPDATE and DELETE.
 *
 * Requires live Supabase env vars — skipped in CI without them.
 *
 * Note: test INSERT rows are intentionally NOT cleaned up. agent_actions is append-only
 * by design (AD7). Rows persist as proof of this test's execution.
 * Use agent_id='test:ad7-verify' to identify test-origin rows.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && SERVICE_KEY)

const TEST_AGENT_ID = 'test:ad7-verify'

describe.skipIf(!hasLiveDb)('AD7 — agent_actions GRANT lockdown (live DB)', () => {
  let db: SupabaseClient
  let insertedId: string

  beforeAll(() => {
    db = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  it('service_role can SELECT from agent_actions', async () => {
    const { error, count } = await db
      .from('agent_actions')
      .select('*', { count: 'exact', head: true })

    expect(error).toBeNull()
    expect(typeof count).toBe('number')
  })

  it('service_role can INSERT into agent_actions', async () => {
    const { data, error } = await db
      .from('agent_actions')
      .insert({
        agent_id: TEST_AGENT_ID,
        capability: 'test.ad7.verify',
        action_type: 'cap_check',
        result: 'allowed',
        reason: 'ad7_test_insert',
        enforcement_mode: 'log_only',
        context: { test: 'ad7-grant-lockdown-verification' },
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(typeof data!.id).toBe('string')
    insertedId = data!.id
  })

  it('service_role CANNOT UPDATE agent_actions rows — permission denied', async () => {
    // Use the row inserted above or fall back to any existing test row
    const filter = insertedId
      ? db.from('agent_actions').update({ reason: 'tampered' }).eq('id', insertedId)
      : db.from('agent_actions').update({ reason: 'tampered' }).eq('agent_id', TEST_AGENT_ID)

    const { error } = await filter

    // PostgREST translates Postgres 42501 (insufficient_privilege) to a 4xx error.
    // The error object will be non-null.
    expect(error).not.toBeNull()
    // Error message or code indicates permission denied
    const msg = error!.message?.toLowerCase() ?? ''
    const code = error!.code ?? ''
    expect(msg.includes('permission') || msg.includes('denied') || code === '42501').toBe(true)
  })

  it('service_role CANNOT DELETE from agent_actions — permission denied', async () => {
    const { error } = await db.from('agent_actions').delete().eq('agent_id', TEST_AGENT_ID)

    expect(error).not.toBeNull()
    const msg = error!.message?.toLowerCase() ?? ''
    const code = error!.code ?? ''
    expect(msg.includes('permission') || msg.includes('denied') || code === '42501').toBe(true)
  })
})

if (!hasLiveDb) {
  describe('AD7 — agent_actions GRANT lockdown (skipped)', () => {
    it.skip('requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — run against live DB to verify AD7', () => {})
  })
}
