/**
 * Acceptance tests for migration 0051: RLS on harness-internal tables.
 *
 * Tables: entity_attribution, task_feedback, streamlit_modules,
 *         work_budget_sessions, work_budget_keyword_weights,
 *         pending_drain_triggers.
 *
 * F17 contract per table:
 *   - anon SELECT -> 0 rows (RLS denies all)
 *   - anon INSERT -> rejected (any error)
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               SUPABASE_SERVICE_ROLE_KEY
 *
 * Cleanup: pre-migration runs may insert test rows for 5 of 6 tables (the
 * 6th, task_feedback, has an FK to agent_events that blocks anon INSERT
 * before RLS even fires). afterAll deletes any leaked rows via service-role.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)

const TABLES = [
  'entity_attribution',
  'task_feedback',
  'streamlit_modules',
  'work_budget_sessions',
  'work_budget_keyword_weights',
  'pending_drain_triggers',
] as const

const STAMP_PREFIX = 'rls-test-0051'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function fakeRowFor(table: string, stamp: string): Record<string, unknown> {
  switch (table) {
    case 'entity_attribution':
      return {
        entity_type: 'rls_test',
        entity_id: ZERO_UUID,
        action: `${STAMP_PREFIX}-${stamp}`,
        actor_type: 'rls_test',
      }
    case 'task_feedback':
      // Will trip FK to agent_events before RLS pre-migration; OK.
      return { agent_event_id: ZERO_UUID }
    case 'streamlit_modules':
      return { path: `${STAMP_PREFIX}-${stamp}.py` }
    case 'work_budget_sessions':
      return {
        budget_minutes: 1,
        telegram_chat_id: `${STAMP_PREFIX}-${stamp}`,
      }
    case 'work_budget_keyword_weights':
      return { keyword: `${STAMP_PREFIX}-${stamp}`, weight_minutes: 0 }
    case 'pending_drain_triggers':
      return { triggered_by: `${STAMP_PREFIX}-${stamp}` }
    default:
      throw new Error(`unknown table ${table}`)
  }
}

describe.skipIf(!hasLiveDb)('migration 0051 — RLS on harness-internal tables', () => {
  let anonDb: SupabaseClient
  let serviceDb: SupabaseClient

  beforeAll(() => {
    anonDb = createClient(SUPABASE_URL!, ANON_KEY!)
    serviceDb = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  afterAll(async () => {
    // Clean up any rows that leaked in via pre-migration anon INSERTs.
    // Each table has a unique stamp-bearing column we can match on.
    await serviceDb.from('entity_attribution').delete().eq('entity_type', 'rls_test')
    await serviceDb.from('streamlit_modules').delete().like('path', `${STAMP_PREFIX}-%`)
    await serviceDb
      .from('work_budget_sessions')
      .delete()
      .like('telegram_chat_id', `${STAMP_PREFIX}-%`)
    await serviceDb
      .from('work_budget_keyword_weights')
      .delete()
      .like('keyword', `${STAMP_PREFIX}-%`)
    await serviceDb
      .from('pending_drain_triggers')
      .delete()
      .like('triggered_by', `${STAMP_PREFIX}-%`)
  })

  describe.each(TABLES)('table %s', (table) => {
    it('anon SELECT returns 0 rows', async () => {
      const { data, error } = await anonDb.from(table).select('*').limit(10)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('anon INSERT is rejected', async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { error } = await anonDb.from(table).insert(fakeRowFor(table, stamp))
      expect(error).not.toBeNull()
    })
  })
})
