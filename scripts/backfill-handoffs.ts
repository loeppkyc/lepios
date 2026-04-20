/**
 * backfill-handoffs.ts — seed session_handoffs table from existing Markdown handoff docs
 * and insert the Step 1 (RAG wiring) close-out record.
 *
 * Source docs:
 *   docs/session-handoff-2026-04-18.md       → Sprint 2 (betting tile)
 *   docs/session-handoff-2026-04-18-night.md → Sprint 3 (PageProfit / scan)
 *
 * Skipped (operational logs, not session handoffs):
 *   docs/handoffs/auto-proceed-log.md    → coordinator decision log
 *   docs/handoffs/cost-log.md            → token cost ledger
 *   docs/handoffs/principle-evolution.md → principle change log
 *
 * Run from project root:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-handoffs.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local before any Supabase calls
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

import { saveHandoff } from '../lib/handoffs/client'
import type { SessionHandoff } from '../lib/handoffs/types'

// ── Handoff records ───────────────────────────────────────────────────────────

const HANDOFFS: SessionHandoff[] = [
  // ── Sprint 2: Betting tile ───────────────────────────────────────────────
  {
    schema_version: 1,
    session_id: '2026-04-18-sprint2-betting-tile',
    occurred_at: '2026-04-18T00:00:00Z',
    goal: 'Ship Sprint 2 betting tile with Kelly criterion, win probability, and settle flow',
    status: 'completed',
    sprint: 2,
    decisions: [
      {
        decision: 'Insert Chunk 3.5 ("Today\'s Games") before Chunk 4 (Trading tile)',
        rationale: 'First real use surfaced UX gap — user can\'t see the day\'s slate to know what to bet on',
        reversible: true,
      },
      {
        decision: 'win_prob_pct stored at log time; overridable PnL auto-calc in settle form',
        rationale: 'Kelly rec is only useful if win_prob is captured when the user has conviction',
        reversible: false,
        affected_files: ['app/api/bets/route.ts', 'components/cockpit/money/LogBetForm.tsx'],
      },
      {
        decision: 'Historical Streamlit bets NOT trusted for rolling ROI signals',
        rationale: 'Data integrity unknown; CLAUDE.md §6 preference + BACKLOG-1 audit before any merge',
        reversible: true,
        affected_files: ['CLAUDE.md'],
      },
    ],
    completed: [
      { task: 'lib/kelly.ts: americanToImpliedProb(), kellyPct()', verified: true },
      { task: 'lib/schemas/bet.ts: BetInsertSchema, BetQuerySchema, BetSettleSchema', verified: true },
      { task: 'lib/betting-signals.ts: rollingRoiSignal(), SIGNAL_WINDOW=30', verified: true },
      { task: 'app/api/bets/route.ts: GET + POST', verified: true },
      { task: 'app/api/bets/[id]/route.ts: PATCH settle', verified: true },
      { task: 'migration 0003_add_win_prob_pct_to_bets applied live', verified: true },
      { task: 'LogBetForm + SettleBetForm + BettingTileClient UI', verified: true },
      { task: 'Deployed to lepios-one.vercel.app via vercel deploy --prod', verified: true, artifact: 'lepios-one.vercel.app' },
    ],
    deferred: [
      {
        task: 'Chunk 3.5 — "Today\'s Games" schedule display in betting tile',
        rationale: 'Discovered at first use; needs sports API port from Streamlit OS',
        sprint_gate: 'Sprint 3',
        blocking: false,
      },
      {
        task: 'BACKLOG-1: Audit historical Streamlit bets for data integrity',
        rationale: 'Cannot trust legacy data without audit; exclude from rolling signals until resolved',
        blocking: false,
      },
    ],
    unresolved: [
      {
        issue: 'BACKLOG-3: No GitHub remote for LepiOS — Vercel git integration not wired',
        impact: 'low',
        suggested_action: '10-minute setup: gh repo create + vercel link',
      },
    ],
    architectural_changes: [
      {
        change: 'Kelly criterion + rolling ROI signal layer added to money domain',
        files_affected: ['lib/kelly.ts', 'lib/betting-signals.ts'],
      },
    ],
    next_steps: [
      { action: 'Diagnose sports API in Streamlit OS (grep for odds_api, ESPN, etc.)', priority: 'p0' },
      { action: 'Scope and ship Chunk 3.5 — Today\'s Games', priority: 'p0', prerequisite: 'sports API diagnosis' },
      { action: 'Ship Chunk 4 — Trading tile', priority: 'p1', prerequisite: 'Chunk 3.5 complete' },
    ],
    score: {
      in_scope: 100,
      notes: 'All Sprint 2 chunks shipped and deployed',
      deferred_items: [
        { item: 'Chunk 3.5 Today\'s Games', rationale: 'Discovered at first use, not in original scope' },
      ],
    },
  },

  // ── Sprint 3: PageProfit / scan ──────────────────────────────────────────
  {
    schema_version: 1,
    session_id: '2026-04-18-sprint3-pageprofit',
    occurred_at: '2026-04-18T20:00:00Z',
    goal: 'Ship PageProfit ISBN scanner (Chunks A–C.5): SP-API → Keepa velocity → eBay comps → BSR sparkline',
    status: 'partial',
    sprint: 3,
    decisions: [
      {
        decision: 'BSR sparkline on-demand only (tap-to-load), 6h Supabase cache',
        rationale: 'Keepa tokens are expensive; cache prevents re-fetch on every scan of same ASIN',
        reversible: false,
        affected_files: ['app/api/scan/route.ts', 'supabase/migrations/0008_add_keepa_history_cache.sql'],
      },
      {
        decision: 'Buyback (Chunk D) deferred — no active buyback outlet',
        rationale: 'Hard rule: no work without active buyback relationship + Colin approval',
        reversible: true,
      },
      {
        decision: 'Hit List (Chunk E.1) requires acceptance doc review before build',
        rationale: 'Acceptance doc written; Colin must approve before code starts',
        reversible: true,
        affected_files: ['docs/sprint-3/chunk-e1-acceptance.md'],
      },
    ],
    completed: [
      { task: 'Chunk A: ISBN → ASIN lookup via SP-API (Amazon CA)', verified: true },
      { task: 'Chunk B: Keepa velocity — avg_rank_90d, rank_drops_30, velocity badge', verified: true },
      { task: 'Chunk C: eBay sold listings (3 comps, median price, margin)', verified: true },
      { task: 'Chunk C.5: BSR sparkline (tap-to-load, 6h cache)', verified: true, artifact: 'lepios-one.vercel.app/scan' },
      { task: 'migration 0008_add_keepa_history_cache applied live', verified: true },
      { task: 'All chunks committed and deployed to Vercel', verified: true },
    ],
    deferred: [
      {
        task: 'BACKLOG-6: Buyback pricing (Chunk D)',
        rationale: 'No active buyback outlet — hard rule: no build without active relationship + Colin approval',
        sprint_gate: 'Post-Sprint 3 (contingent on buyback partner)',
        blocking: false,
      },
      {
        task: 'Chunk E.1: Hit List create + populate',
        rationale: 'Acceptance doc written; awaiting Colin approval before build',
        blocking: true,
      },
    ],
    unresolved: [
      {
        issue: 'BACKLOG-5: React #418 hydration mismatch on /scan (hard refresh)',
        impact: 'low',
        suggested_action: 'Test in clean incognito — if gone, close. If persists, investigate.',
      },
      {
        issue: 'Chunk E.1 open questions: nav label ("Hit Lists" or shorter?), person_handle DEFAULT consistency',
        impact: 'medium',
        suggested_action: 'Colin confirms both before E.1 build starts',
      },
    ],
    architectural_changes: [
      {
        change: 'keepa_history_cache table added for BSR sparkline data with 6h TTL',
        files_affected: ['supabase/migrations/0008_add_keepa_history_cache.sql'],
        migration: '0008_add_keepa_history_cache',
      },
    ],
    next_steps: [
      { action: 'Colin reviews and approves chunk-e1-acceptance.md', priority: 'p0' },
      { action: 'Build E.1: migration 0010 → API routes → UI → nav → tests → smoke', priority: 'p0', prerequisite: 'E.1 acceptance doc approved' },
      { action: 'Build E.2: Hit list view + manage', priority: 'p1', prerequisite: 'E.1 shipped' },
      { action: 'Test BACKLOG-5 in incognito', priority: 'p2' },
    ],
    score: {
      in_scope: 100,
      notes: 'All 4 in-scope chunks verified live with a real book scan',
      deferred_items: [
        { item: 'BACKLOG-6 Buyback (Chunk D)', rationale: 'No active buyback outlet — conditional on business relationship' },
        { item: 'BACKLOG-5 React #418', rationale: 'Cosmetic — suspected browser extension, not blocking' },
      ],
    },
  },

  // ── Sprint 4: RAG wiring + AI harness Step 1 ─────────────────────────────
  {
    schema_version: 1,
    session_id: '2026-04-19-sprint4-rag-wiring',
    occurred_at: '2026-04-19T00:00:00Z',
    goal: 'Wire RAG memory layer into LepiOS — knowledge store, nightly learn, event logging, FTS retrieval (Step 1 of autonomous AI harness)',
    status: 'completed',
    sprint: 4,
    decisions: [
      {
        decision: 'Postgres FTS (tsvector GENERATED ALWAYS AS STORED) for v1; pgvector deferred to Step 5',
        rationale: 'ChromaDB (Python) can\'t run on Vercel serverless. Postgres FTS is standard, runs identically on self-hosted 24TB server. pgvector migration is additive.',
        reversible: true,
        affected_files: ['supabase/migrations/0011_add_knowledge_store.sql', 'lib/knowledge/client.ts'],
      },
      {
        decision: 'OR-mode websearch FTS (top-5 words joined with " or ")',
        rationale: 'AND-mode failed for multi-word queries like "agents propose Colin decides authority" — any matching word is better than zero results',
        reversible: false,
        affected_files: ['lib/knowledge/client.ts'],
      },
      {
        decision: 'Service-role Supabase client for all background knowledge ops (bypasses RLS)',
        rationale: 'Nightly learn and logEvent are system operations, not user-initiated — no RLS needed',
        reversible: true,
        affected_files: ['lib/knowledge/client.ts'],
      },
      {
        decision: 'Atomic confidence adjustment via SECURITY DEFINER Postgres RPCs',
        rationale: 'Supabase JS SDK can\'t do UPDATE SET confidence = confidence + 0.05 safely; RPC avoids read-modify-write race',
        reversible: false,
        affected_files: ['supabase/migrations/0011_add_knowledge_store.sql'],
      },
      {
        decision: 'CRON_SECRET guards /api/knowledge/nightly; Vercel Cron runs at 06:00 UTC daily',
        rationale: 'Route must be public for Vercel Cron but locked to prevent arbitrary triggering',
        reversible: true,
        affected_files: ['app/api/knowledge/nightly/route.ts', 'vercel.json', '.env.local'],
      },
    ],
    completed: [
      { task: 'migration 0011_add_knowledge_store: knowledge + daily_metrics tables, 2 RPCs', verified: true, artifact: 'supabase/migrations/0011_add_knowledge_store.sql' },
      { task: 'lib/knowledge/types.ts: KnowledgeCategory (9 values), all interfaces', verified: true },
      { task: 'lib/knowledge/client.ts: logEvent, logError, logSuccess, saveKnowledge, findKnowledge (OR-mode FTS), retrieveContext, markUsed', verified: true },
      { task: 'lib/knowledge/patterns.ts: nightlyLearn, 6 analyzers, consolidateKnowledge, decayStaleKnowledge', verified: true },
      { task: 'app/api/knowledge/nightly/route.ts: CRON_SECRET-guarded POST + GET', verified: true },
      { task: 'app/api/scan/route.ts: replaced 3 direct agent_events inserts with logEvent/logError', verified: true },
      { task: 'app/api/bets/route.ts: logEvent/logError on bet.create', verified: true },
      { task: 'app/api/hit-lists/route.ts: logEvent/logError on hit-list.create', verified: true },
      { task: 'app/api/hit-lists/[id]/items/route.ts: logEvent on add-items', verified: true },
      { task: 'vercel.json: Vercel Cron at 06:00 UTC', verified: true, artifact: 'vercel.json' },
      { task: 'CRON_SECRET set in .env.local and Vercel preview/prod env vars', verified: true },
      { task: 'scripts/verify-rag.ts: all 4/4 checks pass (3 retrieveContext + 1 findKnowledge)', verified: true },
    ],
    deferred: [
      {
        task: 'Step 5: Port Ollama to LepiOS TypeScript + pgvector semantic search',
        rationale: 'Ollama runs locally; porting to Next.js is non-trivial. FTS is good enough for v1.',
        sprint_gate: 'SPRINT5-GATE',
        blocking: false,
      },
    ],
    unresolved: [
      {
        issue: 'BACKLOG-2: pre-commit hook requires ANTHROPIC_API_KEY — not in CI, not documented for new dev setup',
        impact: 'medium',
        suggested_action: 'Document bypass in CLAUDE.md: SKIP_AI_REVIEW=1 git commit --no-verify',
      },
      {
        issue: 'BACKLOG-3: No GitHub remote for LepiOS',
        impact: 'low',
        suggested_action: 'gh repo create lepios --private + vercel link',
      },
    ],
    architectural_changes: [
      {
        change: 'knowledge store (agent_events + knowledge + daily_metrics) added as central memory layer',
        files_affected: ['supabase/migrations/0011_add_knowledge_store.sql', 'lib/knowledge/'],
        migration: '0011_add_knowledge_store',
      },
      {
        change: 'Vercel Cron wired to /api/knowledge/nightly at 06:00 UTC',
        files_affected: ['vercel.json', 'app/api/knowledge/nightly/route.ts'],
      },
    ],
    next_steps: [
      { action: 'Step 2: machine-readable session handoff format (session_handoffs table + client)', priority: 'p0' },
      { action: 'Step 3: Safety agent scaffold with Zod + rule-based checks', priority: 'p1', prerequisite: 'Step 2 complete' },
      { action: 'Step 4: Scoring dashboard surfacing daily_metrics to Telegram digest', priority: 'p1', prerequisite: 'Step 3 complete' },
    ],
    score: {
      in_scope: 100,
      notes: 'All 5 close-out items complete; verify-rag 4/4 passes confirmed',
      deferred_items: [
        { item: 'Step 5 Ollama + pgvector', rationale: 'SPRINT5-GATE: intentionally deferred, forward hook (embedding_id column) in place' },
      ],
    },
  },
]

// ── Backfill runner ───────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — session handoff backfill')
  console.log('='.repeat(60))

  let allPassed = true

  for (const handoff of HANDOFFS) {
    const id = await saveHandoff(handoff, { upsert: true })
    if (!id) {
      console.error(`❌ FAIL: could not save handoff "${handoff.session_id}"`)
      allPassed = false
    } else {
      console.log(`✓ ${handoff.session_id} → ${id}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(allPassed ? '✓ ALL HANDOFFS SAVED' : '❌ SOME HANDOFFS FAILED')
  console.log('='.repeat(60))
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error('Script error:', e)
  process.exit(1)
})
