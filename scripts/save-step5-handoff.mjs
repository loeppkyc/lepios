/**
 * One-shot script: persist the Step 5 handoff and verify retrieval.
 * Run: node scripts/save-step5-handoff.mjs
 *
 * Requires env vars (from .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local if present (mirrors the pattern in verify-safety.ts)
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
} catch { /* .env.local not present — rely on shell env */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
if (!serviceKey)  throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(supabaseUrl, serviceKey)

const handoff = {
  schema_version: 1,
  session_id: '2026-04-19-step4-to-step5',
  occurred_at: new Date().toISOString(),
  goal: 'Step 5: Ollama TypeScript client + pgvector semantic search',
  status: 'completed',
  sprint: 4,
  decisions: [
    {
      decision: 'Ollama runs locally; LepiOS reaches it via the existing Cloudflare tunnel',
      rationale: 'No new service needed — tunnel is already in place for self-hosted infra',
      reversible: true,
    },
    {
      decision: 'Deployment strategy: local-first, production-ready via tunnel; 24TB server migration is a config change later',
      rationale: 'Avoids premature infra work; single env var swap migrates to 24TB server when ready',
      reversible: true,
    },
    {
      decision: 'pgvector extension to be added to Supabase (standard Postgres, self-host ready)',
      rationale: 'Supabase supports pgvector natively; same schema works on self-hosted Postgres',
      reversible: false,
    },
    {
      decision: 'Claude API stays as escalation fallback when Ollama confidence is low',
      rationale: 'Mirrors the uncertainty-detection pattern already in Streamlit local_ai.py; best of both',
      reversible: true,
    },
  ],
  completed: [
    { task: 'lib/metrics/rollups.ts (5 rollup functions)', artifact: 'lib/metrics/rollups.ts', verified: true },
    { task: 'app/(dashboard)/autonomous/page.tsx with inline SVG charts', artifact: 'app/(dashboard)/autonomous/page.tsx', verified: true },
    { task: 'app/api/metrics/digest/route.ts + Vercel cron at 13:00 UTC', artifact: 'app/api/metrics/digest/route.ts', verified: true },
    { task: 'tests/metrics-rollups.test.ts (24 tests, 219/219 total passing)', artifact: 'tests/metrics-rollups.test.ts', verified: true },
    { task: 'CockpitNav updated with /autonomous link', artifact: 'app/(cockpit)/_components/CockpitNav.tsx', verified: true },
    { task: 'Digest live-tested: 142 chars, 19 events, 63% success rate from real Supabase data', verified: true },
  ],
  deferred: [
    {
      task: 'Production deploy to Vercel',
      rationale: 'Not explicitly requested this session',
      blocking: false,
    },
    {
      task: 'Fill TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in production env',
      rationale: 'Digest runs log-only until credentials are populated',
      blocking: false,
    },
    {
      task: 'Port Ollama to LepiOS TypeScript with pgvector semantic search',
      rationale: 'Planned as Step 5; unblocks SPRINT5-GATE markers throughout Steps 1–4',
      sprint_gate: 'SPRINT5-GATE',
      blocking: false,
    },
  ],
  unresolved: [
    {
      issue: 'Missing test: knowledge-patterns (lib/knowledge/patterns.ts)',
      impact: 'medium',
      suggested_action: 'Write tests in new session before Step 5 ships, or acknowledge as acceptable gap',
    },
    {
      issue: 'Missing test: knowledge-nightly-api (app/api/knowledge/nightly/route.ts)',
      impact: 'medium',
      suggested_action: 'Integration test or manual smoke test acceptable given cron-only invocation',
    },
  ],
  architectural_changes: [
    {
      change: 'Added session_handoffs table (migration 0012)',
      files_affected: ['supabase/migrations/0012_add_session_handoffs.sql'],
    },
    {
      change: 'Added knowledge + agent_events tables (migration 0011)',
      files_affected: ['supabase/migrations/0011_add_knowledge_store.sql'],
    },
    {
      change: 'Added scoring/observability layer: rollups + dashboard + digest cron',
      files_affected: [
        'lib/metrics/rollups.ts',
        'app/(dashboard)/autonomous/page.tsx',
        'app/api/metrics/digest/route.ts',
        'vercel.json',
      ],
    },
  ],
  next_steps: [
    {
      action: 'Begin Step 5 in a fresh Claude Code session using this handoff as context',
      priority: 'p0',
    },
    {
      action: 'Run: formatHandoffsForPrompt(await getRecentHandoffs(1)) at session start to inject context',
      priority: 'p0',
    },
    {
      action: 'Add pgvector extension to Supabase and migration for embedding_id column on knowledge table',
      priority: 'p1',
      prerequisite: 'Step 5 session started',
    },
    {
      action: 'Create lib/ollama/client.ts with generate(), embed(), healthCheck(), autoSelectModel()',
      priority: 'p1',
      prerequisite: 'pgvector migration applied',
    },
    {
      action: 'Fill Telegram credentials in production Vercel env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)',
      priority: 'p2',
    },
  ],
  score: {
    in_scope: 100,
    notes: '219/219 tests passing. Digest live-tested against real Supabase data. 0 TypeScript errors.',
    deferred_items: [
      { item: 'Production deploy', rationale: 'Not requested this session' },
      { item: 'Telegram credentials', rationale: 'Env var setup, not a code task' },
    ],
  },
}

async function main() {
  // ── Save ──────────────────────────────────────────────────────────────────
  const row = {
    session_id: handoff.session_id,
    schema_version: handoff.schema_version,
    occurred_at: handoff.occurred_at,
    goal: handoff.goal,
    status: handoff.status,
    sprint: handoff.sprint,
    payload: handoff,
  }

  const { data: insertData, error: insertError } = await supabase
    .from('session_handoffs')
    .insert(row)
    .select('id')
    .single()

  if (insertError) {
    console.error('SAVE FAILED:', insertError.message)
    process.exit(1)
  }
  console.log('Saved handoff — id:', insertData.id)

  // ── Verify retrieval ──────────────────────────────────────────────────────
  const { data: rows, error: fetchError } = await supabase
    .from('session_handoffs')
    .select('payload')
    .order('occurred_at', { ascending: false })
    .limit(1)

  if (fetchError || !rows?.length) {
    console.error('RETRIEVAL FAILED:', fetchError?.message ?? 'empty result')
    process.exit(1)
  }

  const retrieved = rows[0].payload
  console.log('\nRetrieved handoff:')
  console.log('  session_id :', retrieved.session_id)
  console.log('  goal       :', retrieved.goal)
  console.log('  status     :', retrieved.status)
  console.log('  decisions  :', retrieved.decisions.length)
  console.log('  next_steps :', retrieved.next_steps.length)
  console.log('  score      :', retrieved.score?.in_scope, '/ 100')

  const goalMatch = retrieved.goal === handoff.goal
  const decisionMatch = retrieved.decisions.length === handoff.decisions.length
  console.log('\nVerification:', goalMatch && decisionMatch ? 'PASS ✓' : 'FAIL ✗')
}

main().catch((e) => { console.error(e); process.exit(1) })
