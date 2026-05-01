/**
 * Integration test for migration 0049: knowledge.content_hash + unique index.
 *
 * Skipif pattern (matches 0044): tests run only when live Supabase env vars are
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

const cleanupKnowledgeIds: string[] = []

describe.skipIf(!hasLiveDb)('migration 0049 — knowledge content_hash unique index', () => {
  let db: SupabaseClient

  beforeAll(() => {
    db = createClient(SUPABASE_URL!, SERVICE_KEY!)
  })

  afterAll(async () => {
    if (cleanupKnowledgeIds.length > 0) {
      await db.from('knowledge').delete().in('id', cleanupKnowledgeIds)
    }
  })

  it('content_hash column exists and is generated', async () => {
    const { data, error } = await db
      .from('knowledge')
      .select('id, content_hash')
      .limit(1)
    expect(error).toBeNull()
    if (data && data.length > 0) {
      expect(typeof data[0].content_hash).toBe('string')
      expect(data[0].content_hash).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('rejects direct INSERT that duplicates (content_hash, entity) — unique index 23505', async () => {
    const probeTitle = `test-0049-${Date.now()}-unique-violation`
    const probeEntity = `test-0049-entity-${Date.now()}`

    // First insert succeeds
    const first = await db
      .from('knowledge')
      .insert({
        category: 'tip',
        domain: 'test',
        title: probeTitle,
        entity: probeEntity,
        problem: 'integration test for 0049',
        confidence: 0.5,
      })
      .select('id')
      .single()

    expect(first.error).toBeNull()
    expect(first.data?.id).toBeTruthy()
    if (first.data?.id) cleanupKnowledgeIds.push(first.data.id)

    // Second insert with identical (content fields, entity) must fail unique-constraint
    const second = await db.from('knowledge').insert({
      category: 'tip',
      domain: 'test',
      title: probeTitle,
      entity: probeEntity,
      problem: 'integration test for 0049',
      confidence: 0.5,
    })

    expect(second.error).not.toBeNull()
    expect(second.error!.code).toBe('23505') // unique_violation
  })

  it('allows INSERT with same content but different entity (entity scopes uniqueness)', async () => {
    const probeTitle = `test-0049-${Date.now()}-different-entity`

    const a = await db
      .from('knowledge')
      .insert({
        category: 'tip',
        domain: 'test',
        title: probeTitle,
        entity: `entity-A-${Date.now()}`,
        problem: 'same content body',
        confidence: 0.5,
      })
      .select('id')
      .single()
    expect(a.error).toBeNull()
    if (a.data?.id) cleanupKnowledgeIds.push(a.data.id)

    const b = await db
      .from('knowledge')
      .insert({
        category: 'tip',
        domain: 'test',
        title: probeTitle,
        entity: `entity-B-${Date.now()}`,
        problem: 'same content body',
        confidence: 0.5,
      })
      .select('id')
      .single()
    expect(b.error).toBeNull()
    if (b.data?.id) cleanupKnowledgeIds.push(b.data.id)
  })

  it('NULL entity participates in uniqueness via coalesce(entity, \'\') in the index', async () => {
    const probeTitle = `test-0049-${Date.now()}-null-entity-uniqueness`

    const a = await db
      .from('knowledge')
      .insert({
        category: 'tip',
        domain: 'test',
        title: probeTitle,
        entity: null,
        problem: 'null entity test',
        confidence: 0.5,
      })
      .select('id')
      .single()
    expect(a.error).toBeNull()
    if (a.data?.id) cleanupKnowledgeIds.push(a.data.id)

    // Second NULL-entity row with identical content must fail unique-constraint
    const b = await db.from('knowledge').insert({
      category: 'tip',
      domain: 'test',
      title: probeTitle,
      entity: null,
      problem: 'null entity test',
      confidence: 0.5,
    })
    expect(b.error).not.toBeNull()
    expect(b.error!.code).toBe('23505')
  })
})
