#!/usr/bin/env node
/**
 * Multi-window protocol — bump the current branch's claim heartbeat.
 *
 * The pre-commit hook also bumps heartbeat as a side-effect, but for sessions
 * that don't commit for ≥30 min (audit-only, long research, idle) the claim
 * goes stale and gets pruned by the next window-start. Calling this script
 * periodically during a long session keeps the claim alive.
 *
 * Usage:
 *   node scripts/window-heartbeat.mjs
 *
 * Exit codes:
 *   0 — heartbeat bumped (or "no claim" — idempotent no-op)
 *   1 — error reading/writing claim file
 */

import { currentBranch, heartbeat } from './lib/window-claim.mjs'

try {
  const branch = currentBranch()
  const ok = heartbeat(branch)
  if (ok) {
    console.log(`heartbeat: ${branch}`)
  } else {
    console.log(`heartbeat: no active claim for branch '${branch}' — no-op`)
  }
  process.exit(0)
} catch (err) {
  console.error(`heartbeat error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
