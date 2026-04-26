/**
 * Integration tests for migration 0031: awaiting_grounding CHECK constraint.
 *
 * These tests require a live Supabase connection. They are skipped automatically
 * in CI/mock environments where the env vars are not set.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Grounding checkpoints (run in Supabase SQL editor after migration):
 *   -- Should fail with 23514:
 *   INSERT INTO task_queue (task, status) VALUES ('test', 'awaiting_grounding');
 *   -- Should succeed:
 *   INSERT INTO task_queue (task, status, grounding_question)
 *     VALUES ('test', 'awaiting_grounding', 'Is this working?');
 *   -- Should succeed (other statuses unaffected):
 *   INSERT INTO task_queue (task, status) VALUES ('test', 'queued');
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && SERVICE_KEY)

const cleanupIds: string[] = []

describe.skipIf(!hasLiveDb)(
  'migration 0031 — task_queue awaiting_grounding CHECK constraint',
  () => {
    let db: SupabaseClient

    beforeAll(() => {
      db = createClient(SUPABASE_URL!, SERVICE_KEY!)
    })

    afterAll(async () => {
      if (cleanupIds.length > 0) {
        await db.from('task_queue').delete().in('id', cleanupIds)
      }
    })

    it('rejects INSERT: status=awaiting_grounding, grounding_question=NULL', async () => {
      const { error } = await db.from('task_queue').insert({
        task: 'test-0031-null-question',
        status: 'awaiting_grounding',
        grounding_question: null,
        source: 'manual',
      })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('23514') // check_violation
    })

    it('rejects INSERT: status=awaiting_grounding, grounding_question omitted', async () => {
      const { error } = await db.from('task_queue').insert({
        task: 'test-0031-omitted-question',
        status: 'awaiting_grounding',
        source: 'manual',
      })
      expect(error).not.toBeNull()
      expect(error!.code).toBe('23514')
    })

    it('rejects UPDATE to status=awaiting_grounding when grounding_question is NULL', async () => {
      const { data, error: insertErr } = await db
        .from('task_queue')
        .insert({ task: 'test-0031-update-no-question', status: 'queued', source: 'manual' })
        .select('id')
        .single()
      expect(insertErr).toBeNull()
      cleanupIds.push(data!.id)

      const { error } = await db
        .from('task_queue')
        .update({ status: 'awaiting_grounding' })
        .eq('id', data!.id)
      expect(error).not.toBeNull()
      expect(error!.code).toBe('23514')
    })

    it('accepts INSERT: status=awaiting_grounding with grounding_question set', async () => {
      const { data, error } = await db
        .from('task_queue')
        .insert({
          task: 'test-0031-with-question',
          status: 'awaiting_grounding',
          grounding_question: 'Has the migration been verified?',
          source: 'manual',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      cleanupIds.push(data!.id)
    })

    it('accepts UPDATE to awaiting_grounding when grounding_question is set', async () => {
      const { data, error: insertErr } = await db
        .from('task_queue')
        .insert({ task: 'test-0031-update-with-question', status: 'queued', source: 'manual' })
        .select('id')
        .single()
      expect(insertErr).toBeNull()
      cleanupIds.push(data!.id)

      const { error } = await db
        .from('task_queue')
        .update({ status: 'awaiting_grounding', grounding_question: 'Ready to proceed?' })
        .eq('id', data!.id)
      expect(error).toBeNull()
    })

    it('accepts INSERT: other statuses with grounding_question=NULL (constraint is scoped)', async () => {
      const { data, error } = await db
        .from('task_queue')
        .insert({ task: 'test-0031-queued-null-ok', status: 'queued', source: 'manual' })
        .select('id')
        .single()
      expect(error).toBeNull()
      cleanupIds.push(data!.id)
    })
  }
)

if (!hasLiveDb) {
  describe('migration 0031 — awaiting_grounding CHECK constraint (skipped)', () => {
    it.skip(
      'requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — run against live DB to verify',
      () => {}
    )
  })
}
