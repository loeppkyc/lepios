#!/usr/bin/env node
/**
 * Resource budget pre-commit gate.
 *
 * Companion to migration 0159 (`harness_resource_budgets`). For every
 * file-resident budget, evaluates the current count from the staged or
 * working-tree file and aborts the commit if it exceeds `max`.
 *
 * Externally-synced budgets (Vercel API, Supabase pg_policies) are NOT
 * checked here — they're reconciled by the future
 * `scripts/sync-resource-budgets.mjs` runtime job. This gate's job is
 * stopping the bleeding before code lands; the sync job's job is keeping
 * the table fresh so morning_digest has accurate numbers.
 *
 * Why this exists: F-L11 / F-N9 (Vercel cron limit) and F-L7 (quota cliff)
 * are the same failure class — silent resource contention discovered after
 * the fact. The cron-count guard (`scripts/check-vercel-cron-count.mjs`)
 * was the first instance; this script generalizes the pattern.
 *
 * Run via husky pre-commit. Bypass: `BUDGETS_CHECK_BYPASS=1 git commit ...`
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Static budget registry. Mirrors the v1 seed rows in migration 0159 for
 * file-resident budgets (the ones this script actually evaluates). External
 * budgets (vercel.env_vars) live in the DB only; they're listed here for
 * documentation and skipped at gate time.
 *
 * To add a new file-resident budget: append an entry with `evaluator` set
 * to one of the named functions below, then add the matching row in a new
 * migration so the DB and gate stay in sync.
 */
export const BUDGETS = [
  {
    key: 'vercel.crons',
    max: 18,
    file: 'vercel.json',
    evaluator: 'countVercelCrons',
    note: 'Hobby plan ceiling. Sub-hourly cadence enforced separately by check-vercel-cron-count.mjs.',
  },
  {
    key: 'package.deps_total',
    max: 300,
    file: 'package.json',
    evaluator: 'countPackageDeps',
    note: 'Combined dependencies + devDependencies count.',
  },
]

// ─── Evaluators ──────────────────────────────────────────────────────────────

export function countVercelCrons(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0
  const crons = parsed.crons
  return Array.isArray(crons) ? crons.length : 0
}

export function countPackageDeps(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0
  const deps =
    parsed.dependencies && typeof parsed.dependencies === 'object'
      ? Object.keys(parsed.dependencies).length
      : 0
  const devDeps =
    parsed.devDependencies && typeof parsed.devDependencies === 'object'
      ? Object.keys(parsed.devDependencies).length
      : 0
  return deps + devDeps
}

const EVALUATORS = {
  countVercelCrons,
  countPackageDeps,
}

// ─── File loading ────────────────────────────────────────────────────────────

function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Read the staged version of a file (what's about to be committed). Falls
 * back to the working-tree version. Returns the parsed JSON or null if
 * unreadable.
 */
function loadStagedJson(path) {
  try {
    const staged = execSync(`git show :${path}`, { encoding: 'utf8' })
    return JSON.parse(staged)
  } catch {
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  }
}

// ─── Core evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate every file-resident budget against its current count. Pure
 * function — pass in a JSON loader so this is testable without touching
 * the filesystem or git.
 *
 * Returns: array of `{ key, max, current, status, ... }` records, one per
 * budget. `status` is `at_limit` | `warning` | `ok` | `unreadable`.
 */
export function evaluateBudgets(budgets, loadJson) {
  const results = []
  for (const b of budgets) {
    const evaluator = EVALUATORS[b.evaluator]
    if (!evaluator) {
      results.push({
        ...b,
        current: 0,
        status: 'unreadable',
        reason: `unknown evaluator: ${b.evaluator}`,
      })
      continue
    }
    const parsed = loadJson(b.file)
    if (parsed === null) {
      // Missing file is fine for budgets — nothing to count.
      results.push({ ...b, current: 0, status: 'ok' })
      continue
    }
    const current = evaluator(parsed)
    let status
    if (current >= b.max) status = 'at_limit'
    else if (current >= b.max * 0.85) status = 'warning'
    else status = 'ok'
    results.push({ ...b, current, status })
  }
  return results
}

// ─── Pre-commit guard ────────────────────────────────────────────────────────

/**
 * Decide whether the staged change set should block. Only fail when the
 * commit actually touches a budgeted file; otherwise the gate has nothing
 * to say. Warnings are surfaced as console output but never block.
 */
export function shouldBlock(results, stagedFiles) {
  const stagedSet = new Set(stagedFiles)
  const blockers = results.filter((r) => r.status === 'at_limit' && stagedSet.has(r.file))
  return {
    blockers,
    warnings: results.filter((r) => r.status === 'warning' && stagedSet.has(r.file)),
  }
}

function main() {
  if (process.env.BUDGETS_CHECK_BYPASS === '1') {
    console.log('⚠ BUDGETS_CHECK_BYPASS=1 — resource budget guard skipped.')
    process.exit(0)
  }

  const staged = getStagedFiles()
  const trackedFiles = new Set(BUDGETS.map((b) => b.file))
  const touched = staged.some((f) => trackedFiles.has(f))
  if (!touched) process.exit(0)

  const results = evaluateBudgets(BUDGETS, loadStagedJson)
  const { blockers, warnings } = shouldBlock(results, staged)

  for (const w of warnings) {
    const pct = Math.round((w.current / w.max) * 100)
    console.warn(`⚠ Budget ${w.key} at ${w.current}/${w.max} (${pct}%) — approaching ceiling.`)
  }

  if (blockers.length === 0) process.exit(0)

  console.error('❌ Resource budget(s) exceeded — commit blocked:\n')
  for (const b of blockers) {
    console.error(
      `   ${b.key}: ${b.current} / ${b.max}\n` + `     source: ${b.file}\n` + `     ${b.note}\n`
    )
  }
  console.error('   See migration 0159 (harness_resource_budgets) and docs/resource-budgets.md.')
  console.error('   Bypass: BUDGETS_CHECK_BYPASS=1 git commit ... (use rarely).')
  process.exit(1)
}

const entry = process.argv[1]
if (entry && fileURLToPath(import.meta.url) === entry) {
  main()
}
