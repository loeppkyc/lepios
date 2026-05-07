#!/usr/bin/env node
// Multi-window protocol — print all active window claims.
//
// Usage:
//   node scripts/window-status.mjs
//   node scripts/window-status.mjs --prune   # also remove stale claims
//
// Output: tabular summary of every claim file under .claude/active-windows/.

import { currentBranch, loadAllClaims, pruneStaleClaims, STALE_MS } from './lib/window-claim.mjs'

const args = process.argv.slice(2)
const shouldPrune = args.includes('--prune')

if (shouldPrune) {
  const pruned = pruneStaleClaims()
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} stale claim(s):`)
    for (const p of pruned) console.log(`   - ${p}`)
  } else {
    console.log('No stale claims to prune.')
  }
  console.log('')
}

const claims = loadAllClaims()
const me = currentBranch()

if (claims.length === 0) {
  console.log('No active windows.')
  process.exit(0)
}

const now = Date.now()
console.log(`Active windows (${claims.length}):`)
console.log('')
for (const c of claims) {
  const isMe = c.branch === me ? ' (me)' : ''
  const beat = Date.parse(c.last_heartbeat || c.started_at || 0)
  const ageMs = Number.isFinite(beat) ? now - beat : Infinity
  const ageMin = Math.floor(ageMs / 60000)
  const stale = ageMs > STALE_MS ? ' [STALE]' : ''
  console.log(`  ${c.branch}${isMe}${stale}`)
  console.log(`    started:   ${c.started_at}`)
  console.log(`    heartbeat: ${c.last_heartbeat} (${ageMin}m ago)`)
  if (c.pid) console.log(`    pid:       ${c.pid}`)
  if (c.note) console.log(`    note:      ${c.note}`)
  console.log(`    scope:`)
  for (const g of c.scope || []) console.log(`      - ${g}`)
  console.log('')
}
