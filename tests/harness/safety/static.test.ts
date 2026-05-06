/**
 * Unit tests for lib/harness/safety/static.ts (Safety Agent Phase 1).
 *
 * Spec: docs/specs/safety-agent.md.
 *
 * Acceptance criterion: 9 destructive cases (3 per category) + 9 known-safe
 * controls = 18+ tests with 100% flag rate on destructives and 0% false-flag
 * on safe controls.
 */

import { describe, it, expect } from 'vitest'
import {
  checkDestructiveSql,
  checkSecretChanges,
  checkSideEffects,
  staticSafetyCheck,
  stripDollarQuotedBodies,
} from '@/lib/harness/safety/static'

describe('Safety Agent — destructive SQL (3 destructive + 3 safe)', () => {
  it('blocks DROP TABLE', () => {
    const out = checkDestructiveSql('DROP TABLE conversations;')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('block')
    expect(out[0].rule).toContain('DROP')
  })

  it('blocks TRUNCATE', () => {
    const out = checkDestructiveSql('TRUNCATE TABLE messages;')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('block')
    expect(out[0].rule).toContain('TRUNCATE')
  })

  it('blocks DELETE without WHERE', () => {
    const out = checkDestructiveSql('DELETE FROM agent_events;')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('block')
    expect(out[0].rule).toContain('DELETE without WHERE')
  })

  it('SAFE: SELECT does not flag', () => {
    expect(checkDestructiveSql('SELECT * FROM agent_events LIMIT 10')).toEqual([])
  })

  it('SAFE: DELETE WITH WHERE does not flag', () => {
    expect(checkDestructiveSql("DELETE FROM cache WHERE key = 'x'")).toEqual([])
  })

  it('SAFE: comment-only does not flag', () => {
    expect(checkDestructiveSql('-- DROP TABLE foo (in comment)\nSELECT 1')).toEqual([])
  })

  it('warns on ALTER of RLS-protected table', () => {
    const out = checkDestructiveSql('ALTER TABLE harness_config DROP COLUMN value;')
    expect(out.find((f) => f.rule.includes('ALTER on RLS-protected'))).toBeDefined()
  })

  // Regression: PRs #82 and #84 had to use SAFETY_BYPASS=1 because the
  // unchanged DROP INDEX inside a CREATE OR REPLACE FUNCTION body was being
  // mis-classified as a top-level DROP. Stripping dollar-quoted bodies first
  // fixes the false positive without weakening detection of real top-level DDL.
  it('SAFE: DROP INDEX inside a function body is not a top-level DROP', () => {
    const sql = `CREATE OR REPLACE FUNCTION public.rebuild_idx() RETURNS void
LANGUAGE plpgsql AS $function$
BEGIN
  DROP INDEX IF EXISTS public.knowledge_embedding_idx;
  CREATE INDEX knowledge_embedding_idx ON public.knowledge USING ivfflat (embedding extensions.vector_cosine_ops);
END;
$function$;`
    expect(checkDestructiveSql(sql)).toEqual([])
  })

  it('SAFE: TRUNCATE inside a function body is not a top-level TRUNCATE', () => {
    const sql = `CREATE OR REPLACE FUNCTION purger() RETURNS void
LANGUAGE plpgsql AS $function$ BEGIN TRUNCATE TABLE stale_rows; END; $function$;`
    expect(checkDestructiveSql(sql)).toEqual([])
  })

  it('SAFE: DELETE without WHERE inside a function body does not flag', () => {
    const sql = `CREATE FUNCTION purger() RETURNS void
LANGUAGE plpgsql AS $function$ BEGIN DELETE FROM stale_rows; END; $function$;`
    expect(checkDestructiveSql(sql)).toEqual([])
  })

  it('still blocks a real top-level DROP next to a (harmless) function body', () => {
    const sql = `DROP TABLE legacy_audit;
CREATE FUNCTION harmless() RETURNS void LANGUAGE plpgsql AS $function$ BEGIN RETURN; END; $function$;`
    const out = checkDestructiveSql(sql)
    expect(out.find((f) => f.rule === 'DROP statement')).toBeDefined()
  })
})

describe('stripDollarQuotedBodies', () => {
  it('strips a named-tag function body', () => {
    const sql = `CREATE FUNCTION foo() AS $function$ BEGIN DROP TABLE x; END; $function$;`
    expect(stripDollarQuotedBodies(sql)).not.toContain('DROP TABLE')
  })

  it('strips an anonymous-tag $$ body', () => {
    const sql = `DO $$ BEGIN TRUNCATE accounts; END $$;`
    expect(stripDollarQuotedBodies(sql)).not.toContain('TRUNCATE')
  })

  it('preserves top-level DDL outside any body', () => {
    const sql = `DROP TABLE legacy;
CREATE FUNCTION foo() AS $function$ BEGIN RETURN; END; $function$;`
    expect(stripDollarQuotedBodies(sql)).toContain('DROP TABLE legacy')
  })
})

describe('Safety Agent — secret changes in diff (3 destructive + 3 safe)', () => {
  it('warns on adding process.env.SOMETHING reference', () => {
    const diff = '+const key = process.env.STRIPE_SECRET_KEY'
    const out = checkSecretChanges(diff)
    expect(out).toHaveLength(1)
    expect(out[0].rule).toContain('adds process.env.STRIPE_SECRET_KEY')
  })

  it('warns on removing process.env.SOMETHING reference', () => {
    const diff = '-const key = process.env.GITHUB_TOKEN'
    const out = checkSecretChanges(diff)
    expect(out).toHaveLength(1)
    expect(out[0].rule).toContain('removes process.env.GITHUB_TOKEN')
  })

  it('blocks harness_config write from code', () => {
    const diff = `+await db.from('harness_config').insert({ key: 'NEW_TOKEN', value: 'x' })`
    const out = checkSecretChanges(diff)
    expect(
      out.find((f) => f.severity === 'block' && f.rule.includes('harness_config write'))
    ).toBeDefined()
  })

  it('SAFE: unrelated diff line', () => {
    expect(checkSecretChanges('+const total = a + b')).toEqual([])
  })

  it('SAFE: process.env.NODE_ENV is system, not secret-flagged distinctly', () => {
    // We do flag any process.env.X for review, but NODE_ENV is informational
    // — captured at WARN, not block. (Tracked by reviewer; not blocked.)
    const out = checkSecretChanges('+if (process.env.NODE_ENV === "production")')
    expect(out.every((f) => f.severity !== 'block')).toBe(true)
  })

  it('SAFE: harness_config read (select) does not flag', () => {
    const diff = `+const cfg = await db.from('harness_config').select('value')`
    expect(checkSecretChanges(diff)).toEqual([])
  })
})

describe('Safety Agent — side effects (3 destructive + 3 safe)', () => {
  it('warns on Telegram literal chat_id', () => {
    const out = checkSideEffects({ chatId: '1234567890', via: 'literal' }, 'telegram')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn')
    expect(out[0].rule).toContain('Telegram sendMessage')
  })

  it('blocks Stripe live-mode op', () => {
    const out = checkSideEffects({ liveMode: true }, 'stripe')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('block')
    expect(out[0].rule).toContain('Stripe live-mode')
  })

  it('blocks force-push to main', () => {
    const out = checkSideEffects({ forcePushToMain: true }, 'git')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('block')
    expect(out[0].rule).toContain('force-push')
  })

  it('SAFE: Telegram with config-resolved chat_id', () => {
    const out = checkSideEffects({ chatId: '1234567890', via: 'config' }, 'telegram')
    expect(out).toEqual([])
  })

  it('SAFE: Stripe in test mode', () => {
    expect(checkSideEffects({ liveMode: false }, 'stripe')).toEqual([])
  })

  it('SAFE: regular git push (not force)', () => {
    expect(checkSideEffects({ forcePushToMain: false }, 'git')).toEqual([])
  })

  it('warns on Storage bucket change', () => {
    const out = checkSideEffects({ bucketChange: true }, 'storage')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn')
  })
})

describe('Safety Agent — staticSafetyCheck orchestrator', () => {
  it('returns pass for empty input', () => {
    const r = staticSafetyCheck({})
    expect(r.severity).toBe('pass')
    expect(r.findings).toEqual([])
  })

  it('returns block when any finding is block', () => {
    const r = staticSafetyCheck({
      sql: 'DROP TABLE x',
      telegram: { chatId: '1', via: 'literal' },
    })
    expect(r.severity).toBe('block')
    expect(r.findings.length).toBeGreaterThanOrEqual(2)
  })

  it('returns warn when all findings are warn', () => {
    const r = staticSafetyCheck({
      sql: 'ALTER TABLE harness_config ADD COLUMN x int',
      telegram: { chatId: '1', via: 'literal' },
    })
    expect(r.severity).toBe('warn')
  })

  it('combines findings across categories', () => {
    const r = staticSafetyCheck({
      sql: 'DROP TABLE foo',
      diff: '+process.env.NEW_KEY',
      stripe: { liveMode: true },
    })
    expect(r.severity).toBe('block')
    expect(r.findings.some((f) => f.category === 'destructive_sql')).toBe(true)
    expect(r.findings.some((f) => f.category === 'secret')).toBe(true)
    expect(r.findings.some((f) => f.category === 'side_effect')).toBe(true)
  })
})
