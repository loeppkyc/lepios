#!/usr/bin/env node
// Multi-window protocol — claim a scope on the current branch.
//
// Usage:
//   node scripts/window-start.mjs --scope <glob> [--scope <glob>...] [--note "<text>"]
//                                  [--allow-main-checkout]
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
//   5. Refuse if running in the main checkout while OTHER windows are live (F-N8 prevention) —
//      bypass with --allow-main-checkout
//   6. Detect scope overlap with other live windows; refuse if overlap
//   7. Write `.claude/active-windows/<branch>.json` (resolved via git common-dir, so it is
//      shared across all worktrees of this repo)
//
// On clean shutdown: `node scripts/window-end.mjs`

import {
  currentBranch,
  hasOtherWorktrees,
  isMainCheckout,
  loadAllClaims,
  loadClaimForBranch,
  pruneStaleClaims,
  scopeOverlaps,
  workingTreeClean,
  writeClaim,
} from './lib/window-claim.mjs'

function parseArgs(argv) {
  const scope = []
  let note = null
  let allowMainCheckout = false
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
    } else if (a === '--allow-main-checkout') {
      allowMainCheckout = true
      i += 1
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
  return { scope, note, allowMainCheckout }
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
  const { scope, note, allowMainCheckout } = parseArgs(process.argv.slice(2))

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

  // F-N8/F-N10 prevention: claiming in the main checkout drags uncommitted edits
  // across branches on `git checkout`. The original F-N8 guard (only fired when
  // OTHER windows had live claims) recurred as F-N10 because between-session
  // claim pruning created a window where the repo has worktrees but no live
  // claims, so the guard passed but the F-N8 risk was still present.
  //
  // F-N10 fix: refuse main-checkout claim when ANY linked worktree exists,
  // regardless of live claims. Once you've used worktrees in this repo, you
  // must continue. The --allow-main-checkout escape hatch still exists for
  // truly-single-window emergencies, but now requires explicit acknowledgement.
  const otherClaims = loadAllClaims().filter((c) => c.branch !== branch)
  const inMainCheckout = isMainCheckout()
  const worktreesPresent = hasOtherWorktrees()
  const wouldF8 = otherClaims.length > 0 // legacy F-N8 condition
  const wouldF10 = worktreesPresent // new F-N10 condition

  if (inMainCheckout && (wouldF8 || wouldF10) && !allowMainCheckout) {
    const branchSlug = branch.replace(/[^a-zA-Z0-9._-]/g, '-')
    const reasonLine = wouldF8
      ? `F-N8 — git checkout in a shared working tree drags uncommitted edits across branches (${otherClaims.length} live window(s)).`
      : `F-N10 — repo has linked worktrees from prior sessions; main-checkout claim would re-introduce the F-N8 trap on the next concurrent window.`
    const livesBlock =
      otherClaims.length > 0
        ? `\n   Other live windows:\n` + otherClaims.map((c) => `     - ${c.branch}`).join('\n')
        : ''
    block(
      `Cannot claim a window in the MAIN checkout.\n` +
        `   Reason: ${reasonLine}` +
        livesBlock +
        `\n\n` +
        `   Fix: create a worktree and start the window from there:\n` +
        `     git worktree add ../lepios-${branchSlug} ${branch}\n` +
        `     # PowerShell — junction node_modules + .husky/_ for isolation:\n` +
        `     New-Item -ItemType Junction -Path ..\\lepios-${branchSlug}\\node_modules -Target ..\\lepios\\node_modules\n` +
        `     New-Item -ItemType Junction -Path ..\\lepios-${branchSlug}\\.husky\\_ -Target ..\\lepios\\.husky\\_\n` +
        `     cd ../lepios-${branchSlug}\n` +
        `     node scripts/window-start.mjs --scope "<glob>" ...\n` +
        `\n` +
        `   See memory: multi_window_worktree_pattern.md\n` +
        `\n` +
        `   To bypass once (single-window emergency, you accept F-N8/F-N10 risk):\n` +
        `     node scripts/window-start.mjs --allow-main-checkout --scope ...`
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
