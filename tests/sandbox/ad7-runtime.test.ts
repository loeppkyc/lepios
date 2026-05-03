/**
 * AD7 GRANT-lockdown verification for the sandbox_runs table.
 *
 * Spec: sandbox acceptance doc §AD7 — append-only for service_role.
 * Verifies:
 *   - service_role can INSERT sandbox_runs rows
 *   - service_role can SELECT sandbox_runs rows
 *   - service_role can UPDATE allowed columns (cleaned_at, status — from cleanupSandbox)
 *   - service_role CANNOT DELETE sandbox_runs rows — permission denied
 *
 * Requires live Supabase env vars — skipped in CI without them.
 *
 * Note: test INSERT rows are intentionally NOT cleaned up after DELETE is tested.
 * sandbox_runs is append-only by design (AD7). Use sandbox_id='test:ad7-verify'
 * to identify test-origin rows.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && SERVICE_KEY)

const TEST_SANDBOX_ID = 'test:ad7-verify'
const TEST_AGENT_ID = 'test:ad7-sandbox-verify'

describe.skipIf(!hasLiveDb)('AD7 — sandbox_runs GRANT lockdown (live DB)', () => {
  let db: SupabaseClient
  let insertedId: string

  beforeAll(() => {
    db = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  it('service_role can SELECT from sandbox_runs', async () => {
    const { error, count } = await db
      .from('sandbox_runs')
      .select('*', { count: 'exact', head: true })

    expect(error).toBeNull()
    expect(typeof count).toBe('number')
  })

  it('service_role can INSERT into sandbox_runs', async () => {
    const { data, error } = await db
      .from('sandbox_runs')
      .insert({
        sandbox_id: TEST_SANDBOX_ID,
        agent_id: TEST_AGENT_ID,
        capability: 'test.ad7.verify',
        scope: { fs: { allowedPaths: ['.'] } },
        status: 'completed',
        worktree_path: '/tmp/test-worktree-ad7',
        base_sha: 'abc1234',
        cmd: 'echo ad7-test',
        warnings: ['process_isolation_not_enforced'],
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(typeof data!.id).toBe('string')
    insertedId = data!.id
  })

  it('service_role can UPDATE allowed columns (cleaned_at, status)', async () => {
    // This represents the cleanupSandbox() flow — only allowed columns
    const { error } = await db
      .from('sandbox_runs')
      .update({ status: 'cleaned', cleaned_at: new Date().toISOString() })
      .eq('id', insertedId)

    // Should succeed — these columns are in the GRANT UPDATE list
    expect(error).toBeNull()
  })

  it('service_role CANNOT DELETE from sandbox_runs — permission denied', async () => {
    const { error } = await db.from('sandbox_runs').delete().eq('sandbox_id', TEST_SANDBOX_ID)

    // PostgREST translates Postgres 42501 (insufficient_privilege) to a 4xx error.
    expect(error).not.toBeNull()
    const msg = error!.message?.toLowerCase() ?? ''
    const code = error!.code ?? ''
    expect(msg.includes('permission') || msg.includes('denied') || code === '42501').toBe(true)
  })
})

if (!hasLiveDb) {
  describe('AD7 — sandbox_runs GRANT lockdown (skipped)', () => {
    it.skip('requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — run against live DB to verify AD7', () => {})
  })
}
