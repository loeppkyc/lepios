/**
 * Integration tests for migration 0044: decisions_log + knowledge.entity UNIQUE +
 * mirror trigger.
 *
 * Skipif pattern (matches 0031): tests run only when live Supabase env vars are
 * set. CI without those vars sees the suite as skipped (not failed).
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLiveDb = Boolean(SUPABASE_URL && SERVICE_KEY)

const cleanupDecisionIds: string[] = []
const cleanupKnowledgeEntities: string[] = []

describe.skipIf(!hasLiveDb)('migration 0044 — decisions_log + mirror trigger', () => {
  let db: SupabaseClient

  beforeAll(() => {
    db = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  afterAll(async () => {
    if (cleanupDecisionIds.length > 0) {
      await db.from('decisions_log').delete().in('id', cleanupDecisionIds)
    }
    if (cleanupKnowledgeEntities.length > 0) {
      await db.from('knowledge').delete().in('entity', cleanupKnowledgeEntities)
    }
  })

  it('decisions_log table exists and is queryable', async () => {
    const { error, count } = await db
      .from('decisions_log')
      .select('*', { count: 'exact', head: true })
    expect(error).toBeNull()
    expect(typeof count).toBe('number')
  })

  it('rejects INSERT with invalid source enum (CHECK constraint)', async () => {
    const { error } = await db.from('decisions_log').insert({
      topic: 'test-0044-invalid-source',
      chosen_path: 'irrelevant',
      source: 'not_a_valid_source',
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')
  })

  it('rejects INSERT with invalid category enum (CHECK constraint)', async () => {
    const { error } = await db.from('decisions_log').insert({
      topic: 'test-0044-invalid-category',
      chosen_path: 'irrelevant',
      source: 'redline_session',
      category: 'made-up',
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')
  })

  it('accepts a minimal valid INSERT and applies defaults', async () => {
    const { data, error } = await db
      .from('decisions_log')
      .insert({
        topic: 'test-0044-minimal',
        chosen_path: 'do the thing',
        source: 'redline_session',
      })
      .select('id, category, decided_by, options_considered, tags, related_files')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    cleanupDecisionIds.push(data!.id)
    cleanupKnowledgeEntities.push('decisions_log:' + data!.id)

    expect(data!.category).toBe('architecture')
    expect(data!.decided_by).toBe('colin')
    expect(data!.options_considered).toEqual([])
    expect(data!.tags).toEqual([])
    expect(data!.related_files).toEqual([])
  })

  it('mirror trigger writes to knowledge with category=decision, domain=memory', async () => {
    const { data: inserted, error: insertErr } = await db
      .from('decisions_log')
      .insert({
        topic: 'test-0044-mirror',
        chosen_path: 'mirror should fire',
        source: 'redline_session',
        tags: ['test', 'mirror'],
      })
      .select('id')
      .single()

    expect(insertErr).toBeNull()
    const decisionId = inserted!.id
    cleanupDecisionIds.push(decisionId)
    const entity = 'decisions_log:' + decisionId
    cleanupKnowledgeEntities.push(entity)

    const { data: mirrored, error: readErr } = await db
      .from('knowledge')
      .select('entity, category, domain, title, solution, confidence, tags')
      .eq('entity', entity)
      .single()

    expect(readErr).toBeNull()
    expect(mirrored).not.toBeNull()
    expect(mirrored!.category).toBe('decision')
    expect(mirrored!.domain).toBe('memory')
    expect(mirrored!.title).toBe('test-0044-mirror')
    expect(mirrored!.solution).toBe('mirror should fire')
    expect(mirrored!.confidence).toBeGreaterThan(0.8) // active row → 0.85
    expect(mirrored!.tags).toEqual(['test', 'mirror'])
  })

  it('UPDATE re-fires trigger and refreshes mirrored row', async () => {
    const { data: inserted } = await db
      .from('decisions_log')
      .insert({
        topic: 'test-0044-update-original',
        chosen_path: 'original path',
        source: 'redline_session',
      })
      .select('id')
      .single()

    const decisionId = inserted!.id
    cleanupDecisionIds.push(decisionId)
    const entity = 'decisions_log:' + decisionId
    cleanupKnowledgeEntities.push(entity)

    const { error: updateErr } = await db
      .from('decisions_log')
      .update({ chosen_path: 'updated path', updated_at: new Date().toISOString() })
      .eq('id', decisionId)
    expect(updateErr).toBeNull()

    const { data: mirrored } = await db
      .from('knowledge')
      .select('solution')
      .eq('entity', entity)
      .single()

    expect(mirrored!.solution).toBe('updated path')
  })

  it('superseded_at non-null halves the mirrored confidence', async () => {
    const { data: inserted } = await db
      .from('decisions_log')
      .insert({
        topic: 'test-0044-supersede',
        chosen_path: 'will be superseded',
        source: 'redline_session',
      })
      .select('id')
      .single()

    const decisionId = inserted!.id
    cleanupDecisionIds.push(decisionId)
    const entity = 'decisions_log:' + decisionId
    cleanupKnowledgeEntities.push(entity)

    // Stamp superseded_at
    await db
      .from('decisions_log')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', decisionId)

    const { data: mirrored } = await db
      .from('knowledge')
      .select('confidence')
      .eq('entity', entity)
      .single()

    expect(mirrored!.confidence).toBeLessThan(0.5) // halved → 0.40
  })

  it('partial unique index rejects duplicate decisions_log: entities', async () => {
    // Migration 0044 uses a partial unique index scoped to 'decisions_log:%'
    // (Option A redline). Memory-layer rows are unique-by-entity; pre-existing
    // personal-archive dups are untouched.
    const entity = 'decisions_log:test-0044-' + Date.now()
    cleanupKnowledgeEntities.push(entity)

    const { error: e1 } = await db.from('knowledge').insert({
      entity,
      category: 'decision',
      domain: 'memory',
      title: 'first',
    })
    expect(e1).toBeNull()

    const { error: e2 } = await db.from('knowledge').insert({
      entity,
      category: 'decision',
      domain: 'memory',
      title: 'duplicate',
    })
    expect(e2).not.toBeNull()
    expect(e2!.code).toBe('23505') // unique_violation
  })

  it('partial unique index does NOT apply to non-prefixed entities', async () => {
    // Existing personal-archive dups (e.g. "Janice Jones") must still be
    // insertable until the knowledge_dedupe chunk runs.
    const entity = 'test-0044-non-prefix-' + Date.now()
    cleanupKnowledgeEntities.push(entity)

    const { error: e1 } = await db.from('knowledge').insert({
      entity,
      category: 'rule',
      domain: 'test',
      title: 'first',
    })
    expect(e1).toBeNull()

    const { error: e2 } = await db.from('knowledge').insert({
      entity,
      category: 'rule',
      domain: 'test',
      title: 'duplicate-allowed-outside-memory-prefix',
    })
    expect(e2).toBeNull()
  })
})

if (!hasLiveDb) {
  describe('migration 0044 — decisions_log (skipped)', () => {
    it.skip('requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — run against live DB to verify', () => {})
  })
}
