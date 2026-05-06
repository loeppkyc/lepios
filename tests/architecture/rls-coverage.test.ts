/**
 * Architecture invariant (F-N6 — RLS coverage):
 *   Every CREATE TABLE in supabase/migrations/ that targets the `public`
 *   schema must have a corresponding ENABLE ROW LEVEL SECURITY in the same
 *   or a later migration.
 *
 *   Without RLS, a table in the public schema is reachable via the Supabase
 *   anon key (which is published in the Next.js client bundle). This test
 *   prevents regressions of the 2026-05-06 incident where 8 bookkeeping +
 *   harness tables shipped without RLS enabled — fixed in migrations 0126
 *   + 0127.
 *
 *   Scans migration files only (static check). The live-DB advisor poll
 *   (Supabase get_advisors) is the runtime defense; this is the build-time
 *   guard so a new table can't merge without RLS.
 *
 * If a table legitimately must NOT have RLS (e.g., genuinely public data,
 * supabase-managed system table), add it to ALLOWED_NO_RLS with a reason.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

// Tables that are intentionally exempt from RLS. Add with a reason.
const ALLOWED_NO_RLS = new Set<string>([
  // (empty — every public table must have RLS as of 2026-05-06)
])

// Match: CREATE TABLE [IF NOT EXISTS] public.<name> or CREATE TABLE [IF NOT EXISTS] <name>
// (default schema is public when unqualified). Captures the table name.
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi

// Match: ALTER TABLE [public.]<name> ENABLE ROW LEVEL SECURITY
const ENABLE_RLS_RE =
  /ALTER\s+TABLE\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi

// Strip SQL line comments (-- ...) so commented-out CREATE/ENABLE statements
// don't trigger false positives or false negatives.
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // alphabetical = chronological for 0001_, 0002_, ...
    .map((f) => join(MIGRATIONS_DIR, f))
}

describe('architecture: RLS coverage (F-N6)', () => {
  it('every public-schema CREATE TABLE has a corresponding ENABLE ROW LEVEL SECURITY', () => {
    const created = new Set<string>()
    const rlsEnabled = new Set<string>()

    for (const file of listMigrationFiles()) {
      const sql = stripComments(readFileSync(file, 'utf8'))

      // Skip a table only if its CREATE is in a different schema than public.
      // Our regex above already filters to public.<name> or unqualified (defaults
      // to public). For `CREATE TABLE auth.users` etc., the schema prefix is
      // captured separately so we'd need a stricter regex — but the codebase
      // doesn't create non-public tables in migrations, so the simple form is
      // sufficient here.
      let m: RegExpExecArray | null
      while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
        const name = m[1]
        // Skip if SQL had a non-public schema prefix we didn't catch.
        // Look back ~20 chars for "schemaname." — if present and not "public.", skip.
        const before = sql.slice(Math.max(0, m.index - 30), m.index)
        if (/(?:auth|storage|realtime|extensions|graphql|graphql_public)\.\s*$/i.test(before)) {
          continue
        }
        created.add(name)
      }
      CREATE_TABLE_RE.lastIndex = 0

      while ((m = ENABLE_RLS_RE.exec(sql)) !== null) {
        rlsEnabled.add(m[1])
      }
      ENABLE_RLS_RE.lastIndex = 0
    }

    const missing = [...created]
      .filter((t) => !rlsEnabled.has(t))
      .filter((t) => !ALLOWED_NO_RLS.has(t))
      .sort()

    expect(
      missing,
      `Tables created in public schema without ENABLE ROW LEVEL SECURITY:\n` +
        missing.map((t) => `  - ${t}`).join('\n') +
        `\n\nFix: add 'ALTER TABLE public.${missing[0] ?? '<name>'} ENABLE ROW LEVEL SECURITY;' ` +
        `to a migration. If the table is intentionally public, add it to ALLOWED_NO_RLS in ` +
        `tests/architecture/rls-coverage.test.ts with a reason.`
    ).toEqual([])
  })
})
