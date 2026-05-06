#!/usr/bin/env node
/**
 * Layer 0 — Safety Agent static check on staged diff.
 *
 * Inline regex-based static check (mirrors lib/harness/safety/static.ts
 * destructive_sql patterns; pure JS so the hook needs no compile step).
 * Blocks the commit on `block` severity. `pass` and `warn` allow.
 *
 * Three categories with different scope rules:
 *   - destructive_sql: only scans files where SQL statements are plausible
 *     (.sql, supabase/migrations/**, .py, and lib/orb/tools/* which embeds
 *     raw SQL strings). Prevents Tailwind class names like `truncate` from
 *     tripping the TRUNCATE rule.
 *   - secret-write (harness_config from code): scans .ts/.tsx/.mjs/.js files.
 *   - side_effect (force-push to main): scans shell + script files.
 *
 * Patterns also require syntactic SQL context (TRUNCATE TABLE? <name>,
 * DELETE FROM <name>, DROP <kind> <name>) as a secondary defense for any
 * non-SQL file that legitimately holds SQL strings.
 *
 * Bypass: SAFETY_BYPASS=1 git commit ...   (use sparingly, log a reason)
 *
 * Spec: docs/specs/safety-agent.md.
 * Background: docs/follow-ups/2026-05-05-safety-hook-truncate-false-positive.md
 */

import { execSync } from 'node:child_process'

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * The safety system's own source and tests contain the very patterns the
 * scanner looks for (regex literals, expected-rule strings, fixture inputs).
 * Scanning them would always match. Allowlist them — Layer 1 (lint) and
 * Layer 2 (AI review) still apply.
 */
const SELF_REFERENCING_PATHS = new Set([
  'scripts/pre-commit-safety.mjs',
  'tests/harness/safety/pre-commit-safety.test.ts',
  'lib/harness/safety/static.ts',
  'tests/harness/safety/static.test.ts',
])

export function isAllowlistedPath(path) {
  return SELF_REFERENCING_PATHS.has(path)
}

/**
 * Decide if a path's contents are eligible for SQL pattern scans.
 * Path is the project-relative path as git reports it (forward slashes).
 */
export function isSqlContextPath(path) {
  if (path.endsWith('.sql')) return true
  if (path.startsWith('supabase/migrations/')) return true
  if (path.endsWith('.py')) return true
  if (path.startsWith('lib/orb/tools/') && /\.(ts|mts|js|mjs)$/.test(path)) return true
  if (path.startsWith('scripts/') && /\.(ts|mts|js|mjs|py)$/.test(path)) return true
  return false
}

/**
 * Decide if a path's contents are eligible for code-secret scans
 * (harness_config write detection).
 */
export function isCodePath(path) {
  return /\.(ts|tsx|mts|js|mjs)$/.test(path)
}

/**
 * Decide if a path's contents are eligible for shell/script-flavored scans
 * (git force-push detection).
 */
export function isScriptPath(path) {
  return (
    /\.(sh|bash|zsh|mjs|js|ts|mts|ps1)$/.test(path) ||
    path.startsWith('.husky/') ||
    path.startsWith('scripts/')
  )
}

/**
 * Strip Postgres dollar-quoted string bodies from SQL text.
 *
 * Function bodies (CREATE [OR REPLACE] FUNCTION ... AS $tag$ ... $tag$;) are
 * stored as TEXT in pg_proc.prosrc and re-parsed at call time — they are NOT
 * top-level DDL. A `DROP INDEX IF EXISTS` *inside* a function body is a string
 * literal, not a destructive operation at migration apply time.
 *
 * Without this strip, the destructive_sql patterns produce false positives on
 * any migration that defines a function whose body includes DROP/TRUNCATE/etc.
 * (See migrations 0129, 0131, and PRs #82 / #84 which had to use SAFETY_BYPASS
 * for exactly this reason.)
 *
 * Anonymous tags ($$ ... $$) and named tags ($function$ ... $function$,
 * $body$ ... $body$, etc.) are both handled. Backreference `\1` correctly
 * matches an empty group when the tag is anonymous.
 */
export function stripDollarQuotedBodies(sql) {
  return sql.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '')
}

/**
 * Parse a unified diff (output of `git diff --cached --no-color`) into
 * { path, additions } records. additions is the joined `+` lines (without
 * the leading +) for that file.
 */
export function parseStagedDiff(diff) {
  const result = []
  const fileChunks = diff.split(/^diff --git /m).slice(1)
  for (const chunk of fileChunks) {
    // First line of each chunk: `a/path b/path`
    const firstNewline = chunk.indexOf('\n')
    if (firstNewline === -1) continue
    const header = chunk.slice(0, firstNewline)
    const match = /^a\/(.+?) b\/(.+)$/.exec(header)
    if (!match) continue
    const path = match[2]
    const body = chunk.slice(firstNewline + 1)
    const additions = body
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n')
    result.push({ path, additions })
  }
  return result
}

/**
 * Run the static safety scan against a parsed diff. Returns { severity, findings }.
 * Findings have shape { severity, rule, evidence, path? }.
 */
export function scanStagedFiles(files) {
  const findings = []

  // Union additions per scan domain so cross-file context (e.g. multi-line
  // TRUNCATE block split into two files — improbable but possible) doesn't
  // get missed.
  const sqlContext = []
  const codeContext = []
  const scriptContext = []

  for (const { path, additions } of files) {
    if (isAllowlistedPath(path)) continue
    if (isSqlContextPath(path)) sqlContext.push({ path, additions })
    if (isCodePath(path)) codeContext.push({ path, additions })
    if (isScriptPath(path)) scriptContext.push({ path, additions })
  }

  // ── destructive_sql ────────────────────────────────────────────────────────
  for (const { path, additions } of sqlContext) {
    // Strip dollar-quoted function bodies before pattern matching — DROP/etc.
    // inside a CREATE FUNCTION body is a string literal, not top-level DDL.
    const stripped = stripDollarQuotedBodies(additions)
    const upper = stripped.toUpperCase()

    if (/\bDROP\s+(TABLE|SCHEMA|DATABASE|VIEW|FUNCTION|INDEX)\s+\w+/.test(upper)) {
      findings.push({
        severity: 'block',
        rule: 'DROP statement',
        evidence: extractMatch(stripped, /\bDROP\s+\w+\s+\w+/i) ?? 'DROP …',
        path,
      })
    }

    // TRUNCATE requires a table-name token after it (optionally `TABLE`),
    // which excludes the bare-keyword Tailwind `truncate` class.
    if (/\bTRUNCATE\s+(?:TABLE\s+)?\w+/.test(upper)) {
      findings.push({
        severity: 'block',
        rule: 'TRUNCATE statement',
        evidence: extractMatch(stripped, /\bTRUNCATE\s+(?:TABLE\s+)?\w+/i) ?? 'TRUNCATE …',
        path,
      })
    }

    // DELETE FROM <table> without a WHERE in the same statement.
    for (const stmt of stripped.split(';')) {
      if (/\bDELETE\s+FROM\s+\w+/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) {
        findings.push({
          severity: 'block',
          rule: 'DELETE without WHERE',
          evidence: extractMatch(stmt, /\bDELETE\s+FROM\s+\w+/i) ?? 'DELETE FROM …',
          path,
        })
        break
      }
    }
  }

  // ── secret: harness_config write from code ────────────────────────────────
  for (const { path, additions } of codeContext) {
    if (/['"]harness_config['"][\s\S]{0,80}?\.(insert|update|upsert|delete)\b/.test(additions)) {
      findings.push({
        severity: 'block',
        rule: 'harness_config write in code',
        evidence: 'db.from("harness_config").insert(…) / .update(…)',
        path,
      })
    }
  }

  // ── side_effect: git force-push to main ────────────────────────────────────
  for (const { path, additions } of scriptContext) {
    if (/git\s+push\s+(--force|-f)\b[\s\S]*?\bmain\b/.test(additions)) {
      findings.push({
        severity: 'block',
        rule: 'git force-push to main',
        evidence: 'git push --force … main',
        path,
      })
    }
  }

  const severity = findings.some((f) => f.severity === 'block')
    ? 'block'
    : findings.length > 0
      ? 'warn'
      : 'pass'

  return { severity, findings }
}

function extractMatch(text, re) {
  const m = re.exec(text)
  return m ? m[0] : null
}

// ── CLI entry point ──────────────────────────────────────────────────────────

function isMain() {
  // ESM main-module detection. argv[1] may be undefined under `node -e`.
  const script = process.argv[1]
  if (!script) return false
  return script.endsWith('pre-commit-safety.mjs')
}

if (isMain()) {
  if (process.env.SAFETY_BYPASS === '1') {
    console.log('[safety] ✗ SKIPPED — SAFETY_BYPASS=1')
    process.exit(0)
  }

  let stagedDiff = ''
  try {
    stagedDiff = execSync('git diff --cached --no-color', { encoding: 'utf8' })
  } catch (err) {
    // Be lenient on read failure — don't block normal commits.
    console.error('[safety] could not read staged diff:', err instanceof Error ? err.message : err)
    process.exit(0)
  }

  if (!stagedDiff.trim()) {
    process.exit(0)
  }

  const files = parseStagedDiff(stagedDiff)
  const { severity, findings } = scanStagedFiles(files)

  if (severity === 'block') {
    console.error('')
    console.error('[safety] ✗ BLOCKED — Safety Agent static check failed.')
    for (const f of findings.filter((x) => x.severity === 'block')) {
      const where = f.path ? ` (${f.path})` : ''
      console.error(`[safety]   • ${f.rule}${where}: ${f.evidence}`)
    }
    console.error('')
    console.error('[safety]   To proceed:')
    console.error('[safety]     1. Remove the destructive op from staged changes, OR')
    console.error(
      '[safety]     2. Bypass once: SAFETY_BYPASS=1 git commit ...   (please log a reason)'
    )
    console.error('')
    process.exit(1)
  }

  if (severity === 'warn') {
    console.log(
      `[safety] ⚠ WARN (${findings.length} finding${findings.length === 1 ? '' : 's'}) — allowed; review your diff.`
    )
  }

  process.exit(0)
}
