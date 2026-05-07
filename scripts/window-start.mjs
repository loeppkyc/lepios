#!/usr/bin/env node
// Multi-window protocol — claim a scope on the current branch.
//
// Usage:
//   node scripts/window-start.mjs --scope <glob> [--scope <glob>...] [--note "<text>"]
//
// Examples:
//   node scripts/window-start.mjs --scope "lib/auth/**" --scope "tests/auth/**"
//   node scripts/window-start.mjs --scope "app/api/admin/**" --note "admin UI work"
//
// What it does:
//   1. Verify the working tree is clean (tracked files only — untracked tolerated)
//   2. Refuse to claim while on `main`
//   3. Prune stale claims (heartbeat older than 30 minutes)
//   4. Refuse if this branch already has a claim
//   5. Detect scope overlap with other live windows; refuse if overlap
//   6. Write `.claude/active-windows/<branch>.json` with branch, scope, started_at, pid
//
// On clean shutdown: `node scripts/window-end.mjs`

import {
  currentBranch,
  workingTreeClean,
  loadAllClaims,
  loadClaimForBranch,
  pruneStaleClaims,
  scopeOverlaps,
  writeClaim,
} from './lib/window-claim.mjs'

function parseArgs(argv) {
  const scope = []
  let note = null
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--scope') {
      const next = argv[i + 1]
      if (!next) fail('--scope requires a glob argument')
      scope.push(next)
      i += 2
    } else if (a === '--note') {
      const next = argv[i + 1]
      if (!next) fail('--note requires a string argument')
      note = next
      i += 2
    } else {
      fail(`unrecognized argument: ${a}`)
    }
  }
  if (scope.length === 0) {
    fail(
      'at least one --scope is required.\n' +
        '  Example: node scripts/window-start.mjs --scope "lib/auth/**" --scope "tests/auth/**"'
    )
  }
  return { scope, note }
}

function fail(msg) {
  console.error(`window-start: ${msg}`)
  process.exit(2)
}

function block(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

function main() {
  const { scope, note } = parseArgs(process.argv.slice(2))

  if (!workingTreeClean()) {
    block(
      'Working tree has uncommitted changes. Commit, stash, or revert before claiming a window.'
    )
  }

  const branch = currentBranch()
  if (branch === 'main' || branch === 'HEAD') {
    block(`Cannot claim window on '${branch}'. Switch to a feature branch first.`)
  }

  const pruned = pruneStaleClaims()
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} stale claim(s): ${pruned.join(', ')}`)
  }

  if (loadClaimForBranch(branch)) {
    const existing = loadClaimForBranch(branch)
    block(
      `Window already claimed for branch '${branch}':\n` +
        `   started_at: ${existing.started_at}\n` +
        `   last_heartbeat: ${existing.last_heartbeat}\n` +
        `   pid: ${existing.pid}\n` +
        `   If this is stale, run: node scripts/window-end.mjs --force`
    )
  }

  const conflicts = []
  for (const other of loadAllClaims()) {
    if (other.branch === branch) continue
    const overlaps = scopeOverlaps(scope, other.scope || [])
    if (overlaps.length > 0) {
      conflicts.push({ branch: other.branch, overlaps })
    }
  }
  if (conflicts.length > 0) {
    let msg = 'Scope overlap with other live windows:\n'
    for (const c of conflicts) {
      msg += `   branch: ${c.branch}\n`
      for (const o of c.overlaps) {
        msg += `     mine "${o.mine}" overlaps theirs "${o.theirs}"\n`
      }
    }
    msg += '   Coordinate with the other window or narrow your scope before claiming.'
    block(msg)
  }

  const now = new Date().toISOString()
  const claim = {
    branch,
    scope,
    started_at: now,
    last_heartbeat: now,
    pid: process.pid,
    note,
  }
  const path = writeClaim(claim)

  console.log(`✅ Window claimed`)
  console.log(`   branch: ${branch}`)
  console.log(`   scope:`)
  for (const g of scope) console.log(`     - ${g}`)
  if (note) console.log(`   note: ${note}`)
  console.log(`   claim file: ${path}`)
  console.log(``)
  console.log(`Other live windows:`)
  const others = loadAllClaims().filter((c) => c.branch !== branch)
  if (others.length === 0) {
    console.log(`   (none)`)
  } else {
    for (const o of others) {
      console.log(`   - ${o.branch}: ${(o.scope || []).join(', ')}`)
    }
  }
  console.log(``)
  console.log(`On shutdown: node scripts/window-end.mjs`)
}

main()
