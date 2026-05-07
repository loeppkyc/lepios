#!/usr/bin/env node
// Multi-window protocol — pre-commit gate. Verifies that every staged file
// falls within the active window's declared scope on the current branch.
//
// Called by .husky/pre-commit. Exits 0 on pass, 1 on block.
//
// Bypass for ad-hoc commits (use sparingly):
//   WINDOW_SCOPE_BYPASS=1 git commit ...

import {
  currentBranch,
  fileMatchesScope,
  heartbeat,
  loadClaimForBranch,
  pruneStaleClaims,
  stagedFiles,
} from './lib/window-claim.mjs'

if (process.env.WINDOW_SCOPE_BYPASS === '1') {
  console.log('window-scope-check: bypassed via WINDOW_SCOPE_BYPASS=1')
  process.exit(0)
}

const staged = stagedFiles()
if (staged.length === 0) {
  // Empty/merge commits — nothing to check.
  process.exit(0)
}

// Self-claiming files: a window can always commit its own claim file or removal of any
// stale claim file. Lets the very first window-start.mjs run commit-able-from-day-one.
const SELF_CLAIM_PATTERN = /^\.claude\/active-windows\/.*\.json$/
const allSelfClaim = staged.every((f) => SELF_CLAIM_PATTERN.test(f))
if (allSelfClaim) {
  process.exit(0)
}

// Opportunistic stale-prune so old machines don't accumulate dead claims.
pruneStaleClaims()

const branch = currentBranch()
const claim = loadClaimForBranch(branch)

if (!claim) {
  console.error(`❌ No active window claim for branch '${branch}'.`)
  console.error(``)
  console.error(`   Multi-window protocol requires every working session to declare its scope.`)
  console.error(`   Start a window:`)
  console.error(`     node scripts/window-start.mjs --scope "<glob>" [--scope "<glob>"...]`)
  console.error(``)
  console.error(`   Bypass for one commit (use sparingly):`)
  console.error(`     WINDOW_SCOPE_BYPASS=1 git commit ...`)
  process.exit(1)
}

const outOfScope = staged.filter((f) => !fileMatchesScope(f, claim.scope || []))
if (outOfScope.length > 0) {
  console.error(`❌ Commit touches files outside the active window's scope (branch '${branch}').`)
  console.error(``)
  console.error(`   Declared scope:`)
  for (const g of claim.scope || []) console.error(`     - ${g}`)
  console.error(``)
  console.error(`   Out-of-scope files staged:`)
  for (const f of outOfScope) console.error(`     - ${f}`)
  console.error(``)
  console.error(`   Fix: either unstage those files, or extend scope:`)
  console.error(`     node scripts/window-end.mjs && node scripts/window-start.mjs --scope ...`)
  console.error(``)
  console.error(`   Or for a one-off out-of-scope commit:`)
  console.error(`     WINDOW_SCOPE_BYPASS=1 git commit ...`)
  process.exit(1)
}

// Side effect: bump heartbeat so the claim doesn't go stale during long sessions.
heartbeat(branch)
process.exit(0)
