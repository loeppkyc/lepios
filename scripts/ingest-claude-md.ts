/**
 * ingest-claude-md.ts — Ingest CLAUDE.md preference/rule chunks into the
 * knowledge table so the Digital Twin can answer coordinator Q&A without
 * escalating to real Colin.
 *
 * Sources:
 *   - Global ~/.claude/CLAUDE.md  (§1 Colin profile, §2 Preferences, §4 Failure/Success log)
 *   - LepiOS project CLAUDE.md    (§1 context, §3 Architecture Rules)
 *   - LepiOS AGENTS.md            (agent rules)
 *
 * Chunking strategy: one rule/entry = one chunk. Each chunk is a self-contained
 * answer to a question the coordinator might ask ("How does Colin handle scope
 * creep?", "What's the retry limit?", "What happened with F11?").
 *
 * Idempotency: chunks use a stable `entity = 'cmdingest:{source}:{slug}'`.
 * Re-running this script skips rows where that entity already exists.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.json scripts/ingest-claude-md.ts
 *
 * Requires (from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OLLAMA_TUNNEL_URL (optional — falls back to http://localhost:11434)
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Load .env.local (same pattern as backfill-embeddings.ts) ──────────────────
try {
  const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  /* rely on shell env */
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')

import { createClient } from '@supabase/supabase-js'
import { embed, healthCheck, OllamaUnreachableError } from '../lib/ollama/client'

const supabase = createClient(supabaseUrl, serviceKey)

// ── Chunk definition ──────────────────────────────────────────────────────────

type Chunk = {
  entity: string
  category: 'rule' | 'principle'
  domain: string
  title: string
  problem: string
  solution: string
  context: string
  confidence: number
}

// Each chunk is a coherent answer to a likely coordinator question.
// problem = the question this chunk answers
// solution = the authoritative answer / rule
// context = source info + keywords for FTS boosting

const CHUNKS: Chunk[] = [
  // ── GLOBAL CLAUDE.MD — §1 Colin Profile ─────────────────────────────────────

  {
    entity: 'cmdingest:global:colin-profile',
    category: 'principle',
    domain: 'coordinator',
    title: "Colin's profile: solo dev, goals, risk tolerance, active projects",
    problem:
      'Who is Colin? What drives him? What are his current projects, tech stack, and financial goals?',
    solution:
      "Solo developer. Builds fast, ships, iterates. Hates scope creep, unverified answers, wasted back-and-forth. Active: Loeppky Business OS (Streamlit/Python, primary), BBV/Brick & Book Vault (Next.js 15/Stripe, LIVE), Megan's Cleaning App (Streamlit). Stack: Streamlit, Next.js 15 App Router, Supabase, Stripe, Google Sheets, Telegram bots, Ollama, Anthropic Claude API. Financial goal: freedom by ~45 (2031). Amazon FBA business, $750K+ revenue (books, Lego). Futures trading (MES/M2K). Sports betting.",
    context:
      'Source: global CLAUDE.md §1 About Colin. Keywords: Colin, profile, goals, projects, stack, Amazon, FBA',
    confidence: 0.9,
  },

  // ── GLOBAL CLAUDE.MD — §2 Preferences & Conventions ────────────────────────

  {
    entity: 'cmdingest:global:pref-mandatory-read',
    category: 'rule',
    domain: 'coordinator',
    title: 'Mandatory read-before-code rule: never write from memory',
    problem:
      'Should I write or modify code without first reading the file? Can I cite a function or path from memory?',
    solution:
      'Before editing or creating any file: read it first. Before citing any function name, file path, or API: grep or read to verify it exists. Never code from memory. This applies to all agents — builder, coordinator, researcher.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: read, verify, hallucination, memory, grep',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-never-claim-works',
    category: 'rule',
    domain: 'coordinator',
    title: 'Never claim something works without verifying it',
    problem:
      "Is it OK to say 'this should work' or 'it's working now' without actually testing it?",
    solution:
      "Do NOT say 'this should work' or 'it's working now' unless actually verified. If unable to verify, say explicitly: 'I haven't been able to verify this — test X to confirm.' False confirmations waste more time than honesty.",
    context:
      'Source: global CLAUDE.md §2 Preferences. Related: F1. Keywords: verify, confirmed, working, tested',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-ui-functional-first',
    category: 'rule',
    domain: 'coordinator',
    title: 'UI = functional first, style later',
    problem: 'Should I spend time polishing UI before shipping? When should I ask about styling?',
    solution:
      'Default to making it work, style later. Do not polish unless Colin explicitly asks. If it works but looks rough, ship and note the roughness. Colin values functionality over aesthetics on first pass.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: UI, styling, polish, design, functional, ship',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-scope-discipline',
    category: 'rule',
    domain: 'coordinator',
    title: 'Scope discipline: when to fix vs. when to ask first',
    problem:
      'When can I just fix something vs. when do I need to ask Colin first? How should I handle scope?',
    solution:
      "Small, obviously-related fix → just do it, mention briefly. Anything touching multiple files or core logic → ask first. Never add features, error handling, or abstraction beyond what was asked. Fix only what was asked; flag other issues as 'I noticed X — want me to fix it?'",
    context:
      'Source: global CLAUDE.md §2 Preferences. Related: F9 (scope creep). Keywords: scope, ask, autonomy, fix',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-autonomy-level',
    category: 'rule',
    domain: 'coordinator',
    title: 'Autonomy level: what to decide vs. what to escalate',
    problem:
      'When should I make a call myself vs. stop and ask Colin? What decisions require his approval?',
    solution:
      'Style choices, naming, minor implementation details → make the call, mention it once. UX flow, data behavior, core logic → stop and ask first. Scope discipline: large or multi-file changes require approval before starting.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: autonomy, escalate, decide, approve, ask',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-terse-responses',
    category: 'rule',
    domain: 'coordinator',
    title: 'Terse responses: no summaries, no emojis, no trailing paragraphs',
    problem: 'How long and detailed should my responses be? Should I summarize what I just did?',
    solution:
      "No trailing summaries. No emojis unless asked. No 'here's what I did' paragraphs after completing a task. Colin can read the diff. Concise, lead with the answer. Short updates at key moments only.",
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: response, terse, summary, emoji, verbose',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-error-handling',
    category: 'rule',
    domain: 'coordinator',
    title: 'Error handling: one sentence on why it broke, then fix it',
    problem: 'When something breaks, how much should I explain? Should I write a post-mortem?',
    solution:
      "One sentence on why it broke, then fix it. No post-mortems unless Colin asks. Don't add error handling or validation for scenarios that can't happen — only validate at system boundaries.",
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: error, break, fix, explain, debugging',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-no-auth-bypasses',
    category: 'rule',
    domain: 'coordinator',
    title: 'No emergency auth bypasses or hardcoded credentials — ever',
    problem:
      'If authentication is broken, can I add a temporary hardcoded credential to unblock Colin?',
    solution:
      'Never add hardcoded credentials, emergency login bypasses, or backdoor logins. Fix the root cause instead. This is a hard rule — no exceptions regardless of urgency.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Related: F4. Keywords: auth, credentials, bypass, hardcode, security',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-confidence-scoring',
    category: 'rule',
    domain: 'coordinator',
    title: 'Confidence scoring: when to auto-apply vs. propose vs. escalate',
    problem: 'When should I just apply a fix vs. propose it first vs. stop and escalate to Colin?',
    solution:
      'Every fix gets a confidence score 1–10. Score ≥ 8 → auto-apply after tests pass. Score 5–7 → propose with reasoning, await approval. Score < 5 → stop and escalate with full context. Never auto-apply low-confidence fixes.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: confidence, score, approve, apply, escalate',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-retry-limit',
    category: 'rule',
    domain: 'coordinator',
    title: 'Retry limit: maximum 2 retries on any single problem',
    problem: 'How many times should I retry a failing approach before stopping?',
    solution:
      'Maximum 2 retries on a single problem. After 2 failures: stop, summarize what was tried, escalate to Colin with full context. Do not keep attempting the same approach.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: retry, attempts, failure, escalate, limit',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:pref-sibling-section-rule',
    category: 'rule',
    domain: 'coordinator',
    title: 'Sibling section rule: always check all sibling sections before marking done',
    problem: 'If I fix a bug in one section (e.g., Business expenses), am I done?',
    solution:
      'When fixing a bug in one section/metric, always check if the same fix is needed in all sibling sections (e.g., Personal, Total, other months) before reporting done. Do not wait to be asked about siblings.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: sibling, section, bug, consistency, thorough',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-streamlit-cache-clear',
    category: 'rule',
    domain: 'coordinator',
    title: 'Streamlit cache clear rule: verify live before marking done',
    problem: 'After making a Streamlit app change, can I mark it complete immediately?',
    solution:
      'After any Streamlit change: clear st.cache_data (or restart app) and verify the change appears in the running app before marking done. Do not report complete on a Streamlit change that has not been live-verified.',
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: Streamlit, cache, verify, live, deploy',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:pref-session-startup',
    category: 'rule',
    domain: 'coordinator',
    title: "Session startup: show what's broken or pending first",
    problem: 'When picking up a project at session start, what should I do first?',
    solution:
      "When picking up a project, always show what's broken or pending first — before asking what to do next. Use /startup skill if available. Check git status, recent commits, pending tasks.",
    context:
      'Source: global CLAUDE.md §2 Preferences. Keywords: startup, session, pending, broken, begin',
    confidence: 0.85,
  },

  // ── GLOBAL CLAUDE.MD — §3 Agent Routing ─────────────────────────────────────

  {
    entity: 'cmdingest:global:routing-decision-tree',
    category: 'principle',
    domain: 'coordinator',
    title: 'Agent routing decision tree: which tool/agent to use when',
    problem: 'Which sub-agent or skill should I use for a given task type?',
    solution:
      '0. Session start → /startup. 1. Security concern → /security or /security-review. 2. Code review → /review or /dev-review. 3. Open-ended codebase search → Explore sub-agent. 4. Architecture/multi-file design → Plan sub-agent. 5. Known file + known change → Read → Edit directly. 6. Recurring/scheduled → /schedule or /loop. 7. UI/UX decision → /design. 8. Health check → /health. 9. Everything else → general-purpose agent.',
    context:
      'Source: global CLAUDE.md §3 Agent Routing. Keywords: routing, agent, skill, tool, which',
    confidence: 0.9,
  },

  // ── GLOBAL CLAUDE.MD — §4 Failures F1–F16 ───────────────────────────────────

  {
    entity: 'cmdingest:global:F1',
    category: 'rule',
    domain: 'coordinator',
    title: 'F1: Never claim UI works without verifying it first',
    problem: 'Is it OK to say a UI change works without actually running and testing it?',
    solution:
      "Never say it works unless verified. If unverifiable, say explicitly 'I haven't been able to verify this — test X to confirm.' Claiming something works when it doesn't wastes more time than honesty.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F1. Keywords: UI, verify, claim, working, confirm',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F2',
    category: 'rule',
    domain: 'coordinator',
    title: 'F2: Never code from memory — always grep/read to verify names exist',
    problem: "Can I cite a function name or file path from memory if I'm fairly sure it exists?",
    solution:
      "Always grep or read to verify before citing any function name, file path, or API. Hallucinated function names that don't exist make it impossible for Colin to tell bugs from hallucinations.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F2. Keywords: memory, hallucinate, grep, verify, function',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F3',
    category: 'rule',
    domain: 'coordinator',
    title: "F3: Always push after building — Streamlit Cloud won't deploy uncommitted changes",
    problem: 'After making a Streamlit OS change locally, is it enough to mark it done?',
    solution:
      "After every Loeppky OS change: commit → push → THEN say done. Streamlit Cloud deploys from the GitHub repo, not local files. Local changes that aren't pushed are invisible to Colin.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F3. Keywords: push, commit, Streamlit, deploy, GitHub',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F4',
    category: 'rule',
    domain: 'coordinator',
    title: 'F4: No emergency auth bypasses — fix root cause, never add backdoors',
    problem: 'If login is broken, can I add a temporary hardcoded bypass to unblock Colin?',
    solution:
      'Fix the root cause. Never add backdoors. Colin does not want emergency login bypasses or hardcoded credentials under any circumstances.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F4. Keywords: auth, bypass, hardcode, login, credentials',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:F5',
    category: 'rule',
    domain: 'coordinator',
    title: 'F5: st.caption() is invisible on dark theme — use styled markdown instead',
    problem: 'Can I use st.caption() for informational text in Streamlit dark theme?',
    solution:
      'Use st.markdown(\'<div style="color:#aaa;font-size:0.8rem;">text</div>\', unsafe_allow_html=True) instead of st.caption(). st.caption() renders nearly invisible on dark backgrounds.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F5. Keywords: Streamlit, caption, dark theme, markdown, visible',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F6',
    category: 'rule',
    domain: 'coordinator',
    title: "F6: Use 'with col: st.method()' not col.method() dot notation",
    problem: "Can I use col.caption() or col.write() dot notation after a 'with col:' block?",
    solution:
      "Use 'with col: st.method()' syntax instead of col.method() dot notation. The dot notation fails silently in some Streamlit versions after a sibling 'with col:' block has closed.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F6. Keywords: Streamlit, column, with, dot notation, silent',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:global:F7',
    category: 'rule',
    domain: 'coordinator',
    title: 'F7: Use stats_only=True for Keepa deal scans to avoid token exhaustion',
    problem: 'How should I call Keepa for deal scanning vs. full analysis?',
    solution:
      'Use stats_only=True for deal finding (Amazon scan). Reserve full history (history=1, stats=90, rating=1, ~2 tokens/ASIN) for OOS analysis only. Set MIN_TOKENS_TO_PROCEED = 200 as a floor. Calling full history on every scan exhausts tokens fast.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F7. Keywords: Keepa, tokens, deal, scan, stats_only',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F8',
    category: 'rule',
    domain: 'coordinator',
    title: "F8: st.dataframe on_select doesn't fire reliably — use st.expander",
    problem: 'Can I use st.dataframe with on_select for click-row-then-show-details pattern?',
    solution:
      "Use st.expander for the 'click row → inline content' pattern. st.dataframe on_select does not fire reliably.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F8. Keywords: Streamlit, dataframe, on_select, expander, click',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:global:F9',
    category: 'rule',
    domain: 'coordinator',
    title: 'F9: No scope creep — fix only what was asked, flag extras separately',
    problem: 'If I notice related issues while fixing something, should I fix them too?',
    solution:
      "Fix only what was asked. Flag other issues as 'I noticed X — want me to fix it?' Do not add improvements, cleanup, or abstractions beyond the asked change.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F9. Keywords: scope creep, extras, cleanup, asked, flag',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:F10',
    category: 'rule',
    domain: 'coordinator',
    title: "F10: Don't re-ask for information Colin already confirmed in the session",
    problem: 'If Colin already said yes to an approach, do I need to re-confirm before executing?',
    solution:
      'When Colin says yes to a proposed approach, execute it without re-checking. Do not re-ask for confirmation of things already agreed in the same session.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F10. Keywords: confirm, re-ask, agreed, approved, execute',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F11',
    category: 'rule',
    domain: 'coordinator',
    title: "F11: Never 'import type' from Next.js route files in client components",
    problem: 'Can I import types from an API route handler file in a client component?',
    solution:
      "Never 'import type' from route handler files in client components. Even though TypeScript strips import type, Turbopack traverses the full module graph — if the route imports Node.js crypto or server-only modules, the client bundle breaks silently. Put shared types in a types/ file with zero runtime imports.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F11. Keywords: Next.js, import type, route, client, Turbopack, crypto',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F12',
    category: 'rule',
    domain: 'coordinator',
    title: 'F12: Amazon data acceptance docs must define every numeric field precisely',
    problem: 'What level of detail do acceptance docs need for Amazon data features?',
    solution:
      "Acceptance docs for Amazon data features must include a numeric field definition table: (a) which OrderStatus values are included, (b) whether Pending is shown separately/hidden/aggregated, (c) which Seller Central report column is the penny-match target. Vague specs like 'show pending orders' produce ambiguous builder output.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F12. Keywords: acceptance doc, Amazon, orders, pending, field definition',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F13',
    category: 'rule',
    domain: 'coordinator',
    title:
      'F13: Time-bucketed grid acceptance docs must specify timezone, presence rule, and exact time range',
    problem: 'What must acceptance docs include for monthly presence/absence grid features?',
    solution:
      "Acceptance docs for grid features must specify: (a) timezone for date comparison and boundary test cases, (b) singular presence rule (≥1 file = green?), (c) exact time range with purpose stated. 'Trailing 12 months' and 'calendar year 2025' are different scopes — never default without confirming.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F13. Keywords: acceptance doc, timezone, grid, presence, time range',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F14',
    category: 'rule',
    domain: 'coordinator',
    title:
      'F14: Grounding for ported Streamlit views uses Streamlit-parity diff, not raw source reconstruction',
    problem:
      'When porting a Streamlit view to LepiOS, what should the grounding checkpoint compare against?',
    solution:
      'Default to a Streamlit-parity diff (cell-by-cell LepiOS vs. Streamlit for the verified period). Only fall back to source-system grounding if Streamlit is known stale. Before writing any grounding checkpoint, check whether the Streamlit version is verified-correct for the period.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F14. Keywords: grounding, Streamlit, port, parity, diff',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F15',
    category: 'rule',
    domain: 'coordinator',
    title:
      'F15: Vercel CLI on Windows injects trailing \\r\\n into env vars — strip before storing',
    problem: 'Why might env vars stored via Vercel CLI be rejected by Dropbox or Stripe?',
    solution:
      "Vercel CLI v51.7.0 stdin env on Windows adds trailing \\r\\n to stored values (2 bytes longer than source). Three required mitigations: (a) strip whitespace before any 'vercel env add', (b) add .trim() on all env var reads at module boundary, (c) do a length-match check when porting creds — if target_length != source_length, the stored value is corrupt.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F15. Keywords: Vercel, env, Windows, carriage return, credentials, trim',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F16',
    category: 'rule',
    domain: 'coordinator',
    title:
      'F16: Coordinator Phase 1 requires Streamlit study → Digital Twin Q&A → 20% Better → acceptance doc',
    problem:
      'What four sub-phases must coordinator run before writing an acceptance doc for a ported feature?',
    solution:
      "Coordinator runs 4 sub-phases before writing any acceptance doc for a ported feature: (1a) read Streamlit implementation end-to-end and write a study doc; (1b) route every ambiguity to the digital twin first — only escalate to real Colin if twin can't answer confidently, in one consolidated batch; (1c) explicitly ask 'how do I make this ≥20% better than Streamlit'; (1d) write the acceptance doc from study output, twin answers, and improvements. Never from a plan line alone.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F16. Keywords: coordinator, Phase 1, study, twin, 20% better, acceptance doc',
    confidence: 0.95,
  },

  // ── GLOBAL CLAUDE.MD — §4 Successes S1–S6 ───────────────────────────────────

  {
    entity: 'cmdingest:global:S1',
    category: 'rule',
    domain: 'coordinator',
    title: 'S1: Section review workflow — read-back before fixing',
    problem: "When fixing a Loeppky OS section, what's the correct workflow?",
    solution:
      'When fixing a Loeppky OS section: (1) Colin describes expected behavior, (2) Claude reads it back in plain language, (3) Colin confirms, (4) fix applied and verified. Never skip the read-back step.',
    context:
      'Source: global CLAUDE.md §4 Success Log S1. Keywords: workflow, section, read-back, confirm, fix',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S2',
    category: 'rule',
    domain: 'coordinator',
    title: 'S2: Use SP-API for free Amazon enrichment before spending Keepa tokens',
    problem: 'For Amazon stock tracking, should I use Keepa or SP-API first?',
    solution:
      'SP-API keyword search + buy box + FBA fees for stocktrack = 0 Keepa tokens. Always try SP-API first before spending Keepa tokens on enrichment.',
    context:
      'Source: global CLAUDE.md §4 Success Log S2. Keywords: SP-API, Keepa, Amazon, tokens, free',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S3',
    category: 'rule',
    domain: 'coordinator',
    title: 'S3: Add debug expanders to every major section',
    problem: 'How should I instrument Streamlit sections for debugging?',
    solution:
      'Add \'with st.expander("🔍 Debug — Name", expanded=False): st.caption(...)\' to every major section. When something breaks, Colin expands it and pastes the output — the bug is diagnosable from runtime state without guessing.',
    context:
      'Source: global CLAUDE.md §4 Success Log S3. Keywords: debug, expander, Streamlit, runtime, instrument',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:global:S4',
    category: 'rule',
    domain: 'coordinator',
    title: 'S4: Button handler order — session_state → sheet → clear cache → st.rerun()',
    problem: "What's the correct order of operations in a Streamlit button handler?",
    solution:
      'Button handler order must be: (1) set session_state, (2) write to sheet, (3) clear cache, (4) st.rerun(). Cache clear can trigger an internal rerun in Streamlit 1.44+, skipping lines after it.',
    context:
      'Source: global CLAUDE.md §4 Success Log S4. Keywords: Streamlit, button, handler, order, session_state',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S5',
    category: 'rule',
    domain: 'coordinator',
    title: 'S5: Read session_state AFTER the button handler block, not before',
    problem: 'When should I read from session_state relative to a button handler?',
    solution:
      'Read session_state AFTER the button handler block, not before. Reading before the handler means you see stale state from the previous render.',
    context:
      'Source: global CLAUDE.md §4 Success Log S5. Keywords: session_state, Streamlit, button, read, stale',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S6',
    category: 'rule',
    domain: 'coordinator',
    title: 'S6: Anti-Hallucination Framework — confidence scoring + retry limit + git checkpoint',
    problem: 'What framework should I use to prevent hallucinated fixes in BBV?',
    solution:
      'BBV Anti-Hallucination Framework: 7-rule framework. Confidence scoring (auto-apply ≥8, propose 5-7, escalate <5) + retry limit (max 2 retries) + git checkpoint before high-risk fixes. Follow it in BBV — it works.',
    context:
      'Source: global CLAUDE.md §4 Success Log S6. Keywords: BBV, anti-hallucination, confidence, retry, git',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F17',
    category: 'rule',
    domain: 'coordinator',
    title: 'F17: Coordinator must verify task-scoped branch before any file write',
    problem: 'Can the coordinator push acceptance docs or code to main?',
    solution:
      'Every coordinator session must verify it is on harness/task-{task_id} before any file write. Branch drift aborts the session and logs branch_guard_triggered to agent_events. Never push to main from a coordinator session. Fixed by LepiOS commit 8a1758e.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F17. Related: LepiOS fix 8a1758e. Keywords: branch, main, coordinator, branch-guard, git',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:F18',
    category: 'rule',
    domain: 'coordinator',
    title: 'F18: Store coordinator runtime config in harness_config (Supabase), not process.env',
    problem:
      'Where should CRON_SECRET, TELEGRAM_CHAT_ID, and other coordinator runtime values be stored?',
    solution:
      'Store runtime config that agents need in the harness_config Supabase table. Coordinator reads at startup via SQL: SELECT key, value FROM harness_config. Never rely on process.env for values that must survive env rotation or cross process boundaries. Fixed by LepiOS commit 14c7809.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F18. Related: LepiOS fix 14c7809. Keywords: harness_config, process.env, runtime config, Supabase, coordinator',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:F19',
    category: 'rule',
    domain: 'coordinator',
    title: 'F19: Grep exact table name before writing any SQL — never from memory',
    problem: 'Can I write SQL referencing a table name from the acceptance doc or from memory?',
    solution:
      "Grep the exact table name in every migration and schema file before writing SQL. Cross-reference with: SELECT table_name FROM information_schema.tables WHERE table_schema='public'. Never write a table name from memory. The acceptance doc may say error_events when the schema has agent_events.",
    context:
      'Source: global CLAUDE.md §4 Failure Log F19. Keywords: table name, SQL, grep, agent_events, schema',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:global:F20',
    category: 'rule',
    domain: 'coordinator',
    title: 'F20: Verify endpoint returns 200 from both local and production before documenting it',
    problem:
      'Can I document an API endpoint in an agent spec without verifying it is reachable in production?',
    solution:
      'Before documenting any endpoint in an agent spec, verify it returns 200 from both local (localhost:3000) and production (lepios-one.vercel.app). Add a connectivity preflight to Phase 1b before the first batch query. Log failure to agent_events rather than silently escalating to Colin.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F20. Keywords: endpoint, production, 404, twin, verify, preflight',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:F21',
    category: 'rule',
    domain: 'coordinator',
    title: 'F21: Write sprint-state.md after every phase — context window termination is always possible',
    problem:
      'When should sprint-state.md be updated? Is it OK to update it at the end of a long session?',
    solution:
      'Write sprint-state.md after EVERY phase completion — not at the end of the session. Each phase boundary is a potential termination point. Heartbeat every ~3 min prevents stale-reclaim during long phases. If context is lost mid-phase, the last phase boundary state is the recovery point.',
    context:
      'Source: global CLAUDE.md §4 Failure Log F21. Keywords: sprint-state, phase, context window, termination, recovery',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S7',
    category: 'principle',
    domain: 'coordinator',
    title: 'S7: Log compliance events (not just violations) to agent_events — absence = success signal',
    problem: 'How should enforcement rules surface their status in the morning digest?',
    solution:
      'Log compliance events to agent_events, not just violations. branch_guard_triggered count in morning_digest: 0 events = guard working silently, N events = N branch drifts caught. The absence of events is the success signal. Self-monitoring without polling.',
    context:
      'Source: global CLAUDE.md §4 Success Log S7. Related: LepiOS fix 8a1758e. Keywords: agent_events, morning_digest, compliance, enforcement, branch_guard',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S8',
    category: 'principle',
    domain: 'coordinator',
    title: 'S8: Phase 1a audit-first Streamlit study before any acceptance doc',
    problem:
      'When can I start writing the acceptance doc for a feature being ported from Streamlit?',
    solution:
      'Read the full Streamlit implementation first and write a study doc. For any port: study first (quote the relevant code), spec second, code third. The study doc is the spec input — vagueness here propagates to spec-wrong code. Non-optional Phase 1a for all ported chunks.',
    context:
      'Source: global CLAUDE.md §4 Success Log S8. Keywords: Phase 1a, Streamlit study, port, acceptance doc, spec',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S9',
    category: 'principle',
    domain: 'coordinator',
    title: 'S9: harness_config Supabase table for all autonomous agent runtime values',
    problem:
      'Where should CRON_SECRET, TELEGRAM_CHAT_ID, and similar runtime values live for agents?',
    solution:
      'Store in harness_config (Supabase table). Coordinator reads at startup via SQL. Survives Vercel env rotation without touching agent specs. Eliminated the entire "env var missing at coordinator runtime" failure class. Autonomous agent runtime values → harness_config. App runtime values → Vercel env.',
    context:
      'Source: global CLAUDE.md §4 Success Log S9. Related: LepiOS fix 14c7809. Keywords: harness_config, Supabase, runtime, env vars, coordinator',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S10',
    category: 'principle',
    domain: 'lepios',
    title: 'S10: FTS fallback required for any pgvector similarity search',
    problem:
      'Is it OK to ship a semantic/vector similarity search that returns empty results on low-confidence queries?',
    solution:
      "Any semantic/vector search must ship with a keyword fallback (FTS). Never ship a similarity search that returns empty on low-confidence queries — FTS is the defensive catch layer. Twin knowledge store: pgvector similarity + FTS fallback. Without FTS, first deployment had 0% hit rate.",
    context:
      'Source: global CLAUDE.md §4 Success Log S10. Keywords: FTS, pgvector, similarity, fallback, twin, knowledge store',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:global:S11',
    category: 'principle',
    domain: 'coordinator',
    title: 'S11: Coordinator and builder always run in separate Claude Code context windows',
    problem: 'Can coordinator and builder run in the same Claude Code session?',
    solution:
      "Always run coordinator and builder in separate Claude Code context windows. Pass only the acceptance doc path as the handoff artifact; never forward the coordinator's full context to builder. Each role works at full context depth without fighting the same window. Coordinator waits for handoff.json before proceeding to Phase 4.",
    context:
      'Source: global CLAUDE.md §4 Success Log S11. Keywords: coordinator, builder, context window, handoff, separate sessions',
    confidence: 0.9,
  },

  // ── LEPIOS CLAUDE.MD — §1 Quick Context ─────────────────────────────────────

  {
    entity: 'cmdingest:lepios:context',
    category: 'principle',
    domain: 'lepios',
    title: 'LepiOS: current state, purpose, and sprint history',
    problem: "What is LepiOS? What's the current sprint and project state?",
    solution:
      "LepiOS is Colin's life command center. Cockpit-style instrument panel. Next.js App Router, Supabase, Tailwind, shadcn/ui, Vercel. Live at lepios-one.vercel.app. Sprint 4 current: Business Review Trust Layer. Sprint 3: PageProfit scan (A-E complete). 370+ tests. Autonomous night_tick + morning_digest crons running. Rule-based quality scoring v1 live. Step 6.5 pending: daytime Ollama tick + OLLAMA_TUNNEL_URL wiring.",
    context:
      'Source: lepios CLAUDE.md §1 Quick Context. Keywords: LepiOS, sprint, current, cockpit, state',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:lepios:stack',
    category: 'principle',
    domain: 'lepios',
    title: 'LepiOS stack: locked — Next.js, Supabase, Tailwind, shadcn/ui, Ollama',
    problem: 'What tech stack does LepiOS use? Can I choose a different framework or library?',
    solution:
      'Stack is locked. Framework: Next.js App Router, TypeScript. Database/Auth: Supabase (RLS enforced). Payments: Stripe. Hosting: Vercel. UI: React + Tailwind v4 + shadcn/ui (heavily customized per Design Council — no generic SaaS look). Local AI: Ollama (Qwen 2.5 32B, Phi-4 14B). Ingestion: Telegram Bot API. Testing: Puppeteer E2E.',
    context:
      'Source: lepios CLAUDE.md §2 Stack. Keywords: stack, Next.js, Supabase, shadcn, Ollama, locked',
    confidence: 0.9,
  },

  // ── LEPIOS CLAUDE.MD — §3 Architecture Rules ────────────────────────────────

  {
    entity: 'cmdingest:lepios:arch-check-before-build',
    category: 'rule',
    domain: 'lepios',
    title: "Arch rule 1: Check-Before-Build — verify it doesn't exist before creating",
    problem: 'Before writing new code or schema, do I need to check if it already exists?',
    solution:
      "Before any new code/schema/config — verify it doesn't exist in the Streamlit OS baseline (Phase 2) or in this repo (Phase 3+). Default action: Beef-Up (enhance what exists). Replace requires Colin's explicit approval. Build-New is last resort.",
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 1. Keywords: check, exist, build, verify, baseline',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:arch-accuracy-zone',
    category: 'rule',
    domain: 'lepios',
    title: 'Arch rule 2: Accuracy-Zone Pipeline — tight scope, stop at 40-50% context',
    problem: 'How should tasks be scoped? When should an agent stop and hand off?',
    solution:
      'Tight-scope tasks (one sentence + acceptance criterion). Stop at 40-50% context window, write handoff note, fresh worker picks up. Reality-Check Agent reviews every report. Hallucination log: docs/hallucination-log.md.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 2. Keywords: scope, context, handoff, accuracy, hallucination',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:arch-decisions-colins',
    category: 'rule',
    domain: 'lepios',
    title: "Arch rule 3: Decisions are Colin's — agents propose, Colin decides",
    problem:
      'Can an agent make destructive decisions, schema changes, or migration plans on its own?',
    solution:
      'Agents propose; Colin decides. Every destructive operation, schema change, and migration plan requires explicit Colin approval before execution.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 3. Keywords: approve, Colin, destructive, schema, decide',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:arch-tier0-safety',
    category: 'rule',
    domain: 'lepios',
    title: 'Arch rule 4: Tier 0 Safety — confirm before any git/migration/deploy/secret action',
    problem:
      'Before running a git operation, migration, deploy, or touching a secret, what do I do?',
    solution:
      'Before any git operation, migration, deploy, or secret-adjacent action — confirm it is safe. If in doubt, stop and ask. This is Tier 0 — non-negotiable.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 4. Keywords: safety, git, migration, deploy, secret, confirm',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:arch-seamless-design',
    category: 'rule',
    domain: 'lepios',
    title: "Arch rule 5: Seamless design or don't ship — use Design Council primitives",
    problem: 'Can I use generic SaaS UI patterns or freestyle the design for a new module?',
    solution:
      "Every module uses Design Council primitives. No freelancing the look. Seamless or don't ship. shadcn/ui components and Tailwind utility classes only — no inline style={} attributes.",
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 5. Keywords: design, Design Council, shadcn, seamless, ship',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:arch-acceptance-first',
    category: 'rule',
    domain: 'lepios',
    title: 'Arch rule 6: Acceptance tests first — write criteria before writing code',
    problem: 'When can I start writing code for a new module?',
    solution:
      'Every module has written acceptance criteria before code is written. Acceptance tests first — no exceptions.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 6. Keywords: acceptance, test, criteria, before, module',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:arch-F17-behavioral',
    category: 'rule',
    domain: 'lepios',
    title: 'F17: Every new module must justify its behavioral ingestion signal',
    problem: 'What do I need to justify before building a new LepiOS module?',
    solution:
      'Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. If a module has no engine-feeding signal, reconsider building it. See docs/vision/behavioral-ingestion-spec.md.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules F17. Keywords: behavioral, ingestion, signal, module, justify',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:lepios:arch-F18-measurement',
    category: 'rule',
    domain: 'lepios',
    title: 'F18: Every new module must ship with metrics, benchmark, and surfacing path',
    problem: 'What observability requirements must every new LepiOS module meet?',
    solution:
      "Every new module must ship with: (a) metrics capture (agent_events or dedicated table), (b) a defined benchmark to compare against (industry standard, known-good reference, or Colin target), (c) a surfacing path so Colin can ask 'how is X doing?' and get a number + comparison. Required for autonomous operation.",
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules F18. Keywords: metrics, benchmark, measurement, observability, module',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:lepios:arch-F19-continuous-improvement',
    category: 'rule',
    domain: 'lepios',
    title: 'F19: Every system/process/workflow evaluated for 20% faster/cheaper/better',
    problem:
      'What continuous improvement obligation applies to every LepiOS system and build process?',
    solution:
      'Every system, process, and workflow is continuously evaluated for "how can this be 20% faster, cheaper, or better?" Scope: (a) build process — parallelization, batching, idle resource detection; (b) module quality — correctness, performance, UX, extensibility, data model, observability; (c) communication patterns — paste blocks, friction signals, repeated clarifications; (d) resource utilization — Claude Code windows, coordinator quota, Ollama vs frontier routing; (e) Colin-time vs autonomous-time ratio — should trend toward autonomous. Every build cycle ends with "what would have made this 20% faster?" logged to CLAUDE.md §9. 20% Better loop surfaces top 3 suggestions in morning_digest.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules F19. Instrumented: lib/harness/process-efficiency.ts (4 signals: queue throughput, pickup latency, queue depth, friction index). Keywords: 20% better, continuous improvement, build process, efficiency, autonomous',
    confidence: 0.85,
  },
  {
    entity: 'cmdingest:lepios:arch-F20-design-system',
    category: 'rule',
    domain: 'lepios',
    title: 'F20: No inline style={} in TSX — shadcn/ui + Tailwind only',
    problem: 'Can I use inline style attributes or ad-hoc CSS in LepiOS TSX files?',
    solution:
      "No inline style={} attributes in TSX files. No ad-hoc CSS files. shadcn/ui components and Tailwind utility classes only. All shared components in app/components/ or components/ui/. Builder acceptance tests must grep new TSX files for 'style=' and fail if found.",
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules F20. Keywords: inline style, TSX, shadcn, Tailwind, CSS',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:arch-F21-acceptance-tests-first',
    category: 'rule',
    domain: 'lepios',
    title: 'F21: Acceptance tests first — write acceptance criteria before writing any code',
    problem:
      'When can I start writing code for a new module? Is it OK to write code before the acceptance criteria are defined?',
    solution:
      'Every module has written acceptance criteria before code is written. The acceptance doc is the contract; code exists to satisfy it. No exceptions — acceptance tests first, always. The acceptance doc must be written and approved before any builder work begins. See lib/rules/registry.ts for the canonical rule registry.',
    context:
      'Source: lepios CLAUDE.md §3 Architecture Rules rule 6 (F21). Keywords: F21, acceptance tests, acceptance criteria, acceptance doc, contract, module, builder, before code',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:kill-criterion',
    category: 'rule',
    domain: 'lepios',
    title: 'LepiOS kill criterion: 2 weeks to prove real value or simplify',
    problem: "What's the bar for LepiOS to be worth continuing?",
    solution:
      '2 weeks from Phase 3 start: if LepiOS is not measurably helping Colin make or save money (Amazon Telegram alerts firing on real deals, Expenses tile tracking real spend, Betting/Trading tiles logging real activity), stop and simplify. Elegance is not a substitute for utility.',
    context:
      'Source: lepios CLAUDE.md §7 Kill Criterion. Keywords: kill, simplify, value, utility, money, timeline',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:baseline',
    category: 'principle',
    domain: 'lepios',
    title: 'Streamlit OS is the baseline — do not modify it, use it as reference',
    problem: 'Can I modify the Streamlit OS at ../streamlit_app/ while building LepiOS?',
    solution:
      "The Streamlit OS (../streamlit_app/) is the 7-week baseline. It contains working logic for Amazon scan/list/ship, expenses, betting, Oura ingestion, Telegram bots. Do NOT modify it during Phase 2. It remains running as reference until LepiOS v1 ships real value. Phase 3 porting decisions require Colin's approval.",
    context:
      'Source: lepios CLAUDE.md §4 Baseline Reference. Keywords: Streamlit, baseline, reference, port, porting',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:data-integrity',
    category: 'rule',
    domain: 'lepios',
    title: 'Historical bets data is not trusted — do not import without audit',
    problem: 'Can I import historical bets from Streamlit SQLite/Sheets into Supabase?',
    solution:
      'Historical Streamlit bets data is NOT trusted for LepiOS signals pending an odds-integrity audit (BACKLOG-1). Do not import bets from Streamlit SQLite/Sheets into the Supabase bets table without explicit approval from Colin and a verified audit.',
    context:
      'Source: lepios CLAUDE.md §6 Data Integrity Rules. Keywords: bets, import, integrity, audit, Supabase',
    confidence: 0.9,
  },

  // ── AGENTS.MD ────────────────────────────────────────────────────────────────

  {
    entity: 'cmdingest:agents:read-before-code',
    category: 'rule',
    domain: 'coordinator',
    title: 'AGENTS.md: MANDATORY read before editing or creating any file',
    problem:
      "Is it really mandatory to read a file before editing it, even if I already know what's in it?",
    solution:
      'MANDATORY: Before editing or creating any file, you MUST first read: the file you are about to edit, and any file you reference by name. If you cite a function name, file path, or API — verify it exists with Grep or Read before including it in your response. Do not rely on memory for exact names.',
    context: 'Source: lepios AGENTS.md. Keywords: mandatory, read, edit, create, verify, grep',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:agents:nextjs-caveat',
    category: 'rule',
    domain: 'coordinator',
    title: 'AGENTS.md: This is NOT the Next.js you know — read the docs before writing code',
    problem:
      'Can I use Next.js patterns from training data without checking the installed version?',
    solution:
      'This version of Next.js has breaking changes — APIs, conventions, and file structure may all differ from training data. Read the relevant guide in node_modules/next/dist/docs/ before writing any code. Heed deprecation notices.',
    context: 'Source: lepios AGENTS.md. Keywords: Next.js, breaking changes, version, docs, API',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:agents:architecture-northstar',
    category: 'rule',
    domain: 'coordinator',
    title: "AGENTS.md: ARCHITECTURE.md is the north star — flag contradictions, don't fix silently",
    problem: 'If I find code that contradicts ARCHITECTURE.md, should I fix it silently?',
    solution:
      'ARCHITECTURE.md is the north star. If anything in the codebase contradicts it, flag it — do not silently fix it. Always check ARCHITECTURE.md before making any design decision.',
    context:
      'Source: lepios AGENTS.md. Keywords: ARCHITECTURE.md, northstar, contradict, flag, design',
    confidence: 0.95,
  },

  // ── LEPIOS CLAUDE.MD — §8 Capabilities ──────────────────────────────────────

  {
    entity: 'cmdingest:lepios:cap-coordinator-agent',
    category: 'rule',
    domain: 'coordinator',
    title: 'LepiOS coordinator agent: what it does and what it must never do',
    problem: 'What is the coordinator agent responsible for in LepiOS? What are its limits?',
    solution:
      'Coordinator (spec: .claude/agents/coordinator.md): invoked by task_queue harness or Colin directly. Use for: sprint planning, acceptance docs, builder delegation, grounding checkpoint tracking, Telegram escalation. NEVER for: writing code, self-approving acceptance docs, any destructive operation. Handoff: coordinator passes acceptance doc path; builder returns docs/sprint-{N}/chunk-{id}-handoff.json. Run in separate Claude Code context windows.',
    context:
      'Source: lepios CLAUDE.md §8 Capabilities. Keywords: coordinator, agent, sprint planning, acceptance doc, builder, handoff',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:cap-builder-agent',
    category: 'rule',
    domain: 'lepios',
    title: 'LepiOS builder agent: what it does and what it must never do',
    problem: 'What is the builder agent responsible for? When can builder be invoked?',
    solution:
      'Builder (spec: .claude/agents/builder.md): invoked by coordinator ONLY. Use for: translating an approved acceptance doc into working Next.js/Supabase code, running tests, deploying, writing handoff JSON. NEVER for: anything without an approved acceptance doc, sprint planning, grounding checkpoint execution. Builder never sees coordinator context — receives only the acceptance doc path.',
    context:
      'Source: lepios CLAUDE.md §8 Capabilities. Keywords: builder, agent, acceptance doc, deploy, handoff JSON, coordinator',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:cap-harness-endpoints',
    category: 'rule',
    domain: 'lepios',
    title: 'LepiOS harness endpoints: heartbeat, notifications-drain, twin/ask, health',
    problem: 'What production endpoints does the coordinator use during a session?',
    solution:
      'Production harness endpoints (replace lepios-one.vercel.app with localhost:3000 for local): POST /api/harness/task-heartbeat (coordinator liveness — prevents stale-reclaim); POST /api/harness/notifications-drain (flush outbound_notifications queue to Telegram — call after every insert); POST /api/twin/ask (Digital Twin Q&A — batch queries only, never mid-phase); GET /api/health (quick liveness — 200 = app up). Verify each endpoint returns 200 before documenting in any spec.',
    context:
      'Source: lepios CLAUDE.md §8 Capabilities. Keywords: heartbeat, notifications-drain, twin/ask, health, production endpoints, harness',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:cap-lepios-mcp-tools',
    category: 'rule',
    domain: 'lepios',
    title: 'LepiOS MCP tools: Supabase and Vercel tools specific to this project',
    problem: 'Which MCP tools should I use for DB inspection and deployment verification in LepiOS?',
    solution:
      'LepiOS MCP tools: mcp__claude_ai_Supabase__execute_sql (read harness_config, query agent_events, inspect task_queue — primary DB tool); mcp__claude_ai_Supabase__apply_migration (apply migrations — builder only); mcp__claude_ai_Supabase__list_migrations (verify migration applied); mcp__claude_ai_Vercel__list_deployments (confirm deploy landed); mcp__claude_ai_Vercel__get_runtime_logs (diagnose production errors); mcp__claude_ai_Vercel__get_deployment_build_logs (debug failed builds).',
    context:
      'Source: lepios CLAUDE.md §8 Capabilities. Keywords: Supabase, Vercel, MCP tools, execute_sql, apply_migration, list_deployments, runtime_logs',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:cap-runtime-config',
    category: 'rule',
    domain: 'lepios',
    title: 'LepiOS runtime config pattern: read from harness_config at coordinator session start',
    problem: 'How does a coordinator session get CRON_SECRET, TELEGRAM_CHAT_ID, and other runtime values?',
    solution:
      "All values agents need at runtime live in the harness_config Supabase table. Read at coordinator session start: SELECT key, value FROM harness_config WHERE key IN ('CRON_SECRET', 'TELEGRAM_CHAT_ID'). Never read from process.env for cross-boundary values — env vars are for the Next.js process, not for agent sub-processes.",
    context:
      'Source: lepios CLAUDE.md §8 Runtime Config Pattern. Keywords: harness_config, runtime config, CRON_SECRET, TELEGRAM_CHAT_ID, session start',
    confidence: 0.95,
  },

  // ── LEPIOS CLAUDE.MD — §9 Failure / Success Log ──────────────────────────────

  {
    entity: 'cmdingest:lepios:FL1',
    category: 'rule',
    domain: 'coordinator',
    title: 'F-L1: Coordinator must be on harness/task-{id} branch — never write to main',
    problem: 'What branch should the coordinator be on when writing acceptance docs or code?',
    solution:
      'Branch guard enforced: every coordinator session verifies harness/task-{task_id} before any file write. Drift triggers branch_guard_triggered in agent_events and aborts the session. See .claude/agents/coordinator.md Branch Naming section. Fixed by LepiOS commit 8a1758e.',
    context:
      'Source: lepios CLAUDE.md §9 Failure Log F-L1. Keywords: branch guard, coordinator, main, harness/task, agent_events',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:FL2',
    category: 'rule',
    domain: 'coordinator',
    title: 'F-L2: Vercel env vars not accessible to coordinator sub-process — use harness_config',
    problem:
      'Can coordinator rely on Vercel env vars like CRON_SECRET at runtime in sub-agent processes?',
    solution:
      'Vercel env vars are not accessible to the coordinator sub-agent process at runtime. Store in harness_config (Supabase). Read via SQL at session start. Never rely on process.env for cross-boundary values. Fixed by LepiOS commit 14c7809.',
    context:
      'Source: lepios CLAUDE.md §9 Failure Log F-L2. Keywords: env vars, coordinator, runtime, harness_config, process.env, CRON_SECRET',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:FL3',
    category: 'rule',
    domain: 'coordinator',
    title: 'F-L3: Grep exact table name from schema before any SQL — acceptance doc may be wrong',
    problem:
      'How do I know the correct table name to use in SQL? Can I trust the acceptance doc?',
    solution:
      "Acceptance doc may say error_events when schema has agent_events. Grep the exact table name in migrations and schema files before writing SQL. Cross-reference: SELECT table_name FROM information_schema.tables WHERE table_schema='public'. Tests may pass even with wrong table if there is no table-existence assertion.",
    context:
      'Source: lepios CLAUDE.md §9 Failure Log F-L3. Keywords: table name, SQL, agent_events, error_events, schema grep',
    confidence: 0.95,
  },
  {
    entity: 'cmdingest:lepios:FL4',
    category: 'rule',
    domain: 'coordinator',
    title: 'F-L4: Verify /api/twin/ask returns 200 from production before using it',
    problem: 'Can I use the /api/twin/ask endpoint without verifying it is live in production?',
    solution:
      'Before documenting /api/twin/ask (or any endpoint) in an agent spec, verify it returns 200 from both local (localhost:3000) AND production (lepios-one.vercel.app). Add a connectivity preflight in Phase 1b before the first batch query. Log failure to agent_events rather than silently routing to Colin.',
    context:
      'Source: lepios CLAUDE.md §9 Failure Log F-L4. Keywords: twin/ask, endpoint, production, 404, preflight, Phase 1b',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:FL5',
    category: 'rule',
    domain: 'coordinator',
    title: 'F-L5: Write sprint-state.md after every phase — treat each phase boundary as a potential termination',
    problem: 'When should sprint-state.md be updated during a long coordinator session?',
    solution:
      'Write sprint-state.md after EVERY phase completion — not at session end. Each phase boundary is a potential termination point. Heartbeat every ~3 min prevents stale-reclaim during long phases. If context window closes mid-phase, the last completed phase boundary is the recovery point for the next window.',
    context:
      'Source: lepios CLAUDE.md §9 Failure Log F-L5. Keywords: sprint-state, phase, context window, heartbeat, recovery',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:SL1',
    category: 'principle',
    domain: 'lepios',
    title: 'S-L1: harness_config (Supabase) eliminates env-var runtime failures for autonomous agents',
    problem:
      'What is the pattern that eliminated the "env var missing at coordinator runtime" failure class?',
    solution:
      'Store all autonomous agent runtime values in harness_config Supabase table. Coordinator reads at session start via SQL. Config survives Vercel env rotation without touching agent specs. Autonomous agent runtime values → harness_config. App runtime values → Vercel env. Never cross the boundary. LepiOS commit 14c7809.',
    context:
      'Source: lepios CLAUDE.md §9 Success Log S-L1. Keywords: harness_config, Supabase, runtime, env vars, coordinator, autonomous',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:SL2',
    category: 'principle',
    domain: 'lepios',
    title: 'S-L2: Phase 1a Streamlit study catches spec drift before build — non-optional for ports',
    problem: 'How much did Phase 1a Streamlit study reduce Colin interventions during sprint builds?',
    solution:
      'Phase 1a reduced Colin interventions from 14 (Chunk D v1, no study) to ~2 (Chunk D v2, with study). Caught table-name drift, timezone handling bugs, scope ambiguity. Non-optional for all ported chunks. Study first (quote relevant code), spec second, code third. The study doc is the spec input.',
    context:
      'Source: lepios CLAUDE.md §9 Success Log S-L2. Keywords: Phase 1a, Streamlit study, port, acceptance doc, Colin interventions',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:SL3',
    category: 'principle',
    domain: 'coordinator',
    title: 'S-L3: Branch guard events in agent_events → morning_digest count is the success signal',
    problem: 'How does the branch guard self-report its health without polling?',
    solution:
      'branch_guard_triggered events logged to agent_events; morning_digest surfaces the count. Zero events = guard working silently. Non-zero = N branch drifts caught. Self-monitoring without polling — absence of events is the success signal. Apply same pattern to new enforcement rules.',
    context:
      'Source: lepios CLAUDE.md §9 Success Log S-L3. Related: commit 8a1758e. Keywords: branch_guard_triggered, agent_events, morning_digest, enforcement, compliance',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:SL4',
    category: 'principle',
    domain: 'lepios',
    title: 'S-L4: FTS fallback on pgvector is what made the Twin knowledge store functional',
    problem:
      'What prevented the Twin knowledge store from returning 0 results on low-confidence queries?',
    solution:
      'FTS (full-text search) fallback on top of pgvector similarity. When embedding distance exceeds threshold and returns 0 results, FTS catches keyword-exact matches that embeddings miss. Without FTS, first Twin production deployment had 0% hit rate. Every vector similarity search must ship with a keyword fallback.',
    context:
      'Source: lepios CLAUDE.md §9 Success Log S-L4. Keywords: FTS, pgvector, similarity, fallback, Twin, knowledge store, 0% hit rate',
    confidence: 0.9,
  },
  {
    entity: 'cmdingest:lepios:SL5',
    category: 'principle',
    domain: 'coordinator',
    title: 'S-L5: Coordinator and builder in separate context windows — pass only the acceptance doc path',
    problem: 'Should coordinator and builder share the same Claude Code context window?',
    solution:
      "Always run coordinator and builder in separate Claude Code context windows. Each role works at full context depth without fighting for space. Coordinator waits for handoff.json; builder never sees coordinator sprint context. Pass only the acceptance doc path as the handoff artifact — never the full coordinator context.",
    context:
      'Source: lepios CLAUDE.md §9 Success Log S-L5. Keywords: coordinator, builder, context window, handoff, separate sessions, parallel',
    confidence: 0.9,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function embedText(c: Chunk): string {
  return [c.title, c.problem, c.solution, c.context].filter(Boolean).join(' ')
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('LepiOS — CLAUDE.md knowledge ingest')
  console.log(`Total chunks defined: ${CHUNKS.length}`)
  console.log('='.repeat(60))

  // Check Ollama health (non-fatal — chunks save without embeddings)
  const health = await healthCheck()
  if (health.reachable) {
    console.log(
      `\nOllama reachable — ${health.models.length} model(s), latency ${health.latency_ms}ms`
    )
  } else {
    console.log('\nOllama not reachable — chunks will be saved WITHOUT embeddings.')
    console.log('Run backfill-embeddings.ts after starting Ollama to add vectors.')
  }
  console.log()

  let inserted = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < CHUNKS.length; i++) {
    const chunk = CHUNKS[i]
    process.stdout.write(`  [${i + 1}/${CHUNKS.length}] ${chunk.entity} … `)

    // ── Idempotency check ────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('knowledge')
      .select('id')
      .eq('entity', chunk.entity)
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.log('SKIP (already exists)')
      skipped++
      continue
    }

    // ── Embed (best effort) ──────────────────────────────────────────────────
    let embedding: number[] | null = null
    if (health.reachable) {
      try {
        embedding = await embed(embedText(chunk))
      } catch (err) {
        if (!(err instanceof OllamaUnreachableError)) throw err
        // Ollama went down mid-run — continue without embedding
      }
    }

    // ── Insert ───────────────────────────────────────────────────────────────
    const { error } = await supabase.from('knowledge').insert({
      category: chunk.category,
      domain: chunk.domain,
      title: trunc(chunk.title, 300),
      entity: chunk.entity,
      problem: trunc(chunk.problem, 1000),
      solution: trunc(chunk.solution, 1000),
      context: trunc(chunk.context, 1000),
      confidence: chunk.confidence,
      embedding: embedding ? JSON.stringify(embedding) : null,
      source_events: null,
      tags: ['claude_md', chunk.domain],
    })

    if (error) {
      console.log(`FAIL: ${error.message}`)
      failed++
    } else {
      const embStatus = embedding ? `OK (${embedding.length}d)` : 'OK (no embed)'
      console.log(embStatus)
      inserted++
    }

    // Small delay to avoid flooding Ollama on rapid successive requests
    if (health.reachable && i < CHUNKS.length - 1) await delay(50)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Done — ${inserted} inserted, ${skipped} skipped (already existed), ${failed} failed`)
  if (failed > 0) {
    console.log(`Re-run to retry the ${failed} failed chunk(s) (idempotent — skips existing)`)
  }
  if (!health.reachable && inserted > 0) {
    console.log(
      `\nOllama was unreachable — run backfill-embeddings.ts to generate vectors for the ${inserted} new chunks`
    )
  }
  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
