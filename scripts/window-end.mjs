#!/usr/bin/env node
// Multi-window protocol — release the claim on the current branch.
//
// Usage:
//   node scripts/window-end.mjs           # release current branch's claim
//   node scripts/window-end.mjs --force   # delete claim even if file looks unfamiliar
//
// Idempotent: exits 0 if there's no claim to release.

import { currentBranch, deleteClaim, loadClaimForBranch } from './lib/window-claim.mjs'

const force = process.argv.slice(2).includes('--force')
const branch = currentBranch()
const claim = loadClaimForBranch(branch)

if (!claim) {
  console.log(`No claim to release for branch '${branch}'.`)
  process.exit(0)
}

if (!force && claim.pid && claim.pid !== process.pid) {
  console.log(
    `Releasing claim for branch '${branch}' (started_at=${claim.started_at}, pid=${claim.pid}).`
  )
}

const path = deleteClaim(branch)
console.log(`✅ Released: ${path}`)
