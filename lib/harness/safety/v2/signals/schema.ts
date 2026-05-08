/**
 * lib/harness/safety/v2/signals/schema.ts
 *
 * Schema-impact signal. Classifies each migration in the PR as:
 *   - destructive: DROP TABLE/INDEX/COLUMN, TRUNCATE, DELETE-no-WHERE,
 *     DROP NOT NULL, RENAME COLUMN/TABLE → MIGRATION_DESTRUCTIVE (+60)
 *   - additive only: only CREATE / ALTER ADD / INSERT → MIGRATION_ADDITIVE (+10)
 *   - mixed: both → highest severity wins (destructive)
 *
 * Plus an RLS-coverage check: if a migration creates a new table without
 * ENABLE ROW LEVEL SECURITY + at least one CREATE POLICY → emit a destructive
 * tier finding (RLS gap is a security regression class).
 *
 * Reuses the dollar-quoted-body stripper from lib/harness/safety/static.ts so
 * function bodies don't false-positive (PR #82/#84 lesson).
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #2)
 */

import { stripDollarQuotedBodies } from '../../static'
import type { SignalFinding, PRDiffInput } from '../types'

// F18: lib/harness/safety/v2/signals/schema

/**
 * Operations that always block — destructive against existing data.
 * Match against the cleaned (no-comments, no-function-bodies) SQL.
 */
const DESTRUCTIVE_PATTERNS: Array<{ re: RegExp; id: string; label: string }> = [
  { re: /\bDROP\s+TABLE\b/i, id: 'drop_table', label: 'DROP TABLE' },
  { re: /\bDROP\s+SCHEMA\b/i, id: 'drop_schema', label: 'DROP SCHEMA' },
  { re: /\bDROP\s+INDEX\b/i, id: 'drop_index', label: 'DROP INDEX' },
  { re: /\bDROP\s+VIEW\b/i, id: 'drop_view', label: 'DROP VIEW' },
  { re: /\bDROP\s+FUNCTION\b/i, id: 'drop_function', label: 'DROP FUNCTION' },
  { re: /\bTRUNCATE\b/i, id: 'truncate', label: 'TRUNCATE' },
  { re: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i, id: 'drop_column', label: 'DROP COLUMN' },
  {
    re: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+NOT\s+NULL\b/i,
    id: 'drop_not_null',
    label: 'DROP NOT NULL',
  },
  {
    re: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+(?:COLUMN|TO)\b/i,
    id: 'rename',
    label: 'ALTER ... RENAME',
  },
]

function cleanSql(sql: string): string {
  return stripDollarQuotedBodies(sql)
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

function findDestructiveOps(sql: string): Array<{ id: string; label: string; match: string }> {
  const stripped = cleanSql(sql)

  // DELETE without WHERE — split on semicolons so each statement is checked alone.
  const ops: Array<{ id: string; label: string; match: string }> = []
  for (const stmt of stripped.split(';')) {
    if (/\bDELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) {
      const m = stmt.match(/\bDELETE\s+FROM\s+\S+/i)
      ops.push({
        id: 'delete_no_where',
        label: 'DELETE without WHERE',
        match: (m?.[0] ?? 'DELETE FROM …').trim(),
      })
    }
  }

  for (const { re, id, label } of DESTRUCTIVE_PATTERNS) {
    const m = stripped.match(re)
    if (m) ops.push({ id, label, match: m[0].trim() })
  }
  return ops
}

/**
 * RLS coverage check. For each `CREATE TABLE public.X` / `CREATE TABLE X` in
 * the migration, require both:
 *   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` referencing the same table
 *   - at least one `CREATE POLICY ... ON ... <table>` referencing it
 *
 * Tables whose name starts with an underscore or contains `_internal` are
 * treated as private internals and exempted (rare, but matches existing
 * convention in the codebase).
 */
function findMissingRlsTables(sql: string): string[] {
  const stripped = cleanSql(sql)
  const created: string[] = []
  const createRe = /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?(\w+)/gi
  let m: RegExpExecArray | null
  while ((m = createRe.exec(stripped)) !== null) {
    const name = m[1].toLowerCase()
    if (name.startsWith('_') || name.includes('_internal')) continue
    created.push(name)
  }
  if (created.length === 0) return []

  const enabled = new Set<string>()
  const enableRe = /\bALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
  while ((m = enableRe.exec(stripped)) !== null) enabled.add(m[1].toLowerCase())

  const policied = new Set<string>()
  // Match: CREATE POLICY "..."" ON public.X ... or CREATE POLICY ... ON X ...
  const policyRe = /\bCREATE\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+(?:public\.)?(\w+)/gi
  while ((m = policyRe.exec(stripped)) !== null) policied.add(m[1].toLowerCase())

  return created.filter((t) => !enabled.has(t) || !policied.has(t))
}

/** Empty-after-cleaning SQL still counts as "additive only" (no-op = additive). */
function hasNonComment(sql: string): boolean {
  return cleanSql(sql).trim().length > 0
}

/**
 * Detect schema-impact signals across all migrations in the PR. One finding
 * per (file, op_id) pair so a migration with two DROPs emits two distinct
 * findings; one finding per file for the additive-only case.
 *
 * Returns no findings if input.migration_files is empty (PR has no migrations).
 */
export function detectSchemaImpact(input: PRDiffInput): SignalFinding[] {
  const findings: SignalFinding[] = []

  for (const { path, sql } of input.migration_files) {
    const ops = findDestructiveOps(sql)
    const missingRls = findMissingRlsTables(sql)

    // RLS gap → destructive tier (security regression class).
    for (const tbl of missingRls) {
      findings.push({
        id: `missing_rls_${tbl}`,
        name: `new table without RLS coverage: ${tbl}`,
        weight_key: 'SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE',
        evidence: `${path}: CREATE TABLE ${tbl} without ENABLE ROW LEVEL SECURITY + CREATE POLICY`,
      })
    }

    if (ops.length > 0) {
      // Each destructive op contributes its own finding for evidence clarity.
      // Scorer (Sub-phase B) caps the per-PR contribution to one weight.
      for (const op of ops) {
        findings.push({
          id: op.id,
          name: `destructive migration op: ${op.label}`,
          weight_key: 'SAFETY_WEIGHT_MIGRATION_DESTRUCTIVE',
          evidence: `${path}: ${op.match}`,
        })
      }
    } else if (hasNonComment(sql)) {
      // Additive-only when SQL has content but no destructive op.
      findings.push({
        id: 'migration_additive',
        name: 'additive migration',
        weight_key: 'SAFETY_WEIGHT_MIGRATION_ADDITIVE',
        evidence: path,
      })
    }
  }

  return findings
}
