/**
 * verify-chunk-e-e2e.mjs — E2E verification for Chunk E (auto-promote via GitHub merge)
 *
 * Phase 1: Kill switch (DEPLOY_GATE_AUTO_PROMOTE=0 in Vercel)
 *   - schema-clean commit → runner returns promotion-skipped in results
 *   - No deploy_gate_promoted row written
 *   - Branch still exists on GitHub
 *
 * Phase 2: Real merge (DEPLOY_GATE_AUTO_PROMOTE=1, write-access GITHUB_TOKEN)
 *   - Requires GITHUB_TOKEN upgrade first (currently read-only)
 *   - Flagged as SKIP until token is upgraded
 *
 * Run: node scripts/verify-chunk-e-e2e.mjs
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// ── Load .env.local ────────────────────────────────────────────────────────────
try {
  const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* rely on shell env */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const LIVE_URL = 'https://lepios-one.vercel.app'

if (!SUPABASE_URL || !SUPABASE_SVC_KEY || !CRON_SECRET) {
  console.error('Missing required env vars')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)

const results = []
function pass(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail })
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
function skip(name, detail = '') {
  results.push({ ok: true, name, detail: `[SKIP] ${detail}` })
  console.log(`  - ${name} [SKIP] ${detail}`)
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function fireTrigger(branch, commitSha, taskId, runId) {
  const res = await fetch(`${LIVE_URL}/api/harness/deploy-gate/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, branch, commit_sha: commitSha, run_id: runId, tests_passed: true }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function injectSmokePassed(commitSha) {
  const { error } = await db.from('agent_events').insert({
    id: randomUUID(),
    domain: 'orchestrator',
    action: 'deploy_gate_runner',
    actor: 'deploy_gate',
    status: 'success',
    task_type: 'deploy_gate_smoke_preview',
    output_summary: `smoke pass (injected for chunk-e E2E) on commit ${commitSha}`,
    meta: { commit_sha: commitSha, preview_url: 'https://lepios-test.vercel.app', status_code: 200, response_ms: 42, chunk_e_e2e_test: true },
    tags: ['deploy_gate', 'harness', 'chunk_e_e2e'],
  })
  if (error) throw new Error(`inject smoke: ${error.message}`)
}

async function fireRunner() {
  const res = await fetch(`${LIVE_URL}/api/cron/deploy-gate-runner`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function cleanupTestRows(commitShas) {
  for (const sha of commitShas) {
    await db.from('agent_events').delete().filter('meta->>commit_sha', 'eq', sha)
      .filter('meta->>chunk_e_e2e_test', 'eq', 'true')
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_smoke_preview')
      .filter('meta->>commit_sha', 'eq', sha).filter('meta->>chunk_e_e2e_test', 'eq', 'true')
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_triggered')
      .filter('meta->>commit_sha', 'eq', sha)
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_processing')
      .filter('meta->>commit_sha', 'eq', sha)
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_schema_check')
      .filter('meta->>commit_sha', 'eq', sha)
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_promoted')
      .filter('meta->>commit_sha', 'eq', sha)
    await db.from('agent_events').delete().eq('task_type', 'deploy_gate_failed')
      .filter('meta->>commit_sha', 'eq', sha)
  }
}

// SHA from harness/task-chunk-e-killswitch-verify (README bump, no migrations → schema-clean)
const NO_MIGRATION_SHA = '48da54ada18e3206d850a9c60d9f22bc0c7229a2'
const NO_MIGRATION_BRANCH = 'harness/task-chunk-e-killswitch-verify'

console.log('\nChunk E E2E Verify — auto-promote via GitHub merge')
console.log('─'.repeat(65))

// ── Phase 1: Kill switch (DEPLOY_GATE_AUTO_PROMOTE=0) ─────────────────────────
console.log('\n[Phase 1: Kill switch — DEPLOY_GATE_AUTO_PROMOTE=0 in Vercel]')
console.log(`  commit: ${NO_MIGRATION_SHA.slice(0, 12)}...`)
console.log('  expect: runner returns promotion-skipped, no deploy_gate_promoted row')

const taskId1 = randomUUID()
const runId1 = randomUUID()

let triggerOk = false
try {
  const t = await fireTrigger(NO_MIGRATION_BRANCH, NO_MIGRATION_SHA, taskId1, runId1)
  if (t.status === 200 && t.body?.ok) {
    pass('trigger endpoint', `event_id: ${t.body.event_id ?? '?'}`)
    triggerOk = true
  } else {
    fail('trigger endpoint', `status=${t.status} body=${JSON.stringify(t.body).slice(0, 100)}`)
  }
} catch (e) {
  fail('trigger endpoint', e.message)
}

if (triggerOk) {
  try {
    await injectSmokePassed(NO_MIGRATION_SHA)
    pass('smoke_preview inject', 'shortcut row written')
  } catch (e) {
    fail('smoke_preview inject', e.message)
  }

  await sleep(500)

  let runnerBody
  try {
    const r = await fireRunner()
    runnerBody = r.body
    if (r.status === 200 && r.body?.ok) {
      pass('runner fired', `processed=${r.body.processed} results=${JSON.stringify(r.body.results ?? [])}`)
    } else {
      fail('runner fired', `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`)
    }
  } catch (e) {
    fail('runner fired', e.message)
  }

  if (runnerBody) {
    const resultsList = runnerBody.results ?? []
    const hasPromotionSkipped = resultsList.some((r) => r.includes('promotion-skipped'))
    const hasPromoted = resultsList.some((r) => r.includes(':promoted'))
    const hasMergeFailed = resultsList.some((r) => r.includes(':merge-failed'))

    if (hasPromotionSkipped) {
      pass('promotion-skipped in results', 'kill switch respected')
    } else if (hasPromoted) {
      fail('promotion-skipped expected', 'got :promoted — DEPLOY_GATE_AUTO_PROMOTE is not 0 in Vercel')
    } else if (hasMergeFailed) {
      fail('promotion-skipped expected', 'got :merge-failed — GITHUB_TOKEN may have write access but merge failed')
    } else {
      fail('promotion result', `unexpected results: ${JSON.stringify(resultsList)}`)
    }

    // Verify no deploy_gate_promoted row
    await sleep(1000)
    const { data: promotedRows } = await db
      .from('agent_events')
      .select('id, status')
      .eq('task_type', 'deploy_gate_promoted')
      .filter('meta->>commit_sha', 'eq', NO_MIGRATION_SHA)
    if (!promotedRows || promotedRows.length === 0) {
      pass('no deploy_gate_promoted row', 'kill switch confirmed — no promotion DB row')
    } else {
      fail('no deploy_gate_promoted row', `unexpected promoted row found: ${JSON.stringify(promotedRows)}`)
    }
  }
}

// ── Phase 2: Real merge (requires write-access GITHUB_TOKEN) ──────────────────
console.log('\n[Phase 2: Real merge — DEPLOY_GATE_AUTO_PROMOTE=1 + write GITHUB_TOKEN]')
skip('real merge', 'GITHUB_TOKEN needs write access (Contents + PRs). Upgrade token first, then set DEPLOY_GATE_AUTO_PROMOTE=1 in Vercel and re-run this script.')

// ── Cleanup ───────────────────────────────────────────────────────────────────
console.log('\n[cleanup]')
try {
  await cleanupTestRows([NO_MIGRATION_SHA])
  pass('cleanup', 'test rows removed')
} catch (e) {
  fail('cleanup', e.message)
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(65))
const passed = results.filter((r) => r.ok).length
const total = results.length
const allPass = passed === total
console.log(`${allPass ? '✓ ALL PASS' : '✗ FAILURES PRESENT'} — ${passed}/${total} checks`)
if (!allPass) {
  console.log('\nFailed:')
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}: ${r.detail}`))
}
console.log('\nPhase 2 (real merge) requires:')
console.log('  1. npx vercel env rm DEPLOY_GATE_AUTO_PROMOTE production --yes')
console.log('  2. npx vercel env add DEPLOY_GATE_AUTO_PROMOTE production --value 1 --yes')
console.log('  3. Upgrade GITHUB_TOKEN to Contents: read+write, Pull requests: read+write')
console.log('  4. node scripts/verify-chunk-e-e2e.mjs')
process.exit(allPass ? 0 : 1)
