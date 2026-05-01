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
- **Database/Auth:** Supabase (RLS enforced — coordinator reviews all migration PRs before apply; `scripts/verify-safety.ts` handles static secret scanning)
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
6. **F21 — Acceptance tests first:** Every module has written acceptance criteria before code is written. The acceptance doc is the contract; code exists to satisfy it. See `lib/rules/registry.ts`.
7. **F17 — Behavioral ingestion justification required:** Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. See `docs/vision/behavioral-ingestion-spec.md`. If a module has no engine-feeding signal, reconsider building it.
8. **F18 — Measurement + benchmark required:** Every new module must ship with (a) metrics capture (`agent_events` or a dedicated table), (b) a defined benchmark to compare against (industry standard, known-good reference, or explicit Colin target), and (c) a surfacing path so Colin can ask "how is X doing?" and get a number + comparison. Required for autonomous operation — Colin must be able to audit any system's health, security, or reliability against a known reference without reading code. See `docs/vision/measurement-framework.md`. Companion rule to F17.
9. **F19 — Continuous improvement (process layer):** Every system, process, and workflow is continuously evaluated for "how can this be 20% faster, cheaper, or better?" Companion to F17 and F18 — extends the module-level 20% Better loop to the build process itself. Scope: (a) build process (parallelization, batching, idle resource detection); (b) module quality (original 20% Better loop scope); (c) communication patterns (paste blocks, friction signals, repeated clarifications); (d) resource utilization (Claude Code windows, coordinator quota, Ollama vs frontier routing); (e) Colin-time vs autonomous-time ratio — should trend toward autonomous. Implementation: every module ships with F18 metrics; every build cycle ends with a "what would have made this 20% faster?" reflection logged to CLAUDE.md §9; 20% Better loop runs nightly across all signals, surfaces top 3 actionable suggestions in morning_digest; any signal >20% inefficiency vs benchmark auto-queues a task. Process-layer instrumentation shipped 2026-04-26 in `lib/harness/process-efficiency.ts` (4 signals: queue throughput, pickup latency, queue depth, friction index).
10. **F20 — Design system enforcement:** Every port chunk must use shadcn/ui components and Tailwind utility classes only. No inline `style={}` attributes in TSX files. No ad-hoc CSS files. All shared components in `app/components/` or `components/ui/`. Builder acceptance tests must grep new TSX files for `style=` and fail if found. See `docs/sprint-5/purpose-review-acceptance.md §9`.
11. **F22 — Cron-secret auth via shared helper:** Every route under `app/api/**` that requires CRON_SECRET auth must call `requireCronSecret(request)` from `lib/auth/cron-secret.ts`. Inline `if (CRON_SECRET)` checks or local `isAuthorized()` helpers are forbidden — they re-introduce the fail-open bug (open endpoint when env var is missing). Enforced by `no-restricted-syntax` in `eslint.config.mjs` (scoped to `app/api/**`) and by reviewer-agent. Helper returns `null` on success, 500 if env unset, 401 on bad bearer. See `lib/rules/registry.ts` and `tests/auth/cron-secret.test.ts`.
12. **F23 — GPU Day readiness tracker updated on every relevant window close:** `docs/gpu-day-readiness.md` is a living doc. Any window that ships or confirms a line item must recompute the total and bump "Last updated" before closing. Do not report a line item complete without updating the tracker.

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

**GPU Day readiness:** see [`docs/gpu-day-readiness.md`](docs/gpu-day-readiness.md) — weighted tracker, updated every relevant window close.

### Chart Conventions

- **Charts:** use shadcn/ui Chart (`ChartContainer` + Recharts primitives). See `components/ui/chart.tsx`.
- **Sparklines (small inline):** raw SVG — see `QualityTrends.tsx` `Sparkline` function as the pattern.
- **Reference implementation:** `app/(cockpit)/amazon/_components/AmazonDailyChart.tsx` — BarChart with dual series + ChartTooltipContent.
- **ChartConfig colors:** pass LepiOS CSS vars directly (`color: 'var(--color-pillar-money)'`). `ChartStyle` injects them as scoped `--color-{key}` vars; use `fill="var(--color-{key})"` on Recharts elements.
- **Decision record:** `docs/decisions/chart-library-strategy.md`

### Autonomous Harness Agents

| Agent           | Spec file                       | Invoked by                           | Use for                                                                                                                   | Never use for                                                                                |
| --------------- | ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Coordinator** | `.claude/agents/coordinator.md` | task_queue harness or Colin directly | Sprint planning, acceptance docs, builder delegation, grounding checkpoint tracking, Telegram escalation                  | Writing code, self-approving acceptance docs, any destructive operation                      |
| **Builder**     | `.claude/agents/builder.md`     | Coordinator only                     | Translating an approved acceptance doc into working Next.js/Supabase code, running tests, deploying, writing handoff JSON | Anything without an approved acceptance doc, sprint planning, grounding checkpoint execution |

**Coordinator → Builder handoff:** Coordinator passes the acceptance doc path. Builder returns `docs/sprint-{N}/chunk-{id}-handoff.json`. Coordinator reads the JSON and decides next step. They run in **separate Claude Code context windows** — never the same session.

### Harness Endpoints (production)

| Endpoint                                | Use for                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /api/harness/task-heartbeat`      | Coordinator liveness signal during long-running phases — prevents stale-reclaim |
| `POST /api/harness/notifications-drain` | Flush `outbound_notifications` queue to Telegram — call after every insert      |
| `POST /api/twin/ask`                    | Digital Twin Q&A (production URL) — batch queries only, never mid-phase         |
| `GET /api/health`                       | Quick liveness check — 200 = app up, body has service states                    |

Local dev equivalents: replace `https://lepios-one.vercel.app` with `http://localhost:3000`.

### LepiOS MCP Tools

**Supabase** (`mcp__claude_ai_Supabase__*`)

| Tool              | When to use                                                                                                                | Never use for                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `execute_sql`     | Read `harness_config`, query `agent_events`, `task_queue`, `outbound_notifications`; check column names before writing SQL | Schema changes — use `apply_migration` |
| `apply_migration` | Apply schema migrations (builder only, after acceptance doc approval)                                                      | Read queries                           |
| `list_migrations` | Verify a migration landed; cross-check against `supabase/migrations/`                                                      | —                                      |
| `list_tables`     | Confirm table exists before writing SQL that references it — prevents F-L3 drift                                           | —                                      |
| `get_project`     | Get project URL and region                                                                                                 | —                                      |

**Vercel** (`mcp__claude_ai_Vercel__*`)

| Tool                        | When to use                                             | Never use for |
| --------------------------- | ------------------------------------------------------- | ------------- |
| `list_deployments`          | Confirm a deploy landed before marking a chunk complete | —             |
| `get_runtime_logs`          | Diagnose production errors absent from local logs       | —             |
| `get_deployment_build_logs` | Debug failed builds when CLI output is truncated        | —             |

**Sentry** (`mcp__claude_ai_Sentry__*`)

| Tool                  | When to use                                        | Never use for                           |
| --------------------- | -------------------------------------------------- | --------------------------------------- |
| `search_issues`       | Find production errors by component/route          | Liveness checks — use `GET /api/health` |
| `get_sentry_resource` | Full error details + stack trace for a known issue | —                                       |

**Puppeteer** (`mcp__puppeteer__*`)

| Tool                                          | When to use                                                  | Never use for                            |
| --------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `puppeteer_navigate` + `puppeteer_screenshot` | Post-deploy smoke test, E2E flow verification, UI regression | Pages with a JSON API — use curl instead |

**Google Sheets** (`mcp__google-sheets__*`)

| Tool         | When to use                                        | Never use for                          |
| ------------ | -------------------------------------------------- | -------------------------------------- |
| `read_sheet` | Read Streamlit baseline data for porting reference | Large reads (>500 rows) — download CSV |

### Global Skills Available

Skills are invoked via `/skill-name`. No project-level skills dir; all are global (`~/.claude/skills/`).

| Skill                   | When to trigger in LepiOS                                                     |
| ----------------------- | ----------------------------------------------------------------------------- |
| `/deploy-verify`        | After any PR merged to main — smoke-checks live Vercel routes                 |
| `/env-audit`            | Before any deploy that introduces new env vars                                |
| `/incident-runbook`     | Any production incident: build failing, Supabase unreachable, Telegram silent |
| `/api-budget`           | Before any multi-agent run or bulk Keepa/SP-API scan                          |
| `/telegram-dispatch`    | Routing harness alerts to the correct bot                                     |
| `/stochastic-consensus` | Architecture decisions needing adversarial validation                         |
| `/schedule`             | Creating/managing cron-scheduled remote agents                                |
| `/loop`                 | Polling tasks: watching a deploy, checking cron output                        |
| `/simplify`             | After builder ships a chunk — code quality pass                               |

### Sub-agent Types

| Type              | Use for                                                         | Don't use for                                        |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `Explore`         | Open-ended codebase search when scope is uncertain (>3 queries) | Code review, cross-file analysis — it reads excerpts |
| `Plan`            | Architecture decisions, multi-file design before coding         | Tasks where the file and change are already known    |
| `general-purpose` | Research, multi-step tasks, anything not fitting Explore/Plan   | Simple lookups — use Grep/Read directly              |

### Harness Components (not Claude agents)

| Component            | What it is                                                                         | Spec                                      |
| -------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| **Deploy Gate**      | Vercel preview → Telegram approve/reject → production promote pipeline             | `docs/harness-component-6-deploy-gate.md` |
| **Task Pickup Cron** | Daily (or hourly when Hobby slot available) cron that claims and fires coordinator | `docs/harness-component-5-task-pickup.md` |

> Safety Agent (mentioned in §2) is performed by Colin or coordinator in person — no agent file exists. Target: Sprint 5+.

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

**F-L15: Single-window-then-many ramp — under-utilization while concurrency is felt out (2026-04-27)**
Started today with one window, periodically asked "should we open more?", eventually ran four. The right concurrency is "just below where reports stack faster than I can read them." ~30 min of single-window under-utilization while the first task anchored before parallelism kicked in.
→ Session start should include a concurrency recommendation based on task_queue depth: >2 open unblocked tasks → suggest opening a second window immediately. Don't wait to feel out the right level. Queue task: per-window status signal in coordinator startup or Telegram.

**F-L14: ingest-claude-md.ts static entity list — new arch rules invisible to Twin (2026-04-27)**
F21 was registered in the registry and added to CLAUDE.md, but the Twin can't answer F21 arch-rule queries because `ingest-claude-md.ts` maintains a hard-coded entity list that wasn't updated. W4 flagged the gap; a targeted ingest run (W2 today) patches F21 specifically. The root issue persists.
→ `ingest-claude-md.ts` should derive its `arch-F*` entity list from `lib/rules/registry.ts` at runtime instead of a parallel static list. Any new `RULES` entry would then be automatically ingested on next run. Queue task: registry-driven ingest.

**F-L13: Component % bumps require manual SQL — generates Colin-interrupt on every advancement (2026-04-27)**
W2's rollup table auto-computes but doesn't auto-update component percentages — they stay at seed values until someone runs a manual UPDATE. W3 had to manually bump `smoke_test_framework` today. Each harness advancement that earns a % change requires a separate SQL intervention.
→ Component % bumps should land in the same PR as the work that earned them. Parse a `bumps harness:slug to N%` directive in PR description and run the UPDATE post-merge via migration or CI script. Queue task: component % auto-bump on PR merge.

**F-L12: F17 rule number cited with wrong meaning throughout session (2026-04-27)**
F17 was assumed throughout chat to mean "acceptance tests first" (former unnumbered rule 6) but actually means "behavioral-ingestion-justification." The rule "acceptance tests first" had no F-number until today (now F21, PR #13). Downstream sessions propagated the wrong meaning before the registry was consulted.
→ When an assistant cites an F-number in prose, cross-check `lib/rules/registry.ts` before propagating. Rule numbers are not self-evident from content; the registry is the source of truth, not context memory.

**F-L11: Vercel silent rejection at config-validation — no failed deploy created, 12h undeployed main (2026-04-27)**
The hourly notifications-drain cron (PR #9, merged yesterday) was rejected by Vercel Hobby plan at config validation — before any build ran, no failed deploy record was created, GitHub commit status was the only signal. Main was undeployable for 12+ hours while tests showed green and CI passed. The deploy gate verified tests + merge but had no production-deploy verification step.
→ Any cron addition must be validated against Vercel Hobby limits (max 1 hourly cron) before merge. Post-merge: confirm a new deployment landed in Vercel before marking done. The smoke test framework (PRs #12, #15) addresses the production verification gap going forward.

**F-L10: Manual rollup tracking — Colin asked twice (2026-04-26)**
Autonomy percentage was computed by hand mid-session and Colin had to ask for it twice. No authoritative rollup in any dashboard.
→ Auto-compute harness rollup from `task_queue` weights and surface in `morning_digest`. Colin should never need to ask for a number the system can compute. Queue task: morning_digest rollup widget.

**F-L9: "What to paste" friction signal fired 3+ times (2026-04-26)**
Multiple mid-session pauses for "what should I paste next?" signal. Indicates paste blocks weren't visually unmistakable — Colin had to re-read to find the right excerpt.
→ Codify standardized paste block header banner pattern (already used informally today). Every agent output that requires a paste action gets a `=== PASTE THIS ===` / `=== END PASTE ===` delimiter. No scanning required.

**F-L8: Rule numbering label collision — F19 assigned twice (2026-04-26)**
F19 was assigned to "continuous improvement" and separately to "design system enforcement." Required a renumber commit (`344ca13`) mid-day. Root cause: no canonical authority for rule numbers — coordinators and sessions assign them independently.
→ Rule registry as single source of truth. Options: dedicate a section of CLAUDE.md as the numbered rule table, or `lib/rules/index.ts`. Any new rule number must be claimed from the registry before use. Queue task: rule registry file.

**F-L7: Coordinator quota cliff mid-day — 4h lockout (2026-04-26)**
Routine quota exhausted mid-session. Coordinator locked out ~4 hours. Three pre-staged tasks sat idle. No warning before the cliff.
→ Predictive quota tracking: at current burn rate, surface "you'll hit limit in ~90 min — pay overage now or checkpoint". Should appear in session briefing, not just as a surprise stop. Queue task: quota burn rate tracker surfaced in coordinator startup.

**F-L6: Twin never verified functional in production — found via audit, not monitoring (2026-04-26)**
Twin had 100% escalation rate since deployment. Discovered during Phase 3 kickoff audit — not via any automated check. No post-deploy smoke test existed for the module.
→ Every module gets a post-deploy smoke test: one representative request, expected response shape, logs result to `agent_events`. Deploy gate should block if smoke test fails. Queue task: post-deploy smoke test framework per module.

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

**S-L15: 12 PRs merged in one day — squash-merge + CI gate held, no rollbacks (2026-04-27)**
PRs #4–#15 shipped across two sessions (yesterday + today). All squash-merged, all passed CI, zero production incidents. #9 was reverted cleanly before it could break deploys. The harness deploy gate + test suite provided sufficient coverage across 370+ tests.
→ Squash merge + CI gate is the right policy for this repo. Every main commit is a deployable unit. The gate isn't perfect (see F-L11 — Vercel config-validation gap) but covered all code-correctness cases. Continue.

**S-L14: DB rollup replaced manual tracking — caught agent over-count in real time (2026-04-27)**
W2's harness rollup table auto-computed autonomy at 84.6%. The chat assistant had been citing ~89% from mental arithmetic. DB number is authoritative; agent estimate was wrong by ~4.4 points. Pattern: when the system can self-report a metric, stop letting agents track it in their heads.
→ Any metric that appears in session chat more than once is a candidate for DB-resident tracking. Self-reported numbers from agents are estimates; DB-resident numbers are facts. Colin should be able to ask a live question and get a DB-sourced answer, not a recollection.

**S-L13: Audit-only tasks are zero-contention — run freely alongside build windows (2026-04-27)**
W4's rule consistency audit and W3's harness status diagnostic ran read-only throughout the session and never conflicted with W1/W2's build windows. Audit windows produced structured reports that build windows consumed — clean handoff with no coordination overhead.
→ Read-only/audit tasks have no contention with build windows. Run them in parallel whenever the task is correctly scoped (no file writes, no migrations, no deploys). The only constraint is Colin's attention span on incoming reports.

**S-L12: Rule registry self-policing proven on first real use (2026-04-27)**
W4 built the registry yesterday; W1 used `getNextRuleNumber()` today to register F21 cleanly with no collision and no cross-session coordination. The collision-detection test (18/18) caught a deliberately-injected duplicate. Registry workflow (claim → append → test → prose) worked end-to-end.
→ The registry + test gate is the right pattern for any shared enumeration that multiple sessions write to concurrently. Proven on F-rules; applicable to migration numbers, entity slugs, and other monotonically-increasing identifiers.

**S-L11: Quota cliff visibility + prevention closed same-day (2026-04-27)**
W1 shipped the quota-cliff digest signal (PR #10) and W2 shipped the pre-claim 429 guard (PR ee78867) same-day, after yesterday's F-L7 named the pattern. Both the visibility layer and the prevention layer landed before the next window could hit the cliff again.
→ When a recurring failure mode is named: pair "make it visible in digest" with "prevent it at source" in the same session. Shipping the signal without the guard leaves a visible-but-preventable failure. Shipping the guard without the signal leaves a silent one. Neither alone is sufficient.

**S-L10: Buffer slot discipline — 1 idle window prevents Colin-as-bottleneck (2026-04-26)**
Holding one window idle when 3 are active meant stacked reports didn't pile up waiting on a free slot. Colin could review and redirect without the queue stalling.
→ Optimal window count: 3 active + 1 buffer. At 4 active, Colin becomes the bottleneck when reports arrive faster than he can review. Cap active windows at 3 unless tasks are fully fire-and-forget.

**S-L9: Defense-in-depth shipping — FTS fallback before Ollama tunnel landed (2026-04-26)**
Twin P1 (FTS fallback) shipped today making the module functional in degraded-mode even though P0 (Ollama tunnel) isn't done. Module is live and useful now; infrastructure can follow.
→ Ship the defensive layer first when a module depends on infrastructure not yet in place. FTS/keyword fallback → pgvector when Ollama arrives. Functional now > perfect later.

**S-L8: Window-as-context-isolation — big audits in dedicated windows (2026-04-26)**
Twin Phase 3 audit and pre-staged doc audit each ran in their own window. Deep context (schema details, file paths, gap analysis) didn't pollute windows doing surgical commits or doc fixes.
→ Assign one window per major audit/module. Context isolation is not just about memory — it's about signal quality. A window doing 3 unrelated things gives worse answers than 3 focused windows.

**S-L7: Audit-first rule caught spec drift in all 3 pre-staged tasks before build (2026-04-26)**
All three pre-staged acceptance docs had material errors (migration number conflict, wrong file paths, non-existent table, wrong status enum values). Audit caught all 3 before coordinator handed them to builder. Cost: ~30 min. Savings: multiple builder rebuild cycles.
→ Pre-staged docs are hypotheses, not ground truth. Always run the audit-first check (grep actual file paths, confirm table/column names, verify migration numbers) before handing a spec to builder. Saved at minimum 3–4 hours of rework today.

**S-L6: Parallel Claude Code windows — 2.5–3x throughput vs serial (2026-04-26)**
First full multi-window session: 14 commits, 5 PRs (#4–#8), 3 acceptance doc audits, Twin P1+P3, 54-chunk corpus ingest — all in one day. Equivalent serial sessions would span 2–3 days.
→ Sweet spot: 3 concurrent windows + 1 buffer slot. Coordinator in one window, builders in separate windows, audit/research in a third. Never mix coordinator and builder context. Parallel windows are the single highest-leverage process improvement to date.

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

### Overflow logs (F-N / S-N series — post F-L15)

Entries added after F-L15 live in separate files to keep this section scannable:

- **Failures:** [`docs/claude-md/failures.md`](docs/claude-md/failures.md) — F-N1 through current
- **Successes:** [`docs/claude-md/successes.md`](docs/claude-md/successes.md) — S-N1 through current

Add new entries to those files, not to this section. Update this pointer when the F-N / S-N count changes significantly.

@AGENTS.md
