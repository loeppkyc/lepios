/**
 * Unit tests for lib/harness/safety/v2/signals/schema.ts.
 *
 * Calibration: any destructive op → MIGRATION_DESTRUCTIVE (+60).
 * Additive-only migration → MIGRATION_ADDITIVE (+10).
 * New table without RLS → MIGRATION_DESTRUCTIVE (security regression class).
 */

import { describe, it, expect } from 'vitest'
import { detectSchemaImpact } from '@/lib/harness/safety/v2/signals/schema'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'

function makeInput(migrations: { path: string; sql: string }[]): PRDiffInput {
  return {
    unified_diff: '',
    files_changed: migrations.map((m) => m.path),
    loc_added: 1,
    loc_removed: 0,
    migration_files: migrations,
  }
}

describe('detectSchemaImpact — destructive ops (each fires MIGRATION_DESTRUCTIVE)', () => {
  it('flags DROP TABLE', () => {
    const out = detectSchemaImpact(
      makeInput([{ path: 'supabase/migrations/0163_x.sql', sql: 'DROP TABLE foo;' }])
    )
    expect(out[0].id).toBe('drop_table')
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE')
  })

  it('flags DROP COLUMN', () => {
    const out = detectSchemaImpact(
      makeInput([
        {
          path: 'supabase/migrations/0163_x.sql',
          sql: 'ALTER TABLE foo DROP COLUMN bar;',
        },
      ])
    )
    expect(out.find((f) => f.id === 'drop_column')?.weight_key).toBe(
      'SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE'
    )
  })

  it('flags DROP NOT NULL', () => {
    const out = detectSchemaImpact(
      makeInput([
        {
          path: 'supabase/migrations/0163_x.sql',
          sql: 'ALTER TABLE foo ALTER COLUMN bar DROP NOT NULL;',
        },
      ])
    )
    expect(out.find((f) => f.id === 'drop_not_null')).toBeDefined()
  })

  it('flags TRUNCATE', () => {
    const out = detectSchemaImpact(
      makeInput([{ path: 'supabase/migrations/0163_x.sql', sql: 'TRUNCATE TABLE foo;' }])
    )
    expect(out.find((f) => f.id === 'truncate')).toBeDefined()
  })

  it('flags DELETE without WHERE', () => {
    const out = detectSchemaImpact(
      makeInput([{ path: 'supabase/migrations/0163_x.sql', sql: 'DELETE FROM foo;' }])
    )
    expect(out.find((f) => f.id === 'delete_no_where')).toBeDefined()
  })

  it('flags RENAME', () => {
    const out = detectSchemaImpact(
      makeInput([
        {
          path: 'supabase/migrations/0163_x.sql',
          sql: 'ALTER TABLE foo RENAME COLUMN bar TO baz;',
        },
      ])
    )
    expect(out.find((f) => f.id === 'rename')).toBeDefined()
  })
})

describe('detectSchemaImpact — additive only', () => {
  it('classifies CREATE TABLE + ADD COLUMN as additive', () => {
    const sql = `
      CREATE TABLE public.foo (id uuid primary key);
      ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "p" ON public.foo FOR ALL TO authenticated USING (true);
      ALTER TABLE public.bar ADD COLUMN c int;
    `
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('migration_additive')
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_MIGRATION_ADDITIVE')
  })

  it('comment-only migration does not flag', () => {
    const sql = '-- nothing here'
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out).toHaveLength(0)
  })

  it('empty SQL does not flag', () => {
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql: '' }]))
    expect(out).toHaveLength(0)
  })
})

describe('detectSchemaImpact — RLS coverage check', () => {
  it('flags new table without ENABLE ROW LEVEL SECURITY', () => {
    const sql = 'CREATE TABLE public.foo (id uuid primary key);'
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    const rls = out.find((f) => f.id.startsWith('missing_rls_'))
    expect(rls).toBeDefined()
    expect(rls!.weight_key).toBe('SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE')
  })

  it('flags new table with RLS but no CREATE POLICY', () => {
    const sql = `
      CREATE TABLE public.foo (id uuid primary key);
      ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
    `
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out.find((f) => f.id === 'missing_rls_foo')).toBeDefined()
  })

  it('does not flag table with both ENABLE RLS and policy', () => {
    const sql = `
      CREATE TABLE public.foo (id uuid primary key);
      ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "p" ON public.foo FOR ALL TO authenticated USING (true);
    `
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out.find((f) => f.id.startsWith('missing_rls_'))).toBeUndefined()
  })

  it('exempts internal tables (underscore prefix)', () => {
    const sql = 'CREATE TABLE _scratch (id uuid);'
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out.find((f) => f.id.startsWith('missing_rls_'))).toBeUndefined()
  })
})

describe('detectSchemaImpact — false-positive guards', () => {
  it('strips dollar-quoted function bodies — DROP inside body does not flag', () => {
    const sql = `
      CREATE OR REPLACE FUNCTION cleanup() RETURNS void AS $$
      BEGIN
        DROP INDEX IF EXISTS old_idx;
      END;
      $$ LANGUAGE plpgsql;
    `
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out.find((f) => f.id === 'drop_index')).toBeUndefined()
  })

  it('comments do not trigger destructive match', () => {
    const sql = `
      -- DROP TABLE foo;
      CREATE TABLE public.foo (id uuid primary key);
      ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "p" ON public.foo FOR ALL TO authenticated USING (true);
    `
    const out = detectSchemaImpact(makeInput([{ path: 'supabase/migrations/0163_x.sql', sql }]))
    expect(out.find((f) => f.id === 'drop_table')).toBeUndefined()
  })

  it('empty migration_files array → no findings', () => {
    expect(detectSchemaImpact(makeInput([]))).toHaveLength(0)
  })
})
