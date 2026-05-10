/**
 * scripts/backfill-module-locks.ts
 *
 * Set in_progress_branch on streamlit_modules rows that correspond to modules
 * actively owned by an open feature branch. Safe to re-run (idempotent).
 *
 * Run after migration 0174 is applied:
 *   npx tsx scripts/backfill-module-locks.ts
 *
 * Add new entries to BRANCH_LOCKS below whenever a feature branch claims a module.
 * Remove entries when the branch is merged.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}

// ── Active branch → module path mapping ──────────────────────────────────────
// Format: { path: string, branch: string, note?: string }
// 'path' must match exactly the value in streamlit_modules.path.

const BRANCH_LOCKS = [
  {
    path: 'pages/21_PageProfit.py',
    branch: 'feat/pageprofit-port',
    note: 'PR #181 — sub-modules 1-10 + cockpit tile (open, not merged)',
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = createClient(supabaseUrl!, serviceKey!)

  console.log('='.repeat(60))
  console.log('LepiOS — backfill streamlit_modules lock fields')
  console.log('='.repeat(60))
  console.log(`\n${BRANCH_LOCKS.length} lock(s) to apply\n`)

  let applied = 0
  let skipped = 0
  let failed = 0

  for (const lock of BRANCH_LOCKS) {
    // Verify path exists
    const { data: existing, error: fetchErr } = await db
      .from('streamlit_modules')
      .select('id, path, in_progress_branch')
      .eq('path', lock.path)
      .maybeSingle()

    if (fetchErr) {
      console.error(`  ❌ fetch error for ${lock.path}: ${fetchErr.message}`)
      failed++
      continue
    }

    if (!existing) {
      console.warn(`  ⚠️  path not found in catalog: ${lock.path} — skipping`)
      skipped++
      continue
    }

    if (existing.in_progress_branch === lock.branch) {
      console.log(`  ✓ already locked: ${lock.path} → ${lock.branch}`)
      skipped++
      continue
    }

    const { error: updateErr } = await db
      .from('streamlit_modules')
      .update({
        in_progress_branch: lock.branch,
        locked_at: new Date().toISOString(),
      })
      .eq('path', lock.path)

    if (updateErr) {
      console.error(`  ❌ update error for ${lock.path}: ${updateErr.message}`)
      failed++
      continue
    }

    console.log(`  ✅ locked: ${lock.path} → ${lock.branch}`)
    if (lock.note) console.log(`     note: ${lock.note}`)
    applied++
  }

  console.log('\n' + '-'.repeat(60))
  console.log(`Applied: ${applied}  Skipped: ${skipped}  Failed: ${failed}`)
  console.log('-'.repeat(60))

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
