# HARNESS_FOUNDATION_SPEC

**Status:** APPROVED (Draft 2, 2026-04-28). Colin redline applied.
**Source of truth:** This doc. The `harness_components` table seeds from here.
**Authority:** Migration 0043 replaces the current 24-row seed with the 21 harness rows below; creates `product_components` with 7 rows.

**Redline notes (Draft 1 → Draft 2):**

- `smoke_test_framework` restored to harness (quality-gate infrastructure).
- T2 weights rebalanced: `stall_detection` 4→3, `improvement_loop` 6→4, `smoke_test_framework` added at 3.
- Product split approved with finalized membership (7 rows, list below).
- Priority order: `digital_twin` (85→95%) elevated to #1 in parallel with `security_layer`.
- Memory-layer scope (Twin + idea inbox + decisions log + session digest) deferred to its own scope doc next session.

---

## At a glance

| Field                        | Approved                                                        | Live (verified 2026-04-28) |
| ---------------------------- | --------------------------------------------------------------- | -------------------------- |
| Component count (harness)    | **21**                                                          | 24                         |
| Component count (product)    | **7**                                                           | (mixed in harness table)   |
| Sum of weight_pct (harness)  | **100.0**                                                       | 112.0 (drifted)            |
| Rollup % (harness, weighted) | **~55.7%**                                                      | 91.1%                      |
| Rollup formula               | unchanged: `SUM(weight × completion / 100) / SUM(weight) × 100` | same                       |

The honest drop from 91% → 56% reflects the new emphasis on agentic capabilities (sandbox, arms_legs, security_layer, specialized_agents) that were absent from the old model. The orchestration plumbing the prior rollup measured is largely shipped; the model is now measuring the right thing.

---

## Architectural principle

**Pipeline-style. No god objects.** Each component is a standalone module with:

- A folder under `lib/harness/{component}/` (most current rows are loose `.ts` files at `lib/harness/*.ts` — migration to subfolders is a follow-on cleanup, not a blocker)
- One README per component documenting purpose, interface, and current completion drivers
- An interface contract: how other components call it (typed function signature or HTTP endpoint)
- Tests in `tests/harness/{component}.test.ts`
- A row in `harness_components` matching its slug

**New idea = drop in new module, register a row, done.** No edits to a central registry beyond the new row.

---

## Tier overview

| Tier | Theme                       | Weight  | Component count | Status                      |
| ---- | --------------------------- | ------- | --------------- | --------------------------- |
| T1   | Core orchestration          | 24      | 4               | Mostly shipped              |
| T2   | Observability + improvement | 16      | 5               | Mostly shipped              |
| T3   | Agentic capabilities        | 45      | 8               | Mostly missing — the unlock |
| T4   | Interfaces + attribution    | 15      | 4               | Mostly missing              |
|      | **Total**                   | **100** | **21**          |                             |

---

## Component specs

Each row: `slug — weight × completion% = points · status`. Status: ✅ shipped · 🟡 partial · ⬜ missing.

### T1 — Core orchestration (24 weight)

#### `coordinator_loop` — 12 × 100% = 12.0 · ✅

Coordinator/builder loop, branch-naming guard, env loading.

- **Purpose:** Long-lived autonomous coordinator that picks tasks, writes acceptance docs, delegates to builder, reads handoff JSON.
- **Interface:** Spawned by task-pickup cron or `/api/harness/invoke-coordinator`. Reads `harness_config` for runtime values. Emits heartbeat to `/api/harness/task-heartbeat`.
- **Files:** [.claude/agents/coordinator.md](../../.claude/agents/coordinator.md), [lib/harness/branch-guard.ts](../../lib/harness/branch-guard.ts), [lib/harness/invoke-coordinator.ts](../../lib/harness/invoke-coordinator.ts)
- **Collapses:** `coordinator_core` (18) + `coordinator_env` (5) + `branch_naming` (3) from the live table.

#### `task_pickup` — 5 × 100% = 5.0 · ✅

Cron-triggered claim + fire of next ready task in `task_queue`.

- **Interface:** `POST /api/harness/task-pickup` (cron auth). Returns claimed task id or "no work."
- **Files:** [lib/harness/task-pickup.ts](../../lib/harness/task-pickup.ts), [lib/harness/pickup-runner.ts](../../lib/harness/pickup-runner.ts)

#### `remote_invocation` — 4 × 100% = 4.0 · ✅

Ability to fire coordinator from outside the local terminal (Telegram, cron, webhook).

- **Interface:** `/api/harness/invoke-coordinator` + Vercel cron + Telegram trigger bot.
- **Files:** [app/api/harness/invoke-coordinator/route.ts](../../app/api/harness/invoke-coordinator/route.ts) (verify path), `vercel.json`

#### `deploy_gate` — 3 × 100% = 3.0 · ✅

Vercel preview → Telegram approve/reject → production promote.

- **Interface:** GitHub webhook → preview URL → Telegram inline keyboard → promote endpoint.
- **Files:** [lib/harness/deploy-gate.ts](../../lib/harness/deploy-gate.ts), [docs/harness-component-6-deploy-gate.md](../harness-component-6-deploy-gate.md)

---

### T2 — Observability + improvement (16 weight)

#### `stall_detection` — 3 × 100% = 3.0 · ✅

Heartbeat-based stale-reclaim of crashed coordinator sessions (T1–T5 escalation).

- **Interface:** Coordinator posts to `/api/harness/task-heartbeat` every ~3 min; stall checker reclaims tasks with no heartbeat in N min.
- **Files:** [lib/harness/stall-check.ts](../../lib/harness/stall-check.ts)

#### `notification_drain` — 3 × 100% = 3.0 · ✅

`outbound_notifications` queue → Telegram with dedup.

- **Interface:** `POST /api/harness/notifications-drain`. Called after every notification insert.
- **Files:** existing — verify in `lib/notifications/` or similar.

#### `f18_surfacing` — 3 × 100% = 3.0 · ✅

Compliance/health metrics in `agent_events` surfaced via morning_digest. Branch-guard counter, rollup line, quota cliff, etc.

- **Interface:** `agent_events.action` taxonomy + `lib/orchestrator/digest.ts` builders.
- **Files:** [lib/harness/rollup.ts](../../lib/harness/rollup.ts), [lib/harness/quota-cliff.ts](../../lib/harness/quota-cliff.ts), [lib/orchestrator/digest.ts](../../lib/orchestrator/digest.ts)

#### `improvement_loop` — 4 × 100% = 4.0 · ✅

20% Better feedback loop: nightly audit → proposals to `task_queue` → Telegram notify.

- **Interface:** Triggered post-chunk-merge or nightly cron. Reads recent commits + agent_events, posts proposals.
- **Files:** [lib/harness/improvement-engine.ts](../../lib/harness/improvement-engine.ts), [lib/harness/process-efficiency.ts](../../lib/harness/process-efficiency.ts)

#### `smoke_test_framework` — 3 × 90% = 2.7 · 🟡

Post-deploy smoke tests for every harness module. Quality-gate infrastructure.

- **Why 90%:** Framework + Ollama-health and route-health smokes shipped; per-module coverage incomplete (F-L11/F-L6 named the gap).
- **Interface:** `lib/harness/smoke-tests/{module}.ts` exports `run(): Promise<SmokeResult>`; deploy_gate runs all on every promote.
- **Files:** [lib/harness/smoke-tests/](../../lib/harness/smoke-tests/) — `cron-registration.ts`, `ollama-health.ts`, `route-health.ts`

---

### T3 — Agentic capabilities (45 weight) — **the unlock**

#### `arms_legs` — 9 × 30% = 2.7 · 🟡

File ops, shell, browser, API call capabilities for autonomous agents.

- **Why 30%:** Coordinator/builder have file edit + Bash + SQL via Claude Code's tool surface in unattended mode. Browser (Puppeteer) is wired but only used with a human in the loop. Outbound HTTP (Telegram, Vercel API) works. Missing: stable headless browser flow for autonomous use; broader API surface (Gmail, Sheets) for agents not running as Claude Code subprocesses.
- **Purpose:** Decouples "can take an action in the world" from "is currently running inside Claude Code." Future agents (chat_ui-driven, daytime Ollama) need their own action layer.
- **Interface:** TS module `lib/harness/arms-legs/{fs,shell,browser,http}.ts` exposing typed capabilities; a `Capability` interface with permission scoping (see `security_layer`).
- **Status:** Most pieces exist as ad-hoc imports; no unified contract or capability registry.

#### `sandbox` — 7 × 0% = 0.0 · ⬜

Isolated execution environment for risky work (untrusted scripts, schema migrations preview, exploratory shell).

- **Purpose:** Lets agents run code that touches files/network/DB without risking the live workspace. Required before `self_repair` or `push_bash_automation` can act unsupervised.
- **Interface:** `runInSandbox(cmd, { fsScope, netScope, timeout })` returning `{ stdout, stderr, exitCode, fsDiff }`. Implementation candidates: ephemeral git worktree (already used by some subagents), Docker, or remote Vercel preview deploy for HTTP-shaped work.
- **Files:** none. `.claude/worktrees/` shows the worktree primitive is already in use for subagents — that is the seed.

#### `security_layer` — 7 × 30% = 2.1 · 🟡

Secrets handling, sandbox boundaries, audit trail, capability scoping.

- **Why 30%:** Branch guard (S-L3) is live; secrets-redaction rules in CLAUDE.md §5; pre-push hooks block test failures; no plaintext secrets in repo (mostly — see INC-001/INC-002). Missing: per-agent capability scope, secrets vault / on-the-fly env injection, agent-action audit log distinct from `agent_events`, sandbox-boundary enforcement.
- **Interface:** `requireCapability(agentId, cap)` middleware on every arms_legs call; `secrets.get(name, agentId)` instead of raw `process.env`; immutable audit log table `agent_actions`.

#### `self_repair` — 6 × 0% = 0.0 · ⬜

Error detection + autonomous fix loop.

- **Purpose:** Closes the gap between "deploy fails" and "Colin notices." Agent reads failure logs → drafts fix → runs in sandbox → if green, opens PR; if not, escalates.
- **Interface:** Triggered by Sentry issue or failed deploy webhook. Bounded by retry limit (max 2 per CLAUDE.md global rule), confidence score (auto-apply ≥ 8), and sandbox.
- **Status:** `/autofix` skill exists at the user-invoked level; no autonomous trigger.

#### `digital_twin` — 6 × 85% = 5.1 · 🟡

Q&A interface for agent-to-corpus questions before escalating to Colin.

- **Why 85%:** pgvector corpus + FTS fallback shipped (S-L4, S-L10); Ollama tunnel live; coordinator wiring complete (Phase 4); category fix shipped. Missing: corpus completeness for project decisions/sprint plans (F-L14 surfaced ingest gap), threshold calibration on real query volume, response-quality measurement.
- **Interface:** `POST /api/twin/ask` → `{ answer, confidence, citations }`.
- **Files:** [app/api/twin/ask/route.ts](../../app/api/twin/ask/route.ts) (verify), `scripts/ingest-claude-md.ts`
- **Collapses:** `twin_corpus` + `twin_fts` + `twin_ollama` from the live table.

#### `specialized_agents` — 5 × 40% = 2.0 · 🟡

Planner, coder, reviewer, deployer roles with enforced contracts.

- **Why 40%:** Coordinator + builder are well-defined and separated (S-L11). Reviewer exists as a Claude Code subagent type but is invoked ad-hoc. Planner = global Plan subagent, ad-hoc. Deployer = informal (deploy_gate is the system, not an agent role).
- **Purpose:** Replace ad-hoc `subagent_type=...` calls with named role agents that have their own spec doc, capability scope, and metrics.
- **Files:** [.claude/agents/coordinator.md](../../.claude/agents/coordinator.md), [.claude/agents/builder.md](../../.claude/agents/builder.md). Need: `.claude/agents/{reviewer,planner,deployer}.md`.

#### `push_bash_automation` — 3 × 0% = 0.0 · ⬜

Auto-decide commit-vs-run-vs-ask for low-risk shell/git operations.

- **Purpose:** Reduce Colin-as-bottleneck on routine confirmations. Auto-commits docs, runs read-only queries, runs npm test; asks for migrations, force-push, secrets rotation.
- **Interface:** `decideAction(cmd, context) → 'auto' | 'ask' | 'block'` driven by allowlist + context-risk scoring.
- **Risk note:** Hard dependency on `sandbox` and `security_layer` before any "auto" path ships.

#### `debate_consensus` — 2 × 10% = 0.2 · 🟡

Multi-agent disagreement resolution before action.

- **Why 10%:** `/stochastic-consensus` skill exists globally; not integrated into harness decision points (acceptance-doc approval, deploy gate, fix-or-escalate).
- **Purpose:** N agents on the same prompt with varied framings; mode wins, splits flagged, outliers logged.
- **Interface:** `consensus(prompt, { n, tier }) → { answer, splits, outliers }`.

---

### T4 — Interfaces + attribution (15 weight)

#### `chat_ui` — 6 × 0% = 0.0 · ⬜

Claude.ai-style local interface for talking to the harness.

- **Purpose:** Colin opens a browser tab, types "what's the harness rollup?" or "ship the queued tasks now," gets a response. Removes Claude-Code-as-only-entrypoint dependency.
- **Interface:** Next.js page at `/chat` (or `/orb`) backed by an LLM with arms_legs + digital_twin tool access. Streams responses. Persists conversation in Supabase.
- **Status:** Hardware (GPU) and model selection scoped in `docs/orb-readiness.md` and `docs/lepios/time-to-orb.md`. App layer: not started.

#### `telegram_outbound` — 4 × 50% = 2.0 · 🟡

Telegram thumbs-up/down, escalation, callback handling.

- **Why 50%:** Timeouts wired (✅), drain dedup (✅), notification queue draining hourly cron failed Vercel Hobby limit (deferred). Missing: callback truncation handling, correlation across multi-message threads, inline keyboard in production for deploy_gate + improvement_loop.
- **Files:** [lib/harness/telegram-buttons.ts](../../lib/harness/telegram-buttons.ts), [lib/harness/telegram-stats.ts](../../lib/harness/telegram-stats.ts), [lib/harness/telegram-escape.ts](../../lib/harness/telegram-escape.ts), [lib/harness/telegram-timeouts.ts](../../lib/harness/telegram-timeouts.ts) (verify)
- **Collapses:** `telegram_timeouts` + `telegram_remaining` + `telegram_drain_hourly` from the live table.

#### `attribution` — 3 × 30% = 0.9 · 🟡

Who/what made each change. Branch-naming attribution + per-action actor on `agent_events`.

- **Why 30%:** Branch naming (`harness/task-{id}`) enforced. `agent_events.actor` populated. Missing: per-commit actor in git trailers, per-PR actor in description, dashboard view of "what did each agent do this week."
- **Files:** Migration 0028 (`actor_type_colin`), [lib/harness/branch-guard.ts](../../lib/harness/branch-guard.ts).

#### `ollama_daytime` — 2 × 50% = 1.0 · 🟡

Daytime Ollama tick: local model handles low-stakes work while Claude Code is asleep.

- **Why 50%:** Tunnel infrastructure live (twin_ollama at 100% in old model). Missing: daytime tick scheduler, work-routing rules ("Ollama for tier=cheap"), GPU/quota guarding.
- **Files:** [lib/harness/ollama-tunnel-stats.ts](../../lib/harness/ollama-tunnel-stats.ts), [docs/harness-step-6.5-ollama-daytime-tick.md](../harness-step-6.5-ollama-daytime-tick.md)

---

## Approved rollup math

| Tier | Components                                                                                                                                                                                               | Sum of (weight × completion / 100) |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| T1   | coordinator_loop (12), task_pickup (5), remote_invocation (4), deploy_gate (3)                                                                                                                           | 24.0                               |
| T2   | stall_detection (3), notification_drain (3), f18_surfacing (3), improvement_loop (4), smoke_test_framework (3 × 0.90 = 2.7)                                                                              | 15.7                               |
| T3   | arms_legs (9 × 0.30), sandbox (7 × 0), security_layer (7 × 0.30), self_repair (6 × 0), digital_twin (6 × 0.85), specialized_agents (5 × 0.40), push_bash_automation (3 × 0), debate_consensus (2 × 0.10) | 12.1                               |
| T4   | chat_ui (6 × 0), telegram_outbound (4 × 0.50), attribution (3 × 0.30), ollama_daytime (2 × 0.50)                                                                                                         | 3.9                                |
|      | **Total**                                                                                                                                                                                                | **55.7**                           |

**Approved rollup: 55.7%.** Honest reflection of the new model.

---

## Reconciliation: 24 live rows → 20 spec rows

### Collapsed (multi → single)

| Live rows                                                    | →   | Spec row          |
| ------------------------------------------------------------ | --- | ----------------- |
| coordinator_core, coordinator_env, branch_naming             | →   | coordinator_loop  |
| twin_corpus, twin_fts, twin_ollama                           | →   | digital_twin      |
| telegram_timeouts, telegram_remaining, telegram_drain_hourly | →   | telegram_outbound |

### Renamed / unchanged

| Live row           | →   | Spec row           |
| ------------------ | --- | ------------------ |
| task_pickup        | →   | task_pickup        |
| remote_invocation  | →   | remote_invocation  |
| deploy_gate        | →   | deploy_gate        |
| stall_detection    | →   | stall_detection    |
| notification_drain | →   | notification_drain |
| f18_surfacing      | →   | f18_surfacing      |
| improvement_loop   | →   | improvement_loop   |

### New (8 — the kickoff additions)

arms_legs, sandbox, security_layer, self_repair, specialized_agents, push_bash_automation, debate_consensus, chat_ui

### Moved to product_components (approved)

amazon_orders_sync, amazon_settlements_sync, amazon_reports_view, streamlit_module_scanner, streamlit_rebuild_utility_tracker, tax_sanity, prestaged_tasks

### Stays in harness (per redline)

smoke_test_framework — quality-gate infrastructure, not an app feature.

---

## Product modules vs. harness modules — APPROVED

The live table has 7 rows that are LepiOS _product features_, not harness infrastructure. Migration 0043 moves them to a sibling `product_components` table with identical schema.

**Membership (per redline):**

| Slug                                | Why product, not harness                                  |
| ----------------------------------- | --------------------------------------------------------- |
| `amazon_orders_sync`                | Amazon module — sync job for the app                      |
| `amazon_settlements_sync`           | Amazon module — settlements ingest for the app            |
| `amazon_reports_view`               | Amazon module — `/amazon` page UI                         |
| `streamlit_module_scanner`          | Tooling for the Streamlit rebuild — feeds product roadmap |
| `streamlit_rebuild_utility_tracker` | Rebuilt LepiOS page (`/utility`)                          |
| `tax_sanity`                        | Digest signal about business data — moved per redline     |
| `prestaged_tasks`                   | Meta tracker, not a system — judgment call to demote      |

**Stays in harness:**

- `smoke_test_framework` — quality-gate infrastructure (per redline). Earned T2 weight 3.

**`morning_digest` consequence:** the rollup line splits into two values once this lands:

```
Harness rollup: 55.7% · Product rollup: <computed>
```

A second rollup function (`computeProductRollup()`) using identical math against the new table is a follow-on task — not part of migration 0043. The 0043 migration only moves rows; the digest line stays harness-only until the product rollup function ships.

---

## Priority order for tackling missing components — APPROVED

Ranked by leverage (impact × prerequisite-ness × Colin-time saved). Numbers are rough effort guesses.

**#1 (parallel — start both immediately):**

- **`digital_twin` (85 → 95%)** — ~1 day. Fix F-L14 (registry-driven ingest) + add response-quality logging. Cheapest item on the list, compounds return on coordinator escalation rate. Run in window A.
- **`security_layer` (30 → 70% planning)** — planning + scaffold of audit table + `requireCapability` middleware + secrets indirection. Prereq for everything else in T3. Run in window B in parallel; full build is ~3 days but the planning doc + table can land in 1.

**Then (sequential, leverage-ordered):**

3. **`sandbox` (0 → 60%)** — ~2 days. Worktree primitive already exists in `.claude/worktrees/`; harden it into `runInSandbox()` + add fs-diff capture + timeout enforcement. Gated on security_layer planning being signed off.
4. **`arms_legs` (30 → 70%)** — ~3 days. Unify scattered fs/shell/HTTP/browser into `lib/harness/arms-legs/*` with capability checks. Unblocks chat_ui.
5. **`telegram_outbound` (50 → 80%)** — ~1 day. Inline keyboard for deploy_gate + improvement_loop in production. Removes Colin friction on approvals.
6. **`specialized_agents` (40 → 70%)** — ~2 days. Write `reviewer.md`, `planner.md`, `deployer.md`. Enforce capability scopes per role. Closes the "everyone has root" problem.
7. **`self_repair` (0 → 50%)** — ~3 days. Sentry → drafted fix → sandbox run → PR. Hard-gated on (3) and full security_layer.
8. **`push_bash_automation` (0 → 50%)** — ~2 days. Hard-gated on (3) and full security_layer.
9. **`debate_consensus` (10 → 50%)** — ~1 day. Wire `/stochastic-consensus` into acceptance-doc approval and deploy_gate.
10. **`chat_ui` (0 → 30%)** — ~1 week. Largest scope. Gated on `arms_legs` (4) and `digital_twin` (1). Tracked separately in `docs/orb-readiness.md`.
11. **`ollama_daytime` (50 → 80%)** — ~2 days. Daytime tick + work-routing.

If everything in this list ships at the targets above, projected rollup ≈ 78%.

---

## Migration plan — APPROVED, executing

1. **Migration `0043_harness_foundation_renormalize.sql`** — single migration that:
   - DELETEs the 24 current rows from `harness_components`.
   - INSERTs the 21 approved rows (T1+T2+T3+T4 = 4+5+8+4).
   - CREATEs `product_components` table with identical schema + RLS.
   - INSERTs 7 rows into `product_components` (preserving existing weights as a starting point; product weight rebalance is a follow-on).
2. **Update `tests/harness/rollup.test.ts`** — replace the "18 components from 0032 seed give ~84.6%" regression test with the new "21 components give 55.7%" baseline.
3. **No code change needed in `lib/harness/rollup.ts`** — the math is unchanged; it normalizes by `SUM(weight_pct)` so it works with any weight distribution that sums to 100.
4. **`app/status/page.tsx` unaffected** — verified: it queries via `getComponentsWithHealth()` with no hard-coded slugs.
5. **Per-component folder migration (deferred)** — moving `lib/harness/*.ts` files into `lib/harness/{component}/` is a separate cleanup pass; not blocking.
6. **Update `memory/harness_tracker.md`** — replace the old 9-row table with a one-line pointer to this doc (follow-on, not part of 0043).
7. **`computeProductRollup()` (follow-on)** — sibling function to `computeHarnessRollup()`; surfaced in morning_digest as a second line. Not part of 0043.

---

## Acceptance criteria — SIGNED OFF (2026-04-28)

- [x] **Component list** — 21 harness rows, 7 product rows, approved as drafted.
- [x] **Weights** — sum to 100 after smoke_test_framework rebalance (T2: 3+3+3+4+3 = 16).
- [x] **Completion %** — partial rows accepted as drafted.
- [x] **Collapse mapping** — three collapses approved (coordinator*\*, twin*_, telegram\__).
- [x] **Product split** — approved with finalized membership.
- [x] **Priority order** — digital_twin elevated to #1 in parallel with security_layer.

This doc is authoritative. Migration 0043 is being written from it.

---

## Working agreement reminders (per kickoff)

- Specs first, code second.
- No padding. Honest numbers. If completion is 30%, say 30%.
- Acceptance tests written before building.
- Doc-as-source: this file is authoritative; the table follows.
