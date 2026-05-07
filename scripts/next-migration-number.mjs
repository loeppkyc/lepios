#!/usr/bin/env node
/**
 * Multi-window protocol — print the next free migration number.
 *
 * Always fetches origin/main first so the answer reflects the live state, not
 * a stale local view. Closes the migration-claim race documented in F-N3 and
 * Sprint 6 backlog P5-2.
 *
 * Usage:
 *   node scripts/next-migration-number.mjs               # → "0159"
 *   node scripts/next-migration-number.mjs --json        # → JSON with diagnostics
 *   node scripts/next-migration-number.mjs --no-fetch    # skip git fetch (offline)
 *
 * Workflow:
 *   1. Run this script
 *   2. Use the printed number for your migration filename
 *   3. Add the entry to .claude/migration-claims.json BEFORE creating the file
 *   4. Commit migration + claims update together (pre-commit hook validates)
 */

import {
  CLAIMS_FILE,
  compareClaims,
  computeNextNumber,
  fetchOriginMain,
  padNumber,
  readLocalClaims,
  readOriginMainClaims,
} from './lib/migration-claims.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const noFetch = args.includes('--no-fetch')

let fetched = false
if (!noFetch) {
  fetched = fetchOriginMain()
}

let local
try {
  local = readLocalClaims()
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
}

const origin = noFetch ? null : readOriginMainClaims()
const cmp = compareClaims(local, origin)

// Compute next from origin if we have it (authoritative), else from local.
const sourceClaims = origin ?? local
const next = computeNextNumber(sourceClaims)
const padded = padNumber(next)

if (json) {
  console.log(
    JSON.stringify(
      {
        next: padded,
        next_int: next,
        fetched,
        in_sync: cmp.inSync,
        behind: cmp.inSync ? [] : cmp.behind,
        ahead: cmp.inSync ? [] : cmp.ahead,
        source: origin ? 'origin/main' : 'local',
      },
      null,
      2
    )
  )
} else {
  console.log(padded)
  if (!cmp.inSync) {
    console.error('')
    console.error(`⚠️  Local ${CLAIMS_FILE} differs from origin/main:`)
    if (cmp.behind.length > 0) {
      console.error(
        `   Behind (claimed on origin/main but not local): ${cmp.behind.sort().join(', ')}`
      )
      console.error(`   → Pull/rebase before claiming a new number to avoid race.`)
    }
    if (cmp.ahead.length > 0) {
      console.error(
        `   Ahead (claimed locally but not on origin/main): ${cmp.ahead.sort().join(', ')}`
      )
      console.error(`   → Your in-flight branches; ignore if expected.`)
    }
  }
}
