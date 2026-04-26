# CLAUDE.md — LepiOS

Global rules live in `~/.claude/CLAUDE.md` and apply here too.

**Single source of truth:** `ARCHITECTURE.md` at this project root. Read it before writing any code or making any design decision. If anything in this codebase contradicts it, flag it — do not silently fix it.

---

## 1 — Quick Context

LepiOS is Colin's life command center. Cockpit-style instrument panel.
Next.js App Router, Supabase, Tailwind, shadcn/ui (heavily customized),
Vercel.

**Current state (2026-04-21):**

Live in production at `lepios-one.vercel.app`, auto-deploying from
GitHub main. 370+ tests. Autonomous night_tick + morning_digest crons
running against production Supabase. Rule-based quality scoring v1
live, accumulating Tier 1 (`tier_1_laptop_ollama`) baseline data.

**Sprints shipped:**

- Sprint 1: Design Council primitives + cockpit shell
- Sprint 2: Betting tile (Kelly Sizer) — deployed, not active priority
- Sprint 3: PageProfit scan flow (Chunks A–E complete)
- Sprint 4 (current): Business Review Trust Layer (BR Tier 1–3 progression)

**Autonomous harness (parallel track):**

- Step 1–5 complete: knowledge store, handoffs, safety agent, scoring
  dashboard, Ollama + pgvector
- Step 6 complete: orchestration loop (night_tick + morning_digest)
  live in production as of 2026-04-20
- Step 6.5 pending: daytime Ollama tick + OLLAMA_TUNNEL_URL wiring
- Step 7–8 pending (see 8-component plan in docs/)

**Feedback loop scoring v1:** shipped 2026-04-21. See
docs/feedback-loop-scoring.md — §11 lists deferred work with
revisit triggers.

**Up next (as of this edit):** app-layer work on Sprint 4 Business
Review or Sprint 5 Amazon Orders + Payouts, per ARCHITECTURE.md §7
sprint queue. Autonomous harness expansion (Step 6.5 Ollama daytime)
gated on a clean week of overnight runs.

---

## 2 — Stack (locked, from ARCHITECTURE.md §9)

- **Framework:** Next.js App Router, TypeScript
- **Database/Auth:** Supabase (RLS enforced — Safety Agent reviews all migrations)
- **Payments:** Stripe (not v1-critical)
- **Hosting:** Vercel
- **UI:** React + Tailwind v4 + shadcn/ui — heavily customized per Design Council; no generic SaaS look
- **Local AI:** Ollama (Qwen 2.5 32B, Phi-4 14B)
- **Ingestion:** Telegram Bot API
- **Testing:** Puppeteer E2E, acceptance tests per module

---

## 3 — Architecture Rules (non-negotiable)

1. **Check-Before-Build (§8.4):** Before any new code/schema/config — verify it doesn't exist in the Streamlit OS baseline (Phase 2) or in this repo (Phase 3+). Default action: Beef-Up. Replace requires Colin's explicit approval. Build-New is last resort.
2. **Accuracy-Zone Pipeline (§8.5):** Tight-scope tasks (one sentence + acceptance criterion). Stop at 40-50% context window, write handoff note, fresh worker picks up. Reality-Check Agent reviews every report. Hallucination log: `docs/hallucination-log.md`.
3. **Decisions Are Colin's:** Agents propose; Colin decides. Every destructive operation, schema change, and migration plan requires explicit Colin approval.
4. **Tier 0 Safety:** Before any git operation, migration, deploy, or secret-adjacent action — confirm it is safe. If in doubt, stop and ask.
5. **Seamless or don't ship:** Every module uses Design Council primitives. No freelancing the look.
6. **Acceptance tests first:** Every module has written acceptance criteria before code is written.
7. **F17 — Behavioral ingestion justification required:** Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. See `docs/vision/behavioral-ingestion-spec.md`. If a module has no engine-feeding signal, reconsider building it.
8. **F18 — Measurement + benchmark required:** Every new module must ship with (a) metrics capture (`agent_events` or a dedicated table), (b) a defined benchmark to compare against (industry standard, known-good reference, or explicit Colin target), and (c) a surfacing path so Colin can ask "how is X doing?" and get a number + comparison. Required for autonomous operation — Colin must be able to audit any system's health, security, or reliability against a known reference without reading code. See `docs/vision/measurement-framework.md`. Companion rule to F17.
9. **F19 — Continuous improvement (process layer):** Every system, process, and workflow is continuously evaluated for "how can this be 20% faster, cheaper, or better?" Companion to F17 and F18 — extends the module-level 20% Better loop to the build process itself. Scope: (a) build process (parallelization, batching, idle resource detection); (b) module quality (original 20% Better loop scope); (c) communication patterns (paste blocks, friction signals, repeated clarifications); (d) resource utilization (Claude Code windows, coordinator quota, Ollama vs frontier routing); (e) Colin-time vs autonomous-time ratio — should trend toward autonomous. Implementation: every module ships with F18 metrics; every build cycle ends with a "what would have made this 20% faster?" reflection logged to CLAUDE.md §9; 20% Better loop runs nightly across all signals, surfaces top 3 actionable suggestions in morning_digest; any signal >20% inefficiency vs benchmark auto-queues a task. Process-layer instrumentation shipped 2026-04-26 in `lib/harness/process-efficiency.ts` (4 signals: queue throughput, pickup latency, queue depth, friction index).
10. **F20 — Design system enforcement:** Every port chunk must use shadcn/ui components and Tailwind utility classes only. No inline `style={}` attributes in TSX files. No ad-hoc CSS files. All shared components in `app/components/` or `components/ui/`. Builder acceptance tests must grep new TSX files for `style=` and fail if found. See `docs/sprint-5/purpose-review-acceptance.md §9`.

---

## 4 — Baseline Reference

The Streamlit OS (`../streamlit_app/`) is the 7-week baseline. It contains working logic for: Amazon scan/list/ship, expenses, betting (Kelly Sizer), Oura ingestion, Telegram bots, and more. Phase 2 audits document it in `audits/`. Phase 3 porting decisions (port vs. rebuild) require Colin's approval.

Do NOT modify the Streamlit OS during Phase 2. It remains running as reference until LepiOS v1 ships real value.

---

## 5 — Security Safeguards

**Before granting any user access to `loeppkyc/Loeppky`, the `loeppky_trigger_bot` token must be rotated via BotFather to invalidate the token still present in commit `fd8860c`'s history.** (INC-001 — risk accepted 2026-04-17 while repo is private, no collaborators.)

**INC-002 (2026-04-21): GitHub secret scanning detected two leaked Telegram bot tokens in `docs/security-log.md:114` and `audits/integrations-report.md:342`, both from Streamlit-era work. Both tokens revoked via BotFather the same day — no live security risk remains. Files were NOT scrubbed from the repo or history; alerts remain open in the GitHub Security tab. Defer cleanup until the repo direction is settled (delete + restart vs. scrub files + close alerts). If deciding to keep this repo long-term, do Option B: delete the two files in a commit, then mark the scanning alerts as revoked.**

**Never display, echo, or paste the contents of secrets, tokens, API keys, or credentials values in chat — not even for verification.** This applies to .env files, .streamlit/secrets.toml, Vercel env vars, BotFather tokens, database passwords, and anything labeled "secret," "token," "key," or "password." When updating such a value: confirm the update was made by name, show the before/after masked (first 4 + last 4 characters only, rest as dots), and state the file/line changed. If Colin asks you to display a secret anyway, remind him that chat transcripts are not secure and confirm twice before echoing. The default answer is "I updated it, first 4 / last 4 are X / Y."

---

## 6 — Data Integrity Rules

**Historical Streamlit bets data is NOT trusted for LepiOS signals pending an odds-integrity audit (BACKLOG-1).** Do not import bets from Streamlit SQLite/Sheets into the Supabase `bets` table without explicit approval from Colin and a verified audit. See `audits/migration-notes.md` BACKLOG-1 for scope and methodology requirements.

---

## 7 — Kill Criterion (ARCHITECTURE.md §11)

2 weeks from Phase 3 start: if LepiOS is not measurably helping Colin make or save money (Amazon Telegram alerts firing on real deals, Expenses tile tracking real spend, Betting/Trading tiles logging real activity), stop and simplify. Elegance is not a substitute for utility.

---

## 8 — Capabilities (LepiOS-specific)

### Autonomous Harness Agents

| Agent | Spec file | Invoked by | Use for | Never use for |
|-------|-----------|-----------|---------|---------------|
| **Coordinator** | `.claude/agents/coordinator.md` | task_queue harness or Colin directly | Sprint planning, acceptance docs, builder delegation, grounding checkpoint tracking, Telegram escalation | Writing code, self-approving acceptance docs, any destructive operation |
| **Builder** | `.claude/agents/builder.md` | Coordinator only | Translating an approved acceptance doc into working Next.js/Supabase code, running tests, deploying, writing handoff JSON | Anything without an approved acceptance doc, sprint planning, grounding checkpoint execution |

**Coordinator → Builder handoff:** Coordinator passes the acceptance doc path. Builder returns `docs/sprint-{N}/chunk-{id}-handoff.json`. Coordinator reads the JSON and decides next step. They run in **separate Claude Code context windows** — never the same session.

### Harness Endpoints (production)

| Endpoint | Use for |
|----------|---------|
| `POST /api/harness/task-heartbeat` | Coordinator liveness signal during long-running phases — prevents stale-reclaim |
| `POST /api/harness/notifications-drain` | Flush `outbound_notifications` queue to Telegram — call after every insert |
| `POST /api/twin/ask` | Digital Twin Q&A (production URL) — batch queries only, never mid-phase |
| `GET /api/health` | Quick liveness check — 200 = app up, body has service states |

Local dev equivalents: replace `https://lepios-one.vercel.app` with `http://localhost:3000`.

### LepiOS MCP Tools

| Tool | When to use in this project |
|------|-----------------------------|
| `mcp__claude_ai_Supabase__execute_sql` | Read `harness_config`, query `agent_events`, inspect `task_queue` — primary DB inspection tool |
| `mcp__claude_ai_Supabase__apply_migration` | Apply schema migrations during sprint builds (builder only) |
| `mcp__claude_ai_Supabase__list_migrations` | Verify migration was applied; cross-check against `supabase/migrations/` |
| `mcp__claude_ai_Vercel__list_deployments` | Confirm a deploy landed before marking a chunk complete |
| `mcp__claude_ai_Vercel__get_runtime_logs` | Diagnose production errors that don't appear in local logs |
| `mcp__claude_ai_Vercel__get_deployment_build_logs` | Debug failed builds when Vercel CLI output is truncated |

### Runtime Config Pattern

All values agents need at runtime live in the `harness_config` Supabase table:

```sql
SELECT key, value FROM harness_config WHERE key IN ('CRON_SECRET', 'TELEGRAM_CHAT_ID');
```

Read at coordinator session start before any other action. Never read from `process.env` for cross-boundary values — env vars are for the Next.js process, not for agent sub-processes.

---

## 9 — Failure / Success Log (LepiOS-specific)

Newest-first. For global failures (Streamlit, BBV, general patterns), see `~/.claude/CLAUDE.md §4`.

### FAILURES

**F-L5: Sprint context lost mid-run without phase handoff (Sprint 5, 2026-04)**
Coordinator hit context limit 2+ hours into a session. `sprint-state.md` reflected the session START state, not the last completed phase. New window re-ran Phase 1a.
→ Write `sprint-state.md` after EVERY phase completion — not at session end. Each phase boundary is a potential termination point. Heartbeat every ~3 min prevents stale-reclaim during long phases.

**F-L4: Twin endpoint unreachable in production, silently routed to Colin (Sprint 5, 2026-04)**
`coordinator.md` declared `/api/twin/ask` as the Q&A endpoint before it was verified live. Production returned 404. All twin queries escalated to Colin; Colin noticed in W2 audit.
→ Before documenting any endpoint in an agent spec, verify it returns 200 from both local (localhost:3000) AND production. Add a connectivity preflight in Phase 1b before the first batch query; log failure to `agent_events`.

**F-L3: Table name spec drift — `error_events` vs `agent_events` (Sprint 5, 2026-04)**
Acceptance doc said `error_events`; actual Supabase table was `agent_events`. Builder's INSERTs all failed silently. Tests passed (no table-existence assertion). Caught by W1 pre-build schema grep.
→ Grep the exact table name in migrations and schema files before writing SQL. Cross-reference with `information_schema.tables`. Never write a table name from memory.

**F-L2: Env vars absent at coordinator runtime (Sprint 5, fixed by 14c7809, 2026-04-20)**
`CRON_SECRET` and `TELEGRAM_CHAT_ID` were Vercel env vars, not accessible to the sub-agent process. All heartbeats and Telegram notifications silently failed.
→ Store runtime config in `harness_config` (Supabase). Read via SQL at session start. See §8 Runtime Config Pattern.

**F-L1: Coordinator writing to main instead of task-scoped branch (Sprint 5, fixed by 8a1758e, 2026-04-22)**
Coordinator pushed acceptance docs and code to `main`. Required manual history cleanup.
→ Branch guard enforced: every session verifies `harness/task-{task_id}` before any file write. Drift triggers `branch_guard_triggered` in `agent_events` and aborts. See `.claude/agents/coordinator.md` Branch Naming section.

### SUCCESSES

**S-L5: Parallel context windows — coordinator + builder in separate sessions (Sprint 5)**
Each role runs at full context depth without fighting the same window. Coordinator waits for `handoff.json`; builder never sees coordinator's sprint context.
→ Always separate coordinator and builder sessions. Pass only the acceptance doc path as the handoff artifact.

**S-L4: FTS fallback on top of pgvector for Twin knowledge store (Sprint 5)**
pgvector similarity returned 0 results on low-confidence queries. FTS catches keyword-exact matches embeddings miss. First deployment had 0% hit rate before FTS was added.
→ Every vector similarity search needs a keyword fallback. Semantic search that returns empty on low-confidence is broken, not smart.

**S-L3: Branch guard as F18 surfacing metric (8a1758e, 2026-04-22)**
`branch_guard_triggered` events in `agent_events` + morning_digest count. Zero events = guard working silently. Non-zero = drift caught. Self-monitoring without polling.
→ New enforcement rules: log compliance events to `agent_events`, surface count in morning_digest. Absence of events is the success signal.

**S-L2: Phase 1a Streamlit study before any acceptance doc (coordinator, 2026-04)**
Caught table-name drift, timezone handling bugs, and scope ambiguity before build. Became non-optional Phase 1a. Reduced Colin interventions from 14 (Chunk D v1, no study) to ~2 (Chunk D v2, with study).
→ For any port: study first (quote code), spec second, code third. The study doc is the spec input. Vagueness here propagates to spec-wrong builds.

**S-L1: `harness_config` as DB-resident runtime config (14c7809, 2026-04-20)**
Eliminated the "env var missing at coordinator runtime" failure class. Config survives Vercel env rotation. Coordinator reads at startup; no process.env dependency.
→ Autonomous agent runtime values → `harness_config`. App runtime values → Vercel env. Never cross the boundary.

@AGENTS.md
