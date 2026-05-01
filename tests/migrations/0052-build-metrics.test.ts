/**
 * Acceptance tests for migration 0052: build_metrics + build_metrics_summary.
 *
 * F17 contract:
 *   - lifecycle: insert (start) + update (finish) produces a complete row with
 *     a wall-clock interval that matches started_at -> completed_at
 *   - summary view: aggregates by (task_type, week) and computes the rate
 *     metrics (wall_clock_per_claude_day_estimate, active_minutes_per_claude_day_estimate)
 *   - RLS:
 *       anon SELECT       -> 0 rows
 *       anon INSERT       -> rejected
 *       service_role read -> succeeds
 *
 * Skipif pattern (matches 0050/0051): tests run only when live env vars set.
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               SUPABASE_SERVICE_ROLE_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)

const SENTINEL_PREFIX = 'test-build-metrics-acceptance-'
const TEST_TASK_ID = `${SENTINEL_PREFIX}lifecycle`
const SUMMARY_TASK_ID_A = `${SENTINEL_PREFIX}summary-a`
const SUMMARY_TASK_ID_B = `${SENTINEL_PREFIX}summary-b`
// Use a week far outside any real range so the summary view aggregates only test rows.
const TEST_WEEK = 9999

describe.skipIf(!hasLiveDb)('migration 0052 -- build_metrics', () => {
  let anonDb: SupabaseClient
  let serviceDb: SupabaseClient

  beforeAll(async () => {
    anonDb = createClient(SUPABASE_URL!, ANON_KEY!)
    serviceDb = createClient(SUPABASE_URL!, SERVICE_KEY!)
    await serviceDb.from('build_metrics').delete().like('task_id', `${SENTINEL_PREFIX}%`)
  })

  afterAll(async () => {
    await serviceDb.from('build_metrics').delete().like('task_id', `${SENTINEL_PREFIX}%`)
  })

  it('start + finish creates a complete row with wall-clock interval matching started_at -> completed_at', async () => {
    const startedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString() // 90 min ago

    const insert = await serviceDb.from('build_metrics').insert({
      task_id: TEST_TASK_ID,
      week: TEST_WEEK,
      day_label: 'Mon',
      description: 'acceptance test row',
      estimate_claude_days: 0.5,
      estimate_source: 'claude_chat',
      task_type: 'port',
      started_at: startedAt,
    })
    expect(insert.error).toBeNull()

    const update = await serviceDb
      .from('build_metrics')
      .update({
        completed_at: new Date().toISOString(),
        active_minutes: 60,
        parallel_windows: 2,
        clear_resets: 1,
        reviewer_rejections: 0,
        first_try_pass: true,
        notes: 'shipped clean',
      })
      .eq('task_id', TEST_TASK_ID)
    expect(update.error).toBeNull()

    const { data, error } = await serviceDb
      .from('build_metrics')
      .select('*')
      .eq('task_id', TEST_TASK_ID)
      .single()

    expect(error).toBeNull()
    expect(data?.active_minutes).toBe(60)
    expect(data?.parallel_windows).toBe(2)
    expect(data?.clear_resets).toBe(1)
    expect(data?.first_try_pass).toBe(true)
    expect(data?.task_type).toBe('port')
    expect(data?.estimate_source).toBe('claude_chat')
    expect(data?.completed_at).toBeTruthy()

    const wallClockMs =
      new Date(data!.completed_at!).getTime() - new Date(data!.started_at).getTime()
    const wallClockMin = wallClockMs / 60000
    expect(wallClockMin).toBeGreaterThanOrEqual(89)
    expect(wallClockMin).toBeLessThanOrEqual(91)
  })

  it('summary view aggregates by (task_type, week) and computes rate metrics', async () => {
    // Seed two completed rows in the test week, both task_type='migration'.
    const now = Date.now()
    const rowA = {
      task_id: SUMMARY_TASK_ID_A,
      week: TEST_WEEK,
      day_label: 'Mon',
      description: 'summary fixture A',
      estimate_claude_days: 0.25,
      estimate_source: 'self' as const,
      task_type: 'migration' as const,
      started_at: new Date(now - 60 * 60 * 1000).toISOString(),
      completed_at: new Date(now).toISOString(),
      active_minutes: 45,
      parallel_windows: 1,
      clear_resets: 0,
      reviewer_rejections: 0,
      first_try_pass: true,
    }
    const rowB = {
      task_id: SUMMARY_TASK_ID_B,
      week: TEST_WEEK,
      day_label: 'Mon',
      description: 'summary fixture B',
      estimate_claude_days: 0.25,
      estimate_source: 'self' as const,
      task_type: 'migration' as const,
      started_at: new Date(now - 30 * 60 * 1000).toISOString(),
      completed_at: new Date(now).toISOString(),
      active_minutes: 25,
      parallel_windows: 1,
      clear_resets: 0,
      reviewer_rejections: 1,
      first_try_pass: false,
    }

    const insert = await serviceDb.from('build_metrics').insert([rowA, rowB])
    expect(insert.error).toBeNull()

    const { data, error } = await serviceDb
      .from('build_metrics_summary')
      .select('*')
      .eq('week', TEST_WEEK)
      .eq('task_type', 'migration')
      .single()

    expect(error).toBeNull()
    expect(data?.task_count).toBe(2)
    expect(data?.estimate_claude_days_total).toBe(0.5)
    expect(data?.active_minutes_total).toBe(70)
    // Wall-clock = ~60 + ~30 = ~90 min. Allow ±2 min for timing jitter.
    expect(data?.wall_clock_minutes).toBeGreaterThanOrEqual(88)
    expect(data?.wall_clock_minutes).toBeLessThanOrEqual(92)
    // active per claude-day = 70 / 0.5 = 140
    expect(data?.active_minutes_per_claude_day_estimate).toBe(140)
    // wall-clock per claude-day ~= 90 / 0.5 = ~180 (±a few)
    expect(data?.wall_clock_per_claude_day_estimate).toBeGreaterThanOrEqual(176)
    expect(data?.wall_clock_per_claude_day_estimate).toBeLessThanOrEqual(184)
    expect(data?.first_try_pass_count).toBe(1)
    expect(data?.reviewer_rejections_total).toBe(1)
    expect(data?.avg_parallel_windows).toBe(1)
  })

  it('anon SELECT returns 0 rows', async () => {
    const { data, error } = await anonDb.from('build_metrics').select('*').limit(10)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon INSERT is rejected', async () => {
    const { error } = await anonDb.from('build_metrics').insert({
      task_id: `${SENTINEL_PREFIX}anon-attempt`,
      week: TEST_WEEK,
      day_label: 'Mon',
    })
    expect(error).not.toBeNull()
  })

  it('service_role SELECT succeeds (bypasses RLS)', async () => {
    const { error, count } = await serviceDb
      .from('build_metrics')
      .select('*', { count: 'exact', head: true })
    expect(error).toBeNull()
    expect(typeof count).toBe('number')
  })

  it('summary view is anon-denied (inherits RLS from underlying table)', async () => {
    const { data, error } = await anonDb.from('build_metrics_summary').select('*').limit(10)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
