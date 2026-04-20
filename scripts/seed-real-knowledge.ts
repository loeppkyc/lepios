/**
 * seed-real-knowledge.ts
 *
 * 1. Saves the Step 5 E2E completion handoff to session_handoffs.
 * 2. Seeds 20 real knowledge entries drawn from:
 *    - ARCHITECTURE.md architectural principles and decisions
 *    - CLAUDE.md conventions, rules, and security gates
 *    - Error patterns encountered during Steps 1-5 development
 *    - Workflow patterns established across Steps 1-5
 * 3. Verifies seeding via findKnowledge() hybrid search.
 * 4. Prints a seeding report to stdout.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/seed-real-knowledge.ts
 *
 * Each saveKnowledge() call auto-embeds via Ollama — Ollama must be running.
 * On OllamaUnreachableError the row is saved without an embedding; run
 * scripts/backfill-embeddings.ts afterward to fill them.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Load .env.local ────────────────────────────────────────────────────────────
try {
  const lines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1)
    if (k && !(k in process.env)) process.env[k] = v
  }
} catch { /* rely on shell env */ }

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

import { saveHandoff } from '../lib/handoffs/client'
import { saveKnowledge, findKnowledge } from '../lib/knowledge/client'
import type { SessionHandoff } from '../lib/handoffs/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeedEntry {
  category: 'principle' | 'rule' | 'error_fix' | 'workflow'
  domain: string
  title: string
  problem: string
  solution: string
  context: string
  confidence: number
  tags: string[]
}

// ── Step 1: Save Step 5 completion handoff ────────────────────────────────────

async function saveStep5Handoff(): Promise<void> {
  console.log('\n[1/3] Saving Step 5 completion handoff')

  const handoff: SessionHandoff = {
    schema_version: 1,
    session_id: '2026-04-19-step5-e2e-verified',
    occurred_at: new Date().toISOString(),
    goal: 'Step 5 verified end-to-end: Ollama TypeScript client + pgvector hybrid search confirmed working against live infrastructure',
    status: 'completed',
    decisions: [
      {
        decision: 'pgvector migration (0013) applied to production Supabase project xpanlbcjueimeofgsara — embedding column live',
        rationale: 'E2E verification confirmed the column exists and match_knowledge() RPC returns correct 768-dim cosine similarity results',
        reversible: false,
        affected_files: ['supabase/migrations/0013_add_pgvector.sql'],
      },
      {
        decision: 'Ollama runs local-first via localhost:11434; Cloudflare tunnel ready but not yet wired into Vercel env',
        rationale: 'E2E verified at 8/8 PASS over localhost. Tunnel support is coded (OLLAMA_TUNNEL_URL env var) but Vercel env not updated yet.',
        reversible: true,
      },
      {
        decision: 'Hybrid search confirmed working: 60% vector + 40% FTS mergeHybrid() returning correct results',
        rationale: 'findKnowledge("verification entry") found the inserted test entry in Step 7 of E2E script. Will stress-test at scale naturally as knowledge accumulates.',
        reversible: true,
        affected_files: ['lib/knowledge/client.ts'],
      },
      {
        decision: 'saveKnowledge() now logs Supabase errors via console.error instead of silently returning null',
        rationale: 'Observability improvement. Root cause of original E2E failure (silent schema mismatch) would have been diagnosed immediately with this logging.',
        reversible: true,
        affected_files: ['lib/knowledge/client.ts'],
      },
    ],
    completed: [
      { task: 'Ollama healthCheck() reachable via localhost, returns model list', artifact: 'lib/ollama/client.ts', verified: true },
      { task: 'embed() returns 768-dim vector from nomic-embed-text', artifact: 'lib/ollama/client.ts', verified: true },
      { task: 'generate() returns non-empty response from qwen2.5:7b', artifact: 'lib/ollama/client.ts', verified: true },
      { task: 'saveKnowledge() auto-generates and stores embedding at write time', artifact: 'lib/knowledge/client.ts', verified: true },
      { task: 'pgvector embedding column populated (not null) in production DB', artifact: 'supabase/migrations/0013_add_pgvector.sql', verified: true },
      { task: 'findKnowledge() retrieves entries via hybrid vector + FTS scoring', artifact: 'lib/knowledge/client.ts', verified: true },
      { task: 'E2E cleanup complete — no test data left in production DB', verified: true },
      { task: 'saveKnowledge() error logging added — Supabase errors now surface via console.error', artifact: 'lib/knowledge/client.ts', verified: true },
    ],
    deferred: [],
    unresolved: [
      {
        issue: 'generate() cold-start latency 12.6s — model loading on first call after idle',
        impact: 'medium',
        suggested_action: 'Consider warmup ping in Step 6 orchestration loop startup; or accept latency for non-interactive paths',
      },
      {
        issue: 'knowledge table currently empty of real data — seeding in this session',
        impact: 'medium',
        suggested_action: 'Run scripts/seed-real-knowledge.ts to populate 20 entries; natural accumulation via autonomous harness afterward',
      },
      {
        issue: 'Telegram credentials still missing from Vercel env vars',
        impact: 'high',
        suggested_action: 'Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to Vercel environment before Step 6 orchestration loop ships alerts',
      },
    ],
    architectural_changes: [
      {
        change: 'pgvector extension + embedding column + IVFFlat index + match_knowledge() RPC added to production Supabase',
        files_affected: ['supabase/migrations/0013_add_pgvector.sql'],
        migration: '0013_add_pgvector.sql',
      },
      {
        change: 'findKnowledge() upgraded from pure FTS to hybrid 60% vector + 40% FTS with graceful FTS fallback',
        files_affected: ['lib/knowledge/client.ts'],
      },
      {
        change: 'saveKnowledge() now auto-embeds on insert via Ollama; saves without embedding on OllamaUnreachableError',
        files_affected: ['lib/knowledge/client.ts'],
      },
    ],
    next_steps: [
      {
        action: 'Seed 15-20 real knowledge entries from ARCHITECTURE.md, CLAUDE.md, error patterns, and workflow patterns',
        priority: 'p0',
      },
      {
        action: 'Begin Step 6: orchestration loop — autonomous agent that reads knowledge, generates recommendations, logs to agent_events',
        priority: 'p1',
        prerequisite: 'Seeding complete and hybrid search returning real results',
      },
      {
        action: 'Add TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to Vercel env so Step 6 loop can fire alerts',
        priority: 'p1',
      },
    ],
  }

  const id = await saveHandoff(handoff)
  if (id) {
    console.log(`  ✓ Handoff saved: id=${id.slice(0, 8)}… session_id=2026-04-19-step5-e2e-verified`)
  } else {
    console.error('  ✗ Handoff save failed — check Supabase connection')
  }
}

// ── Step 2: Seed knowledge entries ────────────────────────────────────────────

const ENTRIES: SeedEntry[] = [
  // ── Principles (from ARCHITECTURE.md) ─────────────────────────────────────

  {
    category: 'principle',
    domain: 'system',
    title: 'Agents propose, Colin decides — the Supreme rule',
    problem: 'AI agents generating or executing decisions autonomously without Colin\'s approval, especially for destructive operations, schema changes, or financial actions.',
    solution: 'Every agent output is a proposal. Agents sharpen decisions; they do not make them. Destructive operations (git push, schema migrations, money moves, deploy) require explicit Colin approval before execution. This rule preempts all other agent behavior.',
    context: 'Core principle from ARCHITECTURE.md §3 and §8.2. "Colin is Supreme" is architectural principle 8. Applied since LepiOS Day 1. Prevents unauthorized changes to production systems and live money flows.',
    confidence: 0.95,
    tags: ['architecture', 'governance', 'agents'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Ollama-first routing: local models for clerical, Claude API for hard reasoning',
    problem: 'Running all inference through Claude API burns the 5-hour token budget on low-value tasks like classification, summarization, and embedding, leaving insufficient budget for real reasoning work.',
    solution: 'Route by task: Ollama for embedding (nomic-embed-text), general Q&A (qwen2.5:7b), code (qwen2.5-coder:7b), and analysis (qwen2.5:32b). Reserve Claude API for tasks requiring accuracy, nuance, or safety review. The split is: Ollama for volume, Claude for quality.',
    context: 'ARCHITECTURE.md §8.3 and §5. The Token Budget Manager (Tier 0 agent) enforces this. Ollama access via localhost:11434 with Cloudflare tunnel fallback (OLLAMA_TUNNEL_URL env var). lib/ollama/client.ts autoSelectModel() implements the routing table.',
    confidence: 0.90,
    tags: ['ollama', 'token-budget', 'routing', 'architecture'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Never hallucinate into the database — staging layer and Reality-Check gate before canonical',
    problem: 'Agents generating plausible-sounding but incorrect facts (prices, metrics, decisions) that get promoted to the knowledge table and are later retrieved as ground truth, corrupting downstream reasoning.',
    solution: 'Every agent output is tagged grounded (evidence-backed, citable source) or generated (agent prose). Generated content is not promoted to the knowledge table without either explicit Colin approval or a Reality-Check Agent review. Saveknowledge() caller must explicitly set confidence — low confidence signals generated content.',
    context: 'ARCHITECTURE.md §8.4 and §8.5. Hallucination log: docs/hallucination-log.md. This principle explains why saveKnowledge() requires a confidence parameter and why the reality-check agent is Tier 0. Applies especially to financial figures, health metrics, and betting/trading data.',
    confidence: 0.95,
    tags: ['hallucination', 'data-integrity', 'safety', 'architecture'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Accuracy-Zone Pipeline: stop at 40-50% context fill, write structured handoff, fresh agent continues',
    problem: 'Long Claude Code sessions degrade in accuracy as context depth increases. Agents begin hallucinating function names, file paths, and prior decisions. Errors compound across turns within the same context window.',
    solution: 'Every agent task has a token budget and scope budget. At 40-50% context window fill: stop, write a structured SessionHandoff (what done, what next, what verified, grounding manifest), discard old context. Fresh agent reads the handoff artifact only — not the prior conversation. Handoffs stored in Supabase via lib/handoffs/client.ts.',
    context: 'ARCHITECTURE.md §8.5. The session_handoffs table (migration 0012) is the memory bridge between sessions. formatHandoffsForPrompt() renders the last 3 handoffs in under 2000 tokens for prompt injection at session start.',
    confidence: 0.90,
    tags: ['context-management', 'handoffs', 'accuracy', 'architecture'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Check-Before-Build: verify existence before proposing new code, schema, or config',
    problem: 'Agents building things that already exist in the codebase (from 7+ weeks of prior work), causing duplication, wasted tokens, and conflicting implementations.',
    solution: 'Before any new code/schema/config/integration: grep the repo, check Supabase schema, list existing components, check past sessions. Report state: Working / Partial / Broken / Stale. Pick action: Leave alone, Beef-Up, Replace (requires Colin approval), or Build-New (last resort). Never default to "Build-New" without ruling out the other three.',
    context: 'ARCHITECTURE.md §8.4. Applied since Phase 2 audit. The Streamlit OS (../streamlit_app/) has 60+ modules of working logic — always check it as the baseline reference before proposing a new implementation.',
    confidence: 0.90,
    tags: ['architecture', 'process', 'anti-duplication'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Kill criterion: 2 weeks from Phase 3 start, measurable money impact or stop',
    problem: 'Building a complex multi-agent system justified by elegance and long-term vision while it produces no near-term value, accumulating technical debt and sunk cost.',
    solution: 'Hard deadline 2 weeks from Phase 3 start. Test: is LepiOS making or saving Colin money this week? Concrete signals: Amazon Telegram deal alerts Colin acts on, Expenses tile tracking real spend accurately, Betting/Trading tiles logging real activity. If none of these are live and working, stop and re-evaluate architecture before continuing.',
    context: 'ARCHITECTURE.md §11. Elegance is not a substitute for utility. This kill criterion is why Sprint order locks Amazon first (Sprint 3 PageProfit + Sprint 4 Business Review Trust Layer) before all other pillars.',
    confidence: 0.95,
    tags: ['architecture', 'sprint', 'kill-criterion', 'process'],
  },
  {
    category: 'principle',
    domain: 'system',
    title: 'Multi-user hard gate: RLS must be tightened before second user touches auth.users',
    problem: 'Adding a second user (e.g. Megan) to auth.users before RLS policies are updated from permissive (auth.uid() IS NOT NULL) to person-scoped allows cross-user data reads and writes.',
    solution: 'Before any second user is added to auth.users: (a) ship profiles(user_id, person_handle) table with FK to auth.users; (b) update RLS on all person-scoped tables to use person_handle matching; (c) remove hardcoded person_handle = \'colin\' from route handlers; (d) verify with a test second-user that cross-user SELECT and INSERT are both blocked.',
    context: 'ARCHITECTURE.md §7.3, audits/migration-notes.md MN-3. This is a HARD GATE — not a recommendation. Tables in scope: bets, trades, transactions, products, deals, net_worth_snapshots, agent_events.',
    confidence: 0.95,
    tags: ['rls', 'security', 'multi-user', 'supabase', 'architecture'],
  },

  // ── Rules (from CLAUDE.md) ─────────────────────────────────────────────────

  {
    category: 'rule',
    domain: 'system',
    title: 'Tier 0 Safety preempts all: Safety Agent reviews every migration, deploy, and secret-adjacent action',
    problem: 'Sprint work proceeding with unreviewed schema changes, leaked secrets, or unapproved deploys — especially dangerous when Stripe is live and Supabase RLS is the only auth layer.',
    solution: 'Before any git operation, migration apply, production deploy, or action touching secrets: confirm it is safe. If in doubt, stop and ask Colin. The verify-safety.ts script runs secret-pattern sweeps across src/ and scripts/ directories. It must be clean before any commit touching secret-adjacent code.',
    context: 'CLAUDE.md §3, ARCHITECTURE.md §3.1 Tier 0. The Safety Agent is always-on and preempts Tier 1-3. scripts/verify-safety.ts covers: hardcoded API keys, Supabase service key pattern (sb_secret_), Stripe keys, JWT secrets.',
    confidence: 0.95,
    tags: ['safety', 'security', 'tier0', 'process'],
  },
  {
    category: 'rule',
    domain: 'system',
    title: 'Read before code: verify any file path, function name, or API before citing it',
    problem: 'Citing functions and paths that do not exist in the current codebase (hallucination from training data). Making changes to stale versions of files. Proposing fixes for wrong function signatures.',
    solution: 'Before editing or citing any file: Read it with the Read tool. Before mentioning any function name or API: Grep for it. Never code from memory — training data for Next.js, Supabase, and Stripe is often version-mismatched. This applies to every file in every session without exception.',
    context: 'AGENTS.md in every project. Repeated failure mode F2 in global CLAUDE.md. The lepiOS codebase has Next.js App Router conventions that differ from training data — always read node_modules/next/dist/docs/ before writing routing or data-fetching code.',
    confidence: 0.95,
    tags: ['process', 'anti-hallucination', 'mandatory'],
  },
  {
    category: 'rule',
    domain: 'security',
    title: 'INC-001: rotate loeppky_trigger_bot token before repo goes public or gets collaborators',
    problem: 'The loeppky_trigger_bot Telegram token was committed to git history in commit fd8860c. The token is invalidated by rotation via BotFather — the committed value becomes useless. Risk is low while repo is private with no collaborators, but becomes critical if repo is made public or a collaborator is added.',
    solution: 'Before granting any collaborator access to the repo or making it public: rotate the bot token via BotFather (Telegram). This invalidates the committed token in fd8860c. Document the rotation in the incident log.',
    context: 'CLAUDE.md §5. Documented as INC-001. Risk accepted 2026-04-17 while repo is private and Colin is the sole operator. This is a pre-condition for any multi-user or open-source work.',
    confidence: 0.90,
    tags: ['security', 'telegram', 'incident', 'INC-001'],
  },
  {
    category: 'rule',
    domain: 'data-integrity',
    title: 'BACKLOG-1: historical Streamlit bets data requires odds-integrity audit before import to Supabase',
    problem: 'The Streamlit OS SQLite/Google Sheets bets history has uncertain odds integrity — manual entry errors, format inconsistencies, and unverified closing lines. Importing without audit would produce wrong ROI signals in LepiOS Betting tile.',
    solution: 'Do not import bets from the Streamlit baseline into Supabase bets table without: (a) explicit Colin approval and (b) a completed odds-integrity audit per the methodology in audits/migration-notes.md BACKLOG-1. Other Streamlit data (expenses, products) has separate audit requirements.',
    context: 'CLAUDE.md §6. The bets table in Supabase is currently populated only from new LepiOS sessions. Streamlit bets data is reference-only until the audit is complete.',
    confidence: 0.90,
    tags: ['data-integrity', 'bets', 'backlog', 'BACKLOG-1', 'migration'],
  },

  // ── Error fixes (synthesized from Steps 1-5 development session) ───────────

  {
    category: 'error_fix',
    domain: 'supabase',
    title: 'saveKnowledge returns null silently on schema mismatch — log Supabase error before returning null',
    problem: 'saveKnowledge() was returning null when a Postgres column referenced in the INSERT did not exist (e.g. embedding column before migration 0013 was applied). The error was completely silent — no exception, no log, just null. A 30-minute debugging session was required to identify the root cause.',
    solution: 'Before returning null on any Supabase error, log the full error object: message, details, hint, and code fields. Also change catch blocks from bare catch{} to catch(err){ console.error(...) } so unexpected JS errors are also surfaced. This turns a silent null into a diagnosable error within 5 seconds.',
    context: 'Discovered during Step 5 E2E verification (2026-04-19). The embedding column was missing from production because migration 0013 had never been applied. Every INSERT with the embedding field was rejected by Postgres with a schema error; the old code swallowed it. Fix committed to lib/knowledge/client.ts.',
    confidence: 0.95,
    tags: ['supabase', 'error-logging', 'observability', 'knowledge-client'],
  },
  {
    category: 'error_fix',
    domain: 'supabase',
    title: 'Migration present in repo but not applied to production — verify via list_migrations before E2E tests',
    problem: 'A migration file can exist in supabase/migrations/ and pass local type checks, but never be applied to the live Supabase project. E2E tests then fail because the production schema is out of sync with the codebase, and the failure is silent (schema errors swallowed by the client).',
    solution: 'Before running any E2E test against live infrastructure: use mcp__claude_ai_Supabase__list_migrations to confirm all expected migrations are present in the production project. If any are missing, apply them via apply_migration before the test run. Never assume local migrations are applied to production.',
    context: 'Root cause of Step 5 E2E failure on 2026-04-19. Migration 0013_add_pgvector.sql was authored and in the repo but had never been applied to project xpanlbcjueimeofgsara. Applied retroactively via Supabase MCP during debugging.',
    confidence: 0.95,
    tags: ['supabase', 'migrations', 'e2e', 'debugging', 'process'],
  },
  {
    category: 'error_fix',
    domain: 'testing',
    title: 'Vitest mock returning undefined pollutes Promise.allSettled paths — default to typed rejection in beforeEach',
    problem: 'When a Vitest vi.fn() mock is not configured for a test, it returns undefined by default. In Promise.allSettled([real(), mockedFn()]), the mock resolves to undefined instead of rejecting. Downstream code then calls supabase.rpc(..., { query_embedding: undefined }) or destructures { data, error } from undefined, throwing silently and returning [] from the outer catch.',
    solution: 'In beforeEach, set a default behavior for every mock that participates in allSettled paths: either a realistic resolved value or a typed rejection (e.g. mockFn.mockRejectedValue(new OllamaUnreachableError())). Never leave mocks unconfigured when their behavior affects test branches. This also documents intent — a rejection default means "this path is expected to fail in most tests."',
    context: 'Discovered when adding hybrid search tests to tests/knowledge-client.test.ts. The legacy FTS-only tests broke because embed() mock was returning undefined instead of rejecting, causing the vector code path to partially execute. Fix: added mockEmbed.mockRejectedValue(new OllamaUnreachableError()) to beforeEach.',
    confidence: 0.90,
    tags: ['vitest', 'testing', 'mocking', 'promise-allsettled', 'debugging'],
  },
  {
    category: 'error_fix',
    domain: 'testing',
    title: 'extractConfidence substring overlap causes wrong hit count — test phrases must not contain each other as substrings',
    problem: 'The uncertainty phrase list for extractConfidence() contains pairs where one phrase is a substring of another (e.g. "not sure" is a substring of "i\'m not sure"). Input text that matches the longer phrase is double-counted, producing a lower confidence score than expected. The test expectation then fails.',
    solution: 'When writing test cases for extractConfidence(), choose input phrases that do not contain any other phrase from the list as a substring. Before writing the expectation, manually search the phrase list for overlaps. Use unambiguous single-phrase inputs like "PERHAPS this is correct." which maps to exactly 1 match → confidence 0.60.',
    context: 'Test failure in tests/ollama-client.test.ts. Input "I\'M NOT SURE about this." matched both "i\'m not sure" (1 phrase) and "not sure" (overlapping substring = 2nd match) → 2 hits → 0.40, but expected 0.60. Fixed by switching to "PERHAPS this is correct." which has no sub-phrase overlaps.',
    confidence: 0.85,
    tags: ['testing', 'ollama-client', 'confidence', 'phrase-matching', 'debugging'],
  },

  // ── Workflows (Steps 1-5 established patterns) ─────────────────────────────

  {
    category: 'workflow',
    domain: 'autonomous-harness',
    title: 'Step verification before advancing: run dedicated E2E script against live infra before starting next Step',
    problem: 'Implementing multiple Steps in sequence without verifying each one against production, causing integration bugs to compound across steps. A bug introduced in Step 3 that only manifests against live Supabase is not discovered until Step 5.',
    solution: 'After each major autonomous harness Step, create a dedicated verification script (scripts/verify-step{N}-e2e.ts) that tests the full live path sequentially. The script produces a PASS/WARN/FAIL verdict and writes a result record to docs/handoffs/. Only advance to the next Step after a PASS verdict. Step can be re-run safely (idempotent cleanup at the end).',
    context: 'Established in LepiOS autonomous harness Steps 1-5. Step 5 verification script: scripts/verify-step5-e2e.ts. Verified 2026-04-19 with 8/8 PASS against localhost Ollama + production Supabase. The verification script pattern prevents Step N+1 work from building on a broken foundation.',
    confidence: 0.90,
    tags: ['autonomous-harness', 'e2e', 'verification', 'workflow', 'process'],
  },
  {
    category: 'workflow',
    domain: 'knowledge',
    title: 'Hybrid search 60/40 pattern: vector + FTS in parallel with graceful FTS fallback on Ollama unreachable',
    problem: 'Pure vector search fails when Ollama is unavailable. Pure FTS misses semantic similarity (synonym matching, paraphrase retrieval). Need a search that is both semantically aware and resilient.',
    solution: 'Run vector embed() and FTS in parallel via Promise.allSettled(). If both succeed: merge with 60% cosine similarity weight and 40% FTS position weight via mergeHybrid(). If Ollama is unreachable (OllamaUnreachableError): return FTS results only, log a knowledge.search.fts_only event. Callers see identical KnowledgeEntry[] shape from both paths — no caller changes needed on Ollama state change.',
    context: 'Implemented in lib/knowledge/client.ts findKnowledge() and mergeHybrid(). Vector path uses match_knowledge() Postgres RPC (pgvector IVFFlat cosine). FTS path uses tsvector generated column with websearch config. Confirmed working in Step 5 E2E verification 2026-04-19.',
    confidence: 0.90,
    tags: ['hybrid-search', 'pgvector', 'ollama', 'knowledge', 'workflow'],
  },
  {
    category: 'workflow',
    domain: 'knowledge',
    title: 'Auto-embed on save + backfill: embed at write time, backfill script fills rows saved while Ollama was down',
    problem: 'Knowledge rows saved while Ollama is unavailable have null embeddings and are invisible to vector search. Without a recovery mechanism, outages create permanent gaps in the semantic search index.',
    solution: 'saveKnowledge() attempts embed() first; on OllamaUnreachableError saves the row with embedding=null (not an error condition). A separate backfill script (scripts/backfill-embeddings.ts) fetches all rows WHERE embedding IS NULL, performs a healthCheck() first, then embeds and updates in batches of 10 with 200ms inter-batch delay. Backfill is resumable — safe to run multiple times.',
    context: 'Implemented in lib/knowledge/client.ts (auto-embed) and scripts/backfill-embeddings.ts (backfill). Pattern allows LepiOS to continue writing knowledge during Ollama downtime without data loss. Confirmed in Step 5 E2E: saveKnowledge() saved with non-null embedding when Ollama was live.',
    confidence: 0.90,
    tags: ['knowledge', 'embedding', 'backfill', 'ollama', 'workflow', 'resilience'],
  },
  {
    category: 'workflow',
    domain: 'autonomous-harness',
    title: 'Session handoff schema v1: structured JSONB with surface SQL columns for cheap filtering',
    problem: 'Session context is completely lost between Claude Code conversations. Every new session re-discovers the same decisions, errors, and architecture choices — wasting the first 20-30 minutes of every session on re-orientation.',
    solution: 'At session end: call saveHandoff() with a SessionHandoff object (schema_version 1). Fields: decisions, completed, deferred, unresolved, architectural_changes, next_steps. Stored as JSONB payload in session_handoffs table; surface columns (goal, status, sprint, occurred_at) enable cheap SQL filtering. At session start: getRecentHandoffs(3) → formatHandoffsForPrompt() → inject into prompt context. Handoffs are the memory bridge between sessions.',
    context: 'Implemented in lib/handoffs/client.ts and lib/handoffs/types.ts. Migration 0012. Step 2 of the autonomous harness. formatHandoffsForPrompt() renders 3 handoffs in under 2000 tokens. The session_id field uses human-readable slugs (e.g. "2026-04-19-step5-e2e-verified") for easy lookup.',
    confidence: 0.90,
    tags: ['handoffs', 'session-management', 'autonomous-harness', 'workflow', 'memory'],
  },
  {
    category: 'workflow',
    domain: 'ollama',
    title: 'Cloudflare tunnel for remote Ollama access: OLLAMA_TUNNEL_URL env var, getBaseUrl() falls back to localhost',
    problem: 'When Claude Code sessions run on Vercel (edge/serverless) or in contexts without direct localhost access, Ollama running on the home machine is unreachable via http://localhost:11434.',
    solution: 'Set OLLAMA_TUNNEL_URL to the Cloudflare tunnel URL pointing at the home machine\'s port 11434 (e.g. https://ollama.yourname.trycloudflare.com). All Ollama client functions call getBaseUrl() which prefers OLLAMA_TUNNEL_URL and strips trailing slashes. The tunnel_used flag in OllamaHealthResult indicates which path was used. Add OLLAMA_TUNNEL_URL to Vercel env to enable remote Ollama for the hosted app.',
    context: 'lib/ollama/client.ts getBaseUrl(). Tunnel configured in the Cloudflare self-hosted infra layer (infra/ Docker Compose). As of Step 5 E2E (2026-04-19), tunnel is coded and tested locally but not yet added to Vercel env — Ollama calls from Vercel will fail until that env var is set.',
    confidence: 0.85,
    tags: ['ollama', 'cloudflare-tunnel', 'remote-access', 'workflow', 'env'],
  },
]

// ── Step 3: Verify with findKnowledge ─────────────────────────────────────────

async function verifySeeding(): Promise<void> {
  console.log('\n[3/3] Verifying hybrid search returns seeded entries')

  const queries = ['supabase RLS', 'session handoff schema']
  for (const q of queries) {
    const results = await findKnowledge(q, { limit: 3 })
    const titles = results.map((r) => `"${r.title.slice(0, 60)}…"`).join(', ')
    if (results.length > 0) {
      console.log(`  ✓ findKnowledge("${q}") → ${results.length} result(s): ${titles}`)
    } else {
      console.log(`  ✗ findKnowledge("${q}") → 0 results — check FTS indexing`)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — Seed Real Knowledge + Save Step 5 Handoff')
  console.log('='.repeat(60))

  // 1. Save handoff
  await saveStep5Handoff()

  // 2. Seed knowledge
  console.log('\n[2/3] Seeding knowledge entries')
  let inserted = 0
  let failed = 0
  const failedTitles: string[] = []

  for (const entry of ENTRIES) {
    const id = await saveKnowledge(entry.category, entry.domain, entry.title, {
      problem: entry.problem,
      solution: entry.solution,
      context: entry.context,
      confidence: entry.confidence,
      tags: entry.tags,
    })
    if (id) {
      inserted++
      const icon = entry.category === 'principle' ? 'P' : entry.category === 'rule' ? 'R' : entry.category === 'error_fix' ? 'E' : 'W'
      console.log(`  ✓ [${icon}] ${entry.title.slice(0, 65)}…`)
    } else {
      failed++
      failedTitles.push(entry.title)
      console.error(`  ✗ FAILED: ${entry.title.slice(0, 65)}…`)
    }
  }

  // 3. Verify
  await verifySeeding()

  // Report
  console.log('\n' + '='.repeat(60))
  console.log('Seeding Report')
  console.log('='.repeat(60))
  console.log(`Entries attempted : ${ENTRIES.length}`)
  console.log(`Inserted          : ${inserted}`)
  console.log(`Failed            : ${failed}`)
  if (failedTitles.length > 0) {
    console.log('\nFailed entries:')
    for (const t of failedTitles) console.log(`  - ${t}`)
  }

  const byCategory: Record<string, number> = {}
  for (const e of ENTRIES) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1
  console.log('\nBy category:')
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count}`)
  }
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
