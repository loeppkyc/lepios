#!/usr/bin/env node
/**
 * Layer 0 — Safety Agent static check on staged diff.
 *
 * Inline regex-based static check (mirrors lib/harness/safety/static.ts
 * destructive_sql patterns; pure JS so the hook needs no compile step).
 * Blocks the commit on `block` severity. `pass` and `warn` allow.
 *
 * Bypass: SAFETY_BYPASS=1 git commit ...   (use sparingly, log a reason)
 *
 * Spec: docs/specs/safety-agent.md.
 */

import { execSync } from 'node:child_process'

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

// Extract the additions only (lines starting with +, excluding diff headers).
const additions = stagedDiff
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .map((l) => l.slice(1))
  .join('\n')

const additionsUpper = additions.toUpperCase()
const findings = []

// destructive_sql: DROP / TRUNCATE / DELETE-no-WHERE
if (/\bDROP\s+(TABLE|SCHEMA|DATABASE|VIEW|FUNCTION|INDEX)\b/.test(additionsUpper)) {
  findings.push({ severity: 'block', rule: 'DROP statement', evidence: 'DROP …' })
}
if (/\bTRUNCATE\b/.test(additionsUpper)) {
  findings.push({ severity: 'block', rule: 'TRUNCATE statement', evidence: 'TRUNCATE …' })
}
// DELETE without WHERE (per stmt; semicolons split additions)
for (const stmt of additions.split(';')) {
  if (/\bDELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) {
    findings.push({ severity: 'block', rule: 'DELETE without WHERE', evidence: 'DELETE FROM …' })
    break
  }
}

// secret-write: harness_config write from code (block — should be DB only)
if (/['"]harness_config['"][\s\S]{0,80}?\.(insert|update|upsert|delete)\b/.test(additions)) {
  findings.push({
    severity: 'block',
    rule: 'harness_config write in code',
    evidence: 'db.from("harness_config").insert(…) / .update(…)',
  })
}

// side_effect: git force-push to main pattern in scripts (block)
if (/git\s+push\s+(--force|-f)\b[\s\S]*?\bmain\b/.test(additions)) {
  findings.push({ severity: 'block', rule: 'git force-push to main', evidence: 'git push --force … main' })
}

const severity = findings.some((f) => f.severity === 'block')
  ? 'block'
  : findings.length > 0
    ? 'warn'
    : 'pass'

if (severity === 'block') {
  console.error('')
  console.error('[safety] ✗ BLOCKED — Safety Agent static check failed.')
  for (const f of findings.filter((x) => x.severity === 'block')) {
    console.error(`[safety]   • ${f.rule}: ${f.evidence}`)
  }
  console.error('')
  console.error('[safety]   To proceed:')
  console.error('[safety]     1. Remove the destructive op from staged changes, OR')
  console.error('[safety]     2. Bypass once: SAFETY_BYPASS=1 git commit ...   (please log a reason)')
  console.error('')
  process.exit(1)
}

if (severity === 'warn') {
  console.log(`[safety] ⚠ WARN (${findings.length} finding${findings.length === 1 ? '' : 's'}) — allowed; review your diff.`)
}

process.exit(0)
