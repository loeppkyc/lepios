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

// Fire-and-forget: log scope_drift event to agent_events so /harness/drift can track it.
// Reads .env.local itself so it doesn't depend on the hook's env-loading section.
async function logScopeDrift(branch, outOfScope, claimScope) {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const envPath = join(root, '.env.local')
    if (!existsSync(envPath)) return
    const env = {}
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      env[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
    const url = env['NEXT_PUBLIC_SUPABASE_URL']?.trim()
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env['SUPABASE_SERVICE_ROLE_KEY'])?.trim()
    if (!url || !key) return
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false } })
    await db.from('agent_events').insert({
      domain: 'claude_code',
      action: 'scope_drift',
      actor: branch,
      status: 'warning',
      input_summary: `Out-of-scope: ${outOfScope.slice(0, 5).join(', ')}`.slice(0, 500),
      meta: { files: outOfScope, claimed_scope: claimScope },
    })
  } catch {
    // Never break the commit hook on a log failure
  }
}

async function run() {
  if (process.env.WINDOW_SCOPE_BYPASS === '1') {
    console.log('window-scope-check: bypassed via WINDOW_SCOPE_BYPASS=1')
    process.exit(0)
  }

  // Always prune first — every commit is a chance to clean up dead-window claims
  // regardless of staged-file shape. P5-3: closes the orphan-claim gap where
  // empty/merge commits or self-claim-only commits skipped pruning.
  pruneStaleClaims()

  const staged = stagedFiles()
  if (staged.length === 0) {
    // Empty/merge commits — nothing to scope-check.
    process.exit(0)
  }

  // Self-claiming files: a window can always commit its own claim file or removal of any
  // stale claim file. Lets the very first window-start.mjs run commit-able-from-day-one.
  const SELF_CLAIM_PATTERN = /^\.claude\/active-windows\/.*\.json$/
  const allSelfClaim = staged.every((f) => SELF_CLAIM_PATTERN.test(f))
  if (allSelfClaim) {
    process.exit(0)
  }

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
    await logScopeDrift(branch, outOfScope, claim.scope || [])
    process.exit(1)
  }

  // Side effect: bump heartbeat so the claim doesn't go stale during long sessions.
  heartbeat(branch)
  process.exit(0)
}

run().catch(() => process.exit(1))
