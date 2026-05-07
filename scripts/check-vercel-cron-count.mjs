#!/usr/bin/env node
/**
 * Vercel cron-count + cadence guard.
 *
 * Aborts a commit that would push vercel.json past Hobby plan limits.
 * Hobby silently rejects the entire config at validation — no deploy
 * record is created, no build runs, every subsequent PR fails with the
 * same stale placeholder URL until someone notices and reverts.
 * See F-L11 (CLAUDE.md §9) and F-N9 for the recurring incident class.
 *
 * Two checks:
 *   1. Total cron count must be ≤ MAX_CRONS.
 *   2. No cron schedule may be sub-hourly (any star-slash-N minute pattern,
 *      or any pattern that runs more than once per hour).
 *
 * Run via husky pre-commit. Bypass: VERCEL_CRON_CHECK_BYPASS=1
 * (use only when explicitly upgrading plan or removing crons in the
 * same commit such that the validator still passes).
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

// Empirical ceiling for the LepiOS Vercel Hobby account as of 2026-05-07.
// PR #107 deployed at 18 crons; PR #109 (19 crons) and everything after were
// silently rejected. Raise this when the project moves to a paid plan, and
// add a CRON_LIMIT_PLAN env var if multiple plans need to be supported.
const MAX_CRONS = 18

const VERCEL_JSON = 'vercel.json'

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

function loadStagedVercelJson() {
  // Prefer the staged version (what's about to be committed) over the
  // working-tree version, so the check matches what will land on main.
  try {
    const staged = execSync('git show :' + VERCEL_JSON, { encoding: 'utf8' })
    return JSON.parse(staged)
  } catch {
    if (!existsSync(VERCEL_JSON)) return null
    return JSON.parse(readFileSync(VERCEL_JSON, 'utf8'))
  }
}

function isSubHourly(schedule) {
  // Cron has 5 fields: minute hour dom month dow.
  // Sub-hourly = minute field that runs more than once per hour.
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minute] = parts

  // Star in minute = every minute = sub-hourly
  if (minute === '*') return true

  // Star-slash-N step = sub-hourly when N < 60 (always true for valid step)
  if (/^\*\/\d+$/.test(minute)) return true

  // Multiple discrete minutes (e.g. "0,30") = sub-hourly
  if (minute.includes(',')) return true

  // Range like "0-30" without step = sub-hourly (every minute in range)
  if (/^\d+-\d+$/.test(minute) && !minute.includes('/')) return true

  // Single integer (e.g. "0", "15") = once per hour at that minute → hourly,
  // not sub-hourly. Hourly is allowed by Hobby; only sub-hourly is rejected.
  return false
}

export function validate(config, { strictSubHourly = true } = {}) {
  const errors = []
  const crons = config?.crons ?? []

  if (crons.length > MAX_CRONS) {
    errors.push(
      `vercel.json has ${crons.length} crons; Hobby plan ceiling is ${MAX_CRONS}.\n` +
        `   Remove ${crons.length - MAX_CRONS} cron(s) or upgrade to Pro before merging.\n` +
        `   See F-L11 / F-N9 in CLAUDE.md for context.`
    )
  }

  if (strictSubHourly) {
    const subHourly = crons.filter((c) => c.schedule && isSubHourly(c.schedule))
    if (subHourly.length > 0) {
      const list = subHourly.map((c) => `     - ${c.path} (${c.schedule})`).join('\n')
      errors.push(
        `vercel.json has ${subHourly.length} sub-hourly cron(s) — Hobby plan rejects these:\n` +
          list +
          '\n   Move to hourly cadence (e.g. "0 * * * *") or invoke from an existing daily cron.'
      )
    }
  }

  return errors
}

function main() {
  if (process.env.VERCEL_CRON_CHECK_BYPASS === '1') {
    console.log('⚠ VERCEL_CRON_CHECK_BYPASS=1 — cron-count guard skipped.')
    return
  }

  const staged = getStagedFiles()
  if (!staged.includes(VERCEL_JSON)) {
    // Not committing vercel.json — nothing to check.
    return
  }

  const config = loadStagedVercelJson()
  if (!config) {
    console.error(`❌ vercel.json staged but unreadable.`)
    process.exit(1)
  }

  const errors = validate(config)
  if (errors.length === 0) {
    return
  }

  console.error('❌ vercel.json change would break Vercel Hobby deploys:\n')
  for (const e of errors) {
    console.error('   ' + e + '\n')
  }
  console.error(
    '   Bypass: VERCEL_CRON_CHECK_BYPASS=1 git commit ... (only after upgrading plan).'
  )
  process.exit(1)
}

const entry = process.argv[1]
if (entry && import.meta.url === 'file://' + entry.replace(/\\/g, '/')) {
  main()
}
