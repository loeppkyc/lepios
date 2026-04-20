/**
 * verify-safety.ts — retroactive safety check against Steps 1–4 + scripts/.
 *
 * Runs runSafetyChecks (without network logging) against the actual
 * file content from Steps 1–4 and the scripts/ directory. Classifies
 * every fired check as:
 *   REAL   — a genuine issue or intentional tradeoff worth noting
 *   FP     — false positive (rule too aggressive for this pattern)
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-safety.ts
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const val = trimmed.slice(eqIdx + 1)
  if (key && !(key in process.env)) process.env[key] = val
}

import { runSafetyChecks } from '../lib/safety/checker'
import type { SafetyCheckInput } from '../lib/safety/types'

// ── File content loader ───────────────────────────────────────────────────────

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8')
}

// ── Step 1 input ──────────────────────────────────────────────────────────────

const STEP1_INPUT: SafetyCheckInput = {
  scopeDescription: 'Wire RAG memory layer into LepiOS — knowledge store, nightly learn, event logging, FTS retrieval',
  migrations: [
    {
      name: '0011_add_knowledge_store',
      sql: read('supabase/migrations/0011_add_knowledge_store.sql'),
      hasRollback: false,
    },
  ],
  fileChanges: [
    { path: 'lib/knowledge/types.ts',    diff: read('lib/knowledge/types.ts'),    isNew: true },
    { path: 'lib/knowledge/client.ts',   diff: read('lib/knowledge/client.ts'),   isNew: true },
    { path: 'lib/knowledge/patterns.ts', diff: read('lib/knowledge/patterns.ts'), isNew: true },
    { path: 'app/api/knowledge/nightly/route.ts', diff: read('app/api/knowledge/nightly/route.ts'), isNew: true },
    { path: 'app/api/scan/route.ts',        diff: read('app/api/scan/route.ts'),        isNew: false },
    { path: 'app/api/bets/route.ts',        diff: read('app/api/bets/route.ts'),        isNew: false },
    { path: 'app/api/hit-lists/route.ts',   diff: read('app/api/hit-lists/route.ts'),   isNew: false },
    {
      path: 'app/api/hit-lists/[id]/items/route.ts',
      diff: read('app/api/hit-lists/[id]/items/route.ts'),
      isNew: false,
    },
    { path: 'vercel.json', diff: read('vercel.json'), isNew: true },
  ],
  newApiRoutes: ['app/api/knowledge/nightly/route.ts'],
  declaredScope: [
    'lib/knowledge/',
    'app/api/knowledge/',
    'app/api/scan/',
    'app/api/bets/',
    'app/api/hit-lists/',
    'supabase/migrations/',
    'vercel.json',
    'scripts/',
  ],
}

// ── Step 2 input ──────────────────────────────────────────────────────────────

const STEP2_INPUT: SafetyCheckInput = {
  scopeDescription: 'Machine-readable session handoff format — session_handoffs table, types, client, backfill',
  migrations: [
    {
      name: '0012_add_session_handoffs',
      sql: read('supabase/migrations/0012_add_session_handoffs.sql'),
      hasRollback: false,
    },
  ],
  fileChanges: [
    { path: 'lib/handoffs/types.ts',   diff: read('lib/handoffs/types.ts'),   isNew: true },
    { path: 'lib/handoffs/client.ts',  diff: read('lib/handoffs/client.ts'),  isNew: true },
    { path: 'scripts/backfill-handoffs.ts', diff: read('scripts/backfill-handoffs.ts'), isNew: true },
  ],
  newApiRoutes: [],
  declaredScope: [
    'lib/handoffs/',
    'supabase/migrations/',
    'scripts/',
  ],
}

// ── Step 3 input — Scripts secret sweep ──────────────────────────────────────

// Scan every .ts and .mjs file in scripts/ for secret leaks.
// Scripts are not new lib/ or API routes, so only secret_leak applies.
// declaredScope is empty so scope_creep won't fire; newApiRoutes empty so Zod won't fire.
function buildScriptsInput(): SafetyCheckInput {
  const scriptsDir = resolve(process.cwd(), 'scripts')
  const files = readdirSync(scriptsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'))
  return {
    scopeDescription: 'Full scripts/ directory — secret leak scan only',
    fileChanges: files.map((f) => ({
      path: join('scripts', f),
      diff: readFileSync(join(scriptsDir, f), 'utf-8'),
      isNew: false,
    })),
    migrations: [],
    newApiRoutes: [],
    declaredScope: [],
  }
}

// ── Known-real vs false-positive classification ───────────────────────────────

// Checks we expect to fire, classified by judgement
const EXPECTED: Record<string, { type: 'real' | 'fp'; verdict: string }> = {
  // Step 1 — remaining acknowledged gaps after cleanup pass
  'missing_test_knowledge_patterns':  { type: 'real', verdict: 'Acknowledged gap: nightly learn analyzers need Supabase mocking — deferred' },
  'missing_test_knowledge_nightly_api': { type: 'real', verdict: 'Acknowledged gap: cron route has no body input, low test value — deferred' },
}

// ── Runner ────────────────────────────────────────────────────────────────────

function printReport(stepLabel: string, input: SafetyCheckInput) {
  // Use current known tests — update when new test files are added to tests/
  const knownTests = new Set([
    'bets-api', 'betting-tile', 'bsr-history', 'calculator',
    'ebay-fees', 'ebay-listings', 'hit-lists', 'isbn',
    'keepa-product', 'kelly', 'safety-checker',
    // Added in cleanup pass (post-Step 3)
    'knowledge-client',   // tests/knowledge-client.test.ts
    'handoffs-client',    // tests/handoffs-client.test.ts
    // Added in Step 4
    'metrics-rollups',    // tests/metrics-rollups.test.ts
    // Types-only modules — no runtime logic, no test needed
    'knowledge-types',
    'handoffs-types',
    // Remaining acknowledged gaps (medium severity, acceptable):
    // 'knowledge-patterns' — nightly learn analyzers, Supabase mocking deferred
    // 'knowledge-nightly-api' — cron route, no body input to test
  ])
  const report = runSafetyChecks(input, knownTests)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${stepLabel}`)
  console.log(`  Files: ${report.metadata.files_changed} | Migrations: ${report.metadata.migrations_proposed} | Routes: ${report.metadata.routes_proposed}`)
  console.log(`  Checks fired: ${report.checks.length} | passed: ${report.passed} | blocking: ${report.blocking}`)
  console.log('─'.repeat(60))

  if (report.checks.length === 0) {
    console.log('  ✓ Clean — no checks fired')
    return
  }

  let realCount = 0
  let fpCount = 0
  let unknownCount = 0

  for (const c of report.checks) {
    const classification = EXPECTED[c.id]
    const tag = classification
      ? classification.type === 'real' ? '[REAL]' : '[FP]  '
      : '[?]   '

    if (classification?.type === 'real') realCount++
    else if (classification?.type === 'fp') fpCount++
    else unknownCount++

    console.log(`  ${tag} [${c.severity.toUpperCase()}] ${c.category} — ${c.id}`)
    console.log(`         ${c.message}`)
    if (classification) {
      console.log(`         Verdict: ${classification.verdict}`)
    } else {
      console.log(`         Verdict: UNCLASSIFIED — review manually`)
    }
  }

  console.log(`\n  Summary: ${realCount} real, ${fpCount} false positive, ${unknownCount} unclassified`)
}

function main() {
  console.log('='.repeat(60))
  console.log('LepiOS Safety Checker — full sweep: Steps 1–4 + scripts/')
  console.log('='.repeat(60))

  printReport('STEP 1 — RAG Wiring (migration 0011 + knowledge layer)', STEP1_INPUT)
  printReport('STEP 2 — Session Handoffs (migration 0012 + handoffs layer)', STEP2_INPUT)
  printReport('STEP 3+4 — scripts/ secret leak sweep', buildScriptsInput())

  console.log('\n' + '='.repeat(60))
  console.log('Full sweep complete')
  console.log('='.repeat(60))
}

main()
