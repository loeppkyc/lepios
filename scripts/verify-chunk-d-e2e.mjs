/**
 * verify-chunk-d-e2e.mjs — E2E verification for Chunk D (migration detection)
 *
 * Strategy: uses the smokePassedShas shortcut to bypass Vercel preview wait.
 * Injects a deploy_gate_smoke_preview:success row so the runner skips directly
 * to detectMigrations() — which is the actual Chunk D code under test.
 *
 * Branches:
 *   harness/task-chunk-d-migration-verify  — SHA: bdbedd3... (has 0017_chunk_d_test.sql)
 *   harness/task-chunk-d-nomigration-verify — SHA: b6f12e6... (README bump only)
 *
 * Expected:
 *   migration branch   → deploy_gate_schema_check status=warning, has_migrations=true
 *   no-migration branch → deploy_gate_schema_check status=success, has_migrations=false
 *
 * Run: node scripts/verify-chunk-d-e2e.mjs
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

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!CRON_SECRET) {
  console.error('Missing CRON_SECRET')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)
const TEST_ROWS = []

const results = []
function pass(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail })
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fireTrigger(branch, commitSha, taskId, runId) {
  const res = await fetch(`${LIVE_URL}/api/harness/deploy-gate/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task_id: taskId,
      branch,
      commit_sha: commitSha,
      run_id: runId,
      tests_passed: true,
    }),
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
    output_summary: `smoke pass (injected for chunk-d E2E) on commit ${commitSha}`,
    meta: {
      commit_sha: commitSha,
      preview_url: 'https://lepios-test.vercel.app',
      status_code: 200,
      response_ms: 42,
      chunk_d_e2e_test: true,
    },
    tags: ['deploy_gate', 'harness', 'chunk_d_e2e'],
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

async function pollSchemaCheck(commitSha, maxWaitMs = 15_000) {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const { data } = await db
      .from('agent_events')
      .select('id, status, output_summary, meta')
      .eq('task_type', 'deploy_gate_schema_check')
      .filter('meta->>commit_sha', 'eq', commitSha)
      .order('occurred_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) return data[0]
    await sleep(2000)
  }
  return null
}

async function cleanupTestRows(commitShas) {
  for (const sha of commitShas) {
    await db
      .from('agent_events')
      .delete()
      .filter('meta->>commit_sha', 'eq', sha)
      .filter('meta->>chunk_d_e2e_test', 'eq', 'true')
    // also clean smoke_preview rows we injected
    await db
      .from('agent_events')
      .delete()
      .eq('task_type', 'deploy_gate_smoke_preview')
      .filter('meta->>commit_sha', 'eq', sha)
      .filter('meta->>chunk_d_e2e_test', 'eq', 'true')
  }
}

const CASES = [
  {
    label: 'migration branch',
    branch: 'harness/task-chunk-d-migration-verify',
    commitSha: 'bdbedd368fe32ebef8ffde64b443ffeac8e19c64',
    expectStatus: 'warning',
    expectHasMigrations: true,
  },
  {
    label: 'no-migration branch',
    branch: 'harness/task-chunk-d-nomigration-verify',
    commitSha: 'b6f12e68cd3796d206dcb90f79e41f8ac4302be0',
    expectStatus: 'success',
    expectHasMigrations: false,
  },
]

console.log('\nChunk D E2E Verify — migration detection via GitHub compare API')
console.log('─'.repeat(65))

for (const c of CASES) {
  console.log(`\n[${c.label}]`)
  console.log(`  branch:     ${c.branch}`)
  console.log(`  commit_sha: ${c.commitSha.slice(0, 12)}...`)
  console.log(`  expect:     schema_check status=${c.expectStatus}, has_migrations=${c.expectHasMigrations}`)

  const taskId = randomUUID()
  const runId = randomUUID()
  TEST_ROWS.push(c.commitSha)

  // 1. Fire trigger
  let triggerRes
  try {
    triggerRes = await fireTrigger(c.branch, c.commitSha, taskId, runId)
    if (triggerRes.status === 200 && triggerRes.body?.ok) {
      pass('trigger endpoint', `event_id: ${triggerRes.body.event_id ?? '?'}`)
    } else {
      fail('trigger endpoint', `status=${triggerRes.status} body=${JSON.stringify(triggerRes.body).slice(0, 100)}`)
      continue
    }
  } catch (e) {
    fail('trigger endpoint', e.message)
    continue
  }

  // 2. Inject smoke_preview:success (activates smokePassedShas shortcut)
  try {
    await injectSmokePassed(c.commitSha)
    pass('smoke_preview inject', 'shortcut row written')
  } catch (e) {
    fail('smoke_preview inject', e.message)
    continue
  }

  await sleep(500)

  // 3. Fire runner
  let runnerRes
  try {
    runnerRes = await fireRunner()
    if (runnerRes.status === 200 && runnerRes.body?.ok) {
      pass('runner fired', `processed=${runnerRes.body.processed ?? '?'} results=${JSON.stringify(runnerRes.body.results ?? [])}`)
    } else {
      fail('runner fired', `status=${runnerRes.status} body=${JSON.stringify(runnerRes.body).slice(0, 200)}`)
      continue
    }
  } catch (e) {
    fail('runner fired', e.message)
    continue
  }

  // 4. Poll for schema_check row
  const row = await pollSchemaCheck(c.commitSha, 12_000)
  if (!row) {
    fail('schema_check row found', 'not found within 12s')
    continue
  }
  pass('schema_check row found', `status=${row.status} summary="${row.output_summary}"`)

  // 5. Verify status
  if (row.status === c.expectStatus) {
    pass('schema_check status correct', `${row.status} === ${c.expectStatus}`)
  } else if (row.status === 'error') {
    fail('schema_check status', `got error (GITHUB_TOKEN missing or API unreachable) — expected ${c.expectStatus}`)
  } else {
    fail('schema_check status', `got ${row.status} expected ${c.expectStatus}`)
  }

  // 6. Verify has_migrations in meta
  const meta = row.meta ?? {}
  if (row.status !== 'error') {
    const hasMig = meta.has_migrations === c.expectHasMigrations
    if (hasMig) {
      pass('has_migrations correct', `${meta.has_migrations} === ${c.expectHasMigrations}`)
    } else {
      fail('has_migrations', `got ${meta.has_migrations} expected ${c.expectHasMigrations}`)
    }
    if (c.expectHasMigrations && Array.isArray(meta.migration_files)) {
      pass('migration_files present', meta.migration_files.join(', '))
    }
  }
}

// Cleanup injected rows
console.log('\n[cleanup]')
try {
  await cleanupTestRows(CASES.map((c) => c.commitSha))
  pass('cleanup', 'injected test rows removed')
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
process.exit(allPass ? 0 : 1)
