/**
 * Architecture invariant (F-N7 — search_path coverage):
 *   Every CREATE [OR REPLACE] FUNCTION in supabase/migrations/ that targets
 *   the `public` schema must have a `SET search_path` clause attached. Tracks
 *   the LATEST definition per function name (last-write-wins, mirroring PG
 *   runtime behavior — a later CREATE OR REPLACE overrides earlier ones).
 *
 *   Without a fixed search_path, a malicious user could create a same-named
 *   object in another schema that ends up resolving inside the function body,
 *   silently changing what the function reads or writes. This test prevents
 *   regression of the 2026-05-06 audit (migrations 0128/0129/0130), which
 *   closed all 13 findings from Supabase advisor's
 *   `function_search_path_mutable` WARN class.
 *
 *   Scans migration files only (static check). The live-DB advisor poll
 *   (Supabase get_advisors) is the runtime defense; this is the build-time
 *   guard so a new function can't merge without the lockdown.
 *
 * Sibling of F-N6 (tests/architecture/rls-coverage.test.ts) — same pattern,
 * different invariant.
 *
 * If a function legitimately must NOT have a pinned search_path, add it to
 * ALLOWED_NO_SEARCH_PATH with a reason.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

// Functions intentionally exempt from the SET search_path requirement.
// Add with a reason.
const ALLOWED_NO_SEARCH_PATH = new Set<string>([
  // (empty — all 13 public-schema functions were hardened on 2026-05-06)
])

// Match: CREATE [OR REPLACE] FUNCTION [public.]<name>(<header...>) AS $tag$
// - Captures function name in group 1
// - Captures everything between the opening `(` and the body marker `AS $tag$`
//   in group 2. SET search_path lives in this header range, ahead of the body.
//
// Dollar-quote tag varies in this codebase ($function$, $$, $body$); the
// `\$[a-z_]*\$` form catches all of them.
const CREATE_FUNCTION_BLOCK_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)AS\s+\$[a-z_]*\$/gi

const SET_SEARCH_PATH_RE = /SET\s+search_path\s*=/i

// Strip SQL line comments so commented-out CREATE statements don't trigger
// false positives. (Block comments /* ... */ aren't used in this codebase's
// migrations.)
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

describe('architecture: search_path coverage (F-N7)', () => {
  it('every CREATE FUNCTION in public schema sets search_path (last-write-wins)', () => {
    // name -> hasSearchPath (last write wins, mirrors how PG resolves the
    // function at runtime — only the most recent definition matters)
    const definitions = new Map<string, boolean>()

    for (const file of listMigrationFiles()) {
      const sql = stripComments(readFileSync(file, 'utf8'))

      let m: RegExpExecArray | null
      while ((m = CREATE_FUNCTION_BLOCK_RE.exec(sql)) !== null) {
        const name = m[1]
        const header = m[2]

        // Skip non-public schemas. Look back ~30 chars for `auth.`, `storage.`,
        // etc. immediately before the matched name.
        const before = sql.slice(Math.max(0, m.index - 30), m.index)
        if (/(?:auth|storage|realtime|extensions|graphql|graphql_public)\.\s*$/i.test(before)) {
          continue
        }

        const hasSearchPath = SET_SEARCH_PATH_RE.test(header)
        definitions.set(name, hasSearchPath)
      }
      CREATE_FUNCTION_BLOCK_RE.lastIndex = 0
    }

    const missing = [...definitions.entries()]
      .filter(([name, hasSearchPath]) => !hasSearchPath && !ALLOWED_NO_SEARCH_PATH.has(name))
      .map(([name]) => name)
      .sort()

    expect(
      missing,
      `Functions in public schema without SET search_path:\n` +
        missing.map((n) => `  - ${n}`).join('\n') +
        `\n\nFix: add 'SET search_path = ''' to the function definition. ` +
        `Body refs to user-schema objects must then be qualified ` +
        `(public.knowledge, OPERATOR(extensions.<=>), extensions.vector_cosine_ops, ` +
        `etc.). See migrations 0128/0129/0130/0131 for examples. ` +
        `If a function is intentionally exempt, add it to ALLOWED_NO_SEARCH_PATH ` +
        `in tests/architecture/search-path-coverage.test.ts with a reason.`
    ).toEqual([])
  })
})
