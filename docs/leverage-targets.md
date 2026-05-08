# LepiOS Leverage Targets

**Living document.** Companion to [`system-inventory.md`](system-inventory.md).

The inventory says **what exists** and ranks **leverage gaps**. This doc says **what "done" looks like** for each leverage target — F18-shaped (done_state + metric + benchmark + surface) so coordinator can build directly without re-deriving intent.

**Authoring rule:** Colin writes targets. Claude/coordinator implements them. The done-state contract is the spec.

---

## How a target moves

```
Active           → an inventory row is selected; Colin writes the done_state spec here
Queued           → row inserted into task_queue with this doc's path in metadata
In-flight        → coordinator/builder claimed the task
Shipped          → moved to Archive section; inventory row bumped to ≥80%
Superseded       → contract changed; new spec replaces it (old preserved in archive for audit)
```

Each target lists: ID, status, done_state, metric, benchmark, surface, and the inventory row it targets.

---

## Active targets — Top 5 (set 2026-05-08)

These are the top-5 leverage gaps from `system-inventory.md`'s leverage table. Build order is annotated by priority — multipliers first.

### T-001 — Coordinator remote invocation (v1 shipped 2026-05-08; v2 in-flight)

- **Inventory row:** `coordinator-agent`
- **Status:** v1 shipped 100% (PR #156, 2026-05-08). v2 continuous-mode additions in-flight.
- **Build priority:** 1 (multiplier — unlocks overnight autonomous runs)
- **Done %:** 100 (v2 target: continuous mode fully autonomous)

#### v1 done_state (shipped)

Coordinator runs without Colin typing in chat. Three triggers:

- **Telegram:** `/run <task>` fires single task; `/queue add <task>` adds to backlog; `/queue run` drains queue sequentially; `/halt` stops in-flight run; `/resume` re-enables.
- **Cron:** `task-pickup` cron at 16:00 UTC fires daily.
- **API:** `/api/coordinator/fire` (F22-compliant) accepts task payload, inserts into `task_queue`, kicks pickup. `/api/coordinator/complete` marks done + loop-to-next.

Loop-to-next: when one task finishes, coordinator picks next from queue without Colin involvement. `decisions_log` row per invocation. `/coordinator` cockpit page shows live queue. 25 tests green.

#### v2 done_state — continuous mode additions (spec 2026-05-08)

Three additions layered on top of v1:

**v2.1 — Self-prioritization mode**

`/run continuous` (and `/queue run continuous`) reads `docs/system-inventory.md`, ranks all modules by `weight × (1 − completion%)`, picks the top non-blocked, non-complete (<95%) target autonomously — no Colin input required. Inserts that module's task into `task_queue`, triggers pickup, logs pick reasoning (score, candidates considered, why chosen) to a `decisions_log` row. Skips modules where the "Why it matters" field contains the word "blocked" or where completion ≥ 95%.

**v2.2 — Done-state auto-draft**

When `/run continuous` picks a module that has no done_state entry in `docs/leverage-targets.md` §10 (shows "no spec yet" in system-inventory.md), the harness drafts a candidate done_state using the Anthropic API (context: Streamlit source grep, README, recent commits, schema tables). Appends to `docs/leverage-targets.md` under a new `### [module-id] — auto-drafted` section tagged `[auto-drafted YYYY-MM-DD, review on next inspection]`. If the module has zero context to draft from (no Streamlit source, no schema refs, no README), skips it, picks next highest-leverage target instead, and telegrams Colin the skip reason.

**v2.3 — Quota awareness**

Harness checks Anthropic API / Claude Code routines usage before each continuous-mode pickup. Check fires at task start AND at 10-minute intervals (stored in `coordinator_run_state.last_quota_check_at`). Configurable threshold via `harness_config` key `HARNESS_QUOTA_THRESHOLD` (default `85`). When usage crosses threshold: finishes current sub-phase (no mid-task kill), halts cleanly, persists run state to `coordinator_run_state` table (modules shipped, current target, quota pct), sets `HARNESS_HALTED=true`, telegrams summary (modules shipped this run, % movement, quota remaining, ETA to refresh). `/run continuous` and `/resume` both check `coordinator_run_state` for a preserved run and resume from the saved position.

**Schema additions (migration 0164):**

- `coordinator_run_state` table — tracks active/halted continuous runs (mode, status, modules_shipped[], current_target, quota_pct_at_halt, last_quota_check_at, timestamps)
- `harness_config` seeds: `HARNESS_QUOTA_THRESHOLD=85`, `HARNESS_CONTINUOUS_RUN_ID=`

**New lib files:**

- `lib/harness/auto-pick.ts` — inventory parser + ranker + decisions_log writer
- `lib/harness/done-state-drafter.ts` — context gatherer + Anthropic API drafter + leverage-targets.md appender
- `lib/harness/quota-monitor.ts` — usage poller + threshold check + halt writer

**Command changes:**

- `coordinator-commands.ts`: `handleRunCommand` detects 'continuous' keyword; `handleQueueRunCommand` accepts text arg for 'continuous' detection; `handleResumeCommand` checks coordinator_run_state for preserved state
- `app/api/coordinator/complete/route.ts`: quota check before loop-to-next when continuous run active
- `app/api/telegram/webhook/route.ts`: pass `txt` to `handleQueueRunCommand` for continuous detection

**metric:** modules shipped per continuous run without Colin touch; quota-halt rate

**benchmark:** ≥1 module picked and shipped autonomously per continuous run; 0 mid-task kills; quota halt telegrams delivered within 30s of threshold crossing

**surface:** Telegram on run-start (module picked + reasoning), on each task completion (module shipped + next target), on halt (summary); `coordinator_run_state` table queryable via cockpit; `decisions_log` row per pick; `docs/leverage-targets.md` updated with auto-drafted specs

**Integration test (CI gate for v2 ship):**

1. Fire `/run continuous` → assert `coordinator_run_state` created with top leverage module as `current_target`
2. Assert `decisions_log` row inserted with pick reasoning
3. For a module with no done_state, assert `docs/leverage-targets.md` updated with auto-drafted section
4. Set `HARNESS_QUOTA_THRESHOLD=1` → assert `coordinator_run_state.status='halted_quota'` + Telegram message logged

#### v2 sub-modules

1. **`coordinator_run_state` migration** — schema + harness_config seeds
2. **`lib/harness/auto-pick.ts`** — parse system-inventory.md top leverage table, rank, skip blocked/≥95%, return top pick + ranked list
3. **`lib/harness/done-state-drafter.ts`** — gather context (Streamlit grep, README, schema, commits), call Anthropic API, append to leverage-targets.md; skip + Telegram if no context
4. **`lib/harness/quota-monitor.ts`** — poll usage (routines 429 guard + harness_config token counters), compare to HARNESS_QUOTA_THRESHOLD, write halt state
5. **`coordinator-commands.ts` continuous mode** — detect `/run continuous` and `/queue run continuous`, call auto-pick, log to decisions_log, create coordinator_run_state row
6. **`complete/route.ts` quota gate** — before loop-to-next in continuous mode, call quota-monitor; halt + telegram if over threshold
7. **`webhook/route.ts` passthrough** — pass `txt` to `handleQueueRunCommand` for continuous detection
8. **Integration test** — four assertions covering pick, draft, halt, resume

#### Notes for v2

- Auto-pick reads system-inventory.md from filesystem (`process.cwd()`). On Vercel, the repo files are bundled — safe to read at runtime.
- Done-state drafter uses `ANTHROPIC_API_KEY` (already in Vercel env). Drafts at most once per module per run — idempotent check before drafting.
- Quota monitor checks `harness_config` token counters (HARNESS_QUOTA_TOKENS_USED / HARNESS_QUOTA_TOKENS_LIMIT) as primary signal. Falls back to routines 429 guard. Fails open — guard errors never block pickup.
- `/run continuous` never auto-starts a second continuous run if one is already active (check coordinator_run_state for status='running').
- Do not auto-fire `/run continuous` on v2 ship — Colin verifies everything first.

---

### Safety Agent (0% → done)

- **Inventory row:** `harness-safety-agent`
- **Status:** queued (description updated in `task_queue` row `edd5af72`)
- **Build priority:** 2 (multiplier — closes AD2 barrier so T-001 + the prestage auto-merge from PR #133 can flip on)
- **Current %:** 0
- **Done %:** 100
- **Spec version:** v2 (2026-05-08, overwrites previous T-002 spec). Triggered by F-N13 — autonomous UI verification gap surfaced during T-006 Phase 1c puppeteer attempt.

**done_state:** Sub-agent invoked by coordinator on every PR before deploy gate. Computes risk score 0–100 weighted across **six** signals:

1. Secret-scanning (token patterns, env leak detection)
2. Schema-impact analysis (migration safety, RLS coverage)
3. Test coverage delta (lines covered before vs after)
4. Scope-creep check (LOC vs plan)
5. Known-failure pattern match against `failures_log`
6. **Puppeteer E2E pass on the done_state's surface URL(s) — required, not optional**

**E2E flow:** builder runs puppeteer against the surface URL(s) specified in the module's done_state, executing user-visible interactions (page loads, form submits, button clicks, sort/filter actions, expected outcomes asserted). **E2E fail = automatic ESCALATE regardless of other signal scores.** E2E pass is required before risk score can clear auto-merge threshold.

**Risk routing:**

- **<30 (low) + E2E pass:** auto-merge → deploy → telegram on completion summary only
- **30–70 (medium) + E2E pass:** query `digital_twin` with PR context → twin returns **PROCEED / HOLD / ESCALATE**
  - PROCEED → auto-merge
  - HOLD → pause + `decisions_log` row + retry after 24h
  - ESCALATE → telegram Colin
- **>70 (high) OR E2E fail:** skip twin, telegram Colin directly with risk breakdown + puppeteer failure trace + recommendation

**Never** prompts for approval on commits, pushes, or bash commands within the autonomous loop. Only escalates the **final merge decision** when above threshold or E2E fails.

**metric:** % of merges completed without Colin involvement + E2E pass rate on first run

**benchmark:** ≥95% of low+medium-risk autonomous; 100% high-risk escalated; 0 missed criticals over 30-day window; **≥98% E2E pass on first run** for done_state-specced modules

**surface:** telegram on ESCALATE or daily summary; `decisions_log` row per invocation; status dashboard "today: X auto-merged, Y twin-cleared, Z escalated, W E2E-failed"; puppeteer screenshots/traces archived in `failures_log` when E2E fails

#### Initial calibration values (Q-003, 2026-05-08 — carried over from v1)

These ship in `harness_config`. Observe-only for 7 days, then tune. Same playbook as `DEPLOY_GATE_RISK_TIER` from PR #133.

| Signal                                                                         | Weight                 |
| ------------------------------------------------------------------------------ | ---------------------- |
| Secret detected (any)                                                          | +100 (auto-high)       |
| Migration with destructive ops (DROP, RENAME, NOT NULL on existing rows)       | +60                    |
| Migration additive only                                                        | +10                    |
| Test coverage drop > 5% vs base                                                | +30                    |
| Test coverage drop > 15% vs base                                               | +60                    |
| LOC delta > 2× planned                                                         | +20                    |
| Known-failure regex match against `failures_log` (per-pattern, top match wins) | +25 to +50             |
| Touches shared seam (`package.json`, `middleware.ts`, etc.)                    | +40                    |
| Touches `app/api/**` route handler net-new                                     | +15                    |
| **Puppeteer E2E fail on any specified surface URL**                            | **automatic ESCALATE** |
| All other signals quiet                                                        | base 5                 |

**Tier thresholds:** Low <30 · Medium 30–70 · High >70.

Weights + thresholds live in `harness_config` keys (`SAFETY_WEIGHT_*`, `SAFETY_THRESHOLD_*`).

#### Sub-modules implied (coordinator will break these down at Phase 1c)

1. **Risk scorer** — pure function: signals → 0–100 score
2. **Signal modules** — secret scanner, schema-impact analyzer, test coverage delta, scope-creep checker, known-failure pattern match against `failures_log`
3. **Puppeteer E2E runner** — given a list of surface URLs from done_state, drives them with a signed-in test user, captures screenshots/traces, asserts user-visible outcomes
4. **Test-user session provisioning** — service role creates a test Supabase user; runner caches the session cookie. Resolves the F-N13 gap (build sessions cannot puppeteer auth-gated cockpit pages today)
5. **Twin arbiter route** — `/api/twin/safety-arbitrate` accepts PR context + comparable-decisions query → PROCEED / HOLD / ESCALATE
6. **Comparable-decisions retrieval** — pgvector search over past `decisions_log` rows
7. **Decision router** — pure function: (score, e2e_pass) → action
8. **HOLD retry-after-24h** — task_queue row with run-after timestamp
9. **E2E failure archival** — on E2E fail, write to `failures_log` with screenshot path + trace, severity=critical, status=open
10. **Daily summary digest** — morning_digest line aggregating low-risk auto-merges + E2E pass rate
11. **Status dashboard counter** — `/autonomous` page metrics (auto-merged / twin-cleared / escalated / E2E-failed)

#### Notes for coordinator Phase 1a

- v2 changes from v1: **adds Puppeteer E2E as a 6th required signal**, with E2E fail = automatic ESCALATE regardless of other scores. Triggered by F-N13 finding during T-006 Phase 1c.
- Twin arbiter requires Twin Q&A functional (`twin-qa` row currently 68%) — twin must reliably handle PR-context queries before medium-tier activates.
- E2E runner needs a **test-user session strategy** (sub-module #4). This is the load-bearing new capability over v1 — without it, puppeteer can't drive auth-gated cockpit pages. Options: Supabase test-user with cached cookie, dev-mode auth bypass via `harness_config` flag, or magic-link-on-demand for the runner.
- Done_state's `surface` field becomes load-bearing: it now drives the E2E runner's URL list. Modules that misspecify surface URLs will see E2E run against the wrong target.
- Older Phase 1 task `9b9bca02` is marked completed in task_queue but inventory shows 0%. Phase 1a study should grep `lib/harness/safety/` for actual code before re-implementing.

---

### T-003 — Receipts (camera + Vision OCR + reconciliation)

- **Inventory row:** `cockpit-receipts`
- **Status:** queued
- **Build priority:** 3 (parallel with T-004, T-005 once T-001 and T-002 are live)
- **Current %:** 5
- **Done %:** 100

**done_state:** `/receipts` renders last 90 days of Amazon + non-Amazon receipts pulled from daily Gmail scanner, parsed into `receipt_lines` table (vendor, date, line_items[], total, tax, source_email_id, reconciled_bool). Reconciliation runs against bank/CC transactions, surfaces unmatched in cockpit. Sortable/filterable by vendor, date, amount, reconciled status. Bulk-reconcile UI for clearing matched.

**metric:** reconciliation rate

**benchmark:** ≥95% auto-matched within 7 days of receipt arrival

**surface:** cockpit nav → `/receipts`, `morning_digest` line: "X new receipts, Y unreconciled"

---

### T-004 — PageProfit / Amazon Scanner (REVISED 2026-05-08)

- **Inventory rows:** `cockpit-scan` + `pageprofit-scanner` + `cockpit-pallets` (expanded scope)
- **Status:** queued (description updated in `task_queue` row `896e2bb4`)
- **Build priority:** 3 (parallel with T-003, T-005)
- **Current %:** 10 (scanner) / 88 (pallets, but for invoice scope only)
- **Done %:** 100

**done_state:** `/scanner` runs as scanning station tied to an active pallet. Pallet records created on intake (`pallet_id`, source, date, cost; paid in batch end-of-month via AP table). Scan barcode → SP-API + Keepa → landed cost, margin, ROI, BSR trend, price history, tier classification (high-demand tier 1 / collectible tier / standard). Decision routes to one of three:

- **GO (Amazon):** triggers condition grading sub-flow (Vision OCR + Amazon condition standards), then one-click list into current open FBA shipment with auto-set price + condition.
- **BBV (kids book):** calls BBV's `POST /api/inventory/upsert-by-isbn` (Option B per Q-001). Endpoint upserts by ISBN, returns existing-vs-new state for scanner UX. If new, scanner shows "create new BBV listing" button.
- **DONATE (reject):** logged, moved on.

Every scan tagged with `pallet_id`. `/pallets` dashboard shows per-pallet acceptance rate (% scanned hit GO), pallet P&L (realized revenue from sold items − pallet cost share), and ranking across all pallets to surface best/worst sourcing.

**metric:** pallet acceptance rate + pallet-level ROI

**benchmark:** rank all pallets; surface top + bottom performers; Colin uses ranking to evaluate sourcing channels (no fixed target — relative comparison)

**surface:** cockpit nav → `/scanner` and `/pallets`, `morning_digest`: "Active pallet: X — Y scanned today, Z% accepted, $W projected ROI"

#### Sub-modules implied (coordinator will break these down at Phase 1c)

This target spans multiple discrete components. Listed here so the coordinator's Phase 1a study can scope each one:

1. **Pallet intake** — intake form, `pallets` table extension if needed, AP integration
2. **AP / accounts-payable table** — new schema for batch end-of-month payment workflow
3. **Scanner station** — barcode capture, SP-API + Keepa fetch, decision panel UI
4. **Tier classifier** — rule-based classification (high-demand tier 1 / collectible / standard); needs Colin's rules captured as data
5. **Condition grading sub-flow** — Claude Vision OCR pipeline against Amazon condition standards
6. **One-click FBA list** — current-open-shipment lookup, auto-set price + condition, push via SP-API
7. **BBV dual-write** — LepiOS calls BBV's `/api/inventory/upsert-by-isbn` route (Option B per Q-001 decision). BBV-side endpoint is a ~1-day add-on in the BBV repo: POST endpoint with F22 bearer-auth, idempotent upsert by ISBN, returns existing-vs-new state for scanner UX. LepiOS-side: thin client in `lib/bbv/client.ts` that holds a single `BBV_API_KEY` env var.
8. **Donate logger** — minimal — just `scans.outcome='donate'`
9. **Per-pallet analytics** — acceptance rate, ROI, ranking dashboard on `/pallets`
10. **Active-pallet morning_digest line** — selects current pallet, computes today's stats

#### Decided — BBV cross-system access (Q-001, 2026-05-08): **Option B**

LepiOS calls a BBV-side `POST /api/inventory/upsert-by-isbn` route with bearer auth (F22 cron-secret pattern). BBV controls its own writes; no shared service-role keys. BBV-side endpoint is a ~1-day add-on (route + auth + rate limit). LepiOS-side: thin client in `lib/bbv/client.ts` holds `BBV_API_KEY` env var.

For audit purposes, the original three options considered:

| Option                                 | How                                                                         | Pros                                | Cons                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| **A** Shared Supabase service-role key | LepiOS holds BBV's service-role secret; writes directly                     | Simple, low latency                 | Cross-LIVE-system blast radius — a LepiOS bug can corrupt a Stripe-LIVE storefront |
| **B** BBV exposes write API            | New `/api/inventory/upsert-by-isbn` route in BBV repo, called from LepiOS   | Clean boundary; BBV controls writes | Requires BBV-side work; auth/rate-limit needed                                     |
| **C** Webhook + queue                  | LepiOS writes to a queue (Supabase function or shared bucket), BBV consumes | Eventual consistency; isolated      | Most code; eventual semantics may surprise scanner UX                              |

**Recommendation:** B. Cleanest boundary, BBV controls its own writes, matches the existing F22 cron-secret auth pattern. Coordinator should confirm with Colin before Phase 1c.

#### Notes for coordinator Phase 1a

- The existing `/pallets` page (cockpit-pallets, currently 88% complete) tracks invoices + 12-month spend. The new dashboard responsibilities (acceptance rate, P&L ranking) are additive — don't replace the invoice form; extend.
- The existing `/scan` page (cockpit-scan, currently 10%) is a 15-LOC stub. This is where most of the new code lives.
- Streamlit baseline is `21_PageProfit.py` (3373 LOC) — port reference, not literal copy.
- Tier classification rules: ASK COLIN at Phase 1b. He has them; they're not in the codebase yet.
- Condition grading: Claude Vision quota implications — coordinator should call `/api/budget` before designing batch flows.

---

### T-005 — Net Worth

- **Inventory row:** `cockpit-net-worth`
- **Status:** queued
- **Build priority:** 3 (parallel with T-003, T-004)
- **Current %:** 20
- **Done %:** 100

**done_state:** `/net-worth` single-pane view: total net worth, breakdown by asset class (cash, brokerage, crypto, inventory at-cost, AR, real estate, vehicles), liabilities (CC, loans, GST owed, income tax accrual). Pulls from existing tables (transactions, inventory, business_review snapshots) + `manual_assets` table for non-API items. Sankey or stacked area showing 90-day trend. Migration applies `net_worth_snapshots` table for daily roll-up.

**metric:** snapshot freshness + asset class coverage

**benchmark:** daily snapshot ≤24h old, 100% of asset classes present

**surface:** cockpit nav → `/net-worth`, `morning_digest` line: "net worth: $X (+/- $Y vs yesterday)"

---

### T-006 — Failures Log (REVISED 2026-05-08)

- **Inventory row:** `harness-failures-log`
- **Status:** queued (description updated in `task_queue` row `ca95d54e`)
- **Build priority:** 2 (multiplier — feeds T-002's known-failure-pattern signal; ships in parallel with T-002)
- **Current %:** 0
- **Done %:** 100

**done_state:** `failures_log` table in Supabase + auto-exported markdown at [`docs/claude-md/failures.md`](claude-md/failures.md) linked from CLAUDE.md component #4. Every silent or surfaced failure recorded with: trigger context (workflow, PR, manual), expected vs actual behavior, root cause (filled post-analysis), fix commit sha, `pattern_signature` (jsonb fingerprint), severity, status (open / fixing / fixed / recurring), occurrence count, `last_seen_at`, **"lesson" field** (terse "what to do differently").

Self-repair and Safety Agent both write to it. Safety Agent reads it on every PR to pattern-match incoming changes against known signatures — flags risk if PR matches an open or recurring pattern.

**Cron syncs table → markdown nightly** (groups by status, sorts by severity, terse format: date / what happened / root cause / fix / lesson). CLAUDE.md component #4 references the markdown so every Claude Code session loads current failure context.

`/failures` cockpit page lists open + recurring at top, sortable, filterable, with one-click **"promote to harness test"** action (converts logged failure into integration test) and **"manual entry" form** for failures Colin catches that the system missed.

**metric:** pattern recurrence rate (same failure signature hitting twice after fix)

**benchmark:** <5% recurrence over rolling 30-day window; **0 critical-severity recurrences**; **100% of critical failures synced to markdown within 24h**

**surface:** cockpit nav → `/failures`, telegram on critical or recurring detection, `safety_agent` risk-routing input, **CLAUDE.md framework component #4 reference**, `morning_digest` line: "open failures: X, recurring: Y, fixed today: Z"

#### Sub-modules implied (coordinator will break these down at Phase 1c)

1. **Schema migration** — `failures_log` table with columns above (incl. `lesson` text); `pattern_signature` jsonb indexed for fast match
2. **Pattern signature builder** — pure function: `failure_context → jsonb` (e.g., `{type: "test-fail", file: "tests/foo.test.ts", error_class: "AssertionError", regex_match: "...", touched_files: [...]}`)
3. **Write path — self-repair integration** — `lib/harness/self-repair/` writes a row when detector + drafter run; status transitions handled by pipeline
4. **Write path — Safety Agent integration** — when Safety Agent BLOCKs or twin ESCALATEs, log a row capturing the signature
5. **Read path — Safety Agent matcher** — given an incoming PR's diff signature, query `failures_log` for matches → contributes to risk score (T-002 sub-module #2: known-failure regex match)
6. **Recurrence detector** — when a row's `pattern_signature` matches an existing `fixed` row, increment `occurrence_count`, flip status to `recurring`, fire telegram
7. **Markdown export cron** — nightly job reads `failures_log`, renders to `docs/claude-md/failures.md`. Groups: §Open · §Recurring · §Fixed (last 30 days). Per-row format: `### F-N{n} — <title>` followed by date, severity, what happened, root cause, fix commit, **lesson**. Idempotent (overwrites file). Critical failures sync within 24h (cron runs ≥daily).
8. **CLAUDE.md component #4 reference** — verify the existing pointer in `lepios/CLAUDE.md §9` to `docs/claude-md/failures.md` still works post-export; no edit needed if the file path stays the same
9. **`/failures` cockpit page** — list view with filters (status / severity / age), sort by `last_seen_at` and `occurrence_count`
10. **"Promote to harness test" action** — generates a stub `tests/regression/<pattern_signature_hash>.test.ts` from the failure context; coordinator polishes during Phase 4
11. **"Manual entry" form** — `/failures` page form Colin uses to log failures the system missed (POST `/api/failures/log` with hand-filled fields); auto-computes `pattern_signature` from form input

#### Notes for coordinator Phase 1a

- T-006 is a **dependency of T-002's known-failure regex match signal**. T-002 can ship first with that signal scoring 0; T-006 ships in parallel and the signal activates as `failures_log` populates.
- The **table is source of truth, markdown is render**. Existing hand-written F-N entries in `docs/claude-md/failures.md` need to be migrated into the table before the cron overwrites the file. One-time backfill script in Phase 4.
- `pattern_signature` design is the load-bearing part — too coarse and matches everything; too fine and matches nothing. Worth a Phase 1b twin Q&A on initial signature shape.
- Self-repair already writes to `agent_events` for failure detection; the integration is "also write a `failures_log` row" — additive, not replacement.
- The **CLAUDE.md auto-load** is the biggest leverage move: every new Claude Code session loads `docs/claude-md/failures.md` as part of context per `lepios/CLAUDE.md §9`. So the cron-export → CLAUDE.md → next session ingests context loop closes the F19 learn-from-failures cycle without manual transcription.
- "Promote to harness test" is the F19 lever — every fixed failure becomes a test that prevents recurrence. This is what closes the recurrence loop and drives the <5% benchmark.
- "Manual entry" form serves the case where Colin notices something the system missed (e.g., a UI regression caught visually that didn't trigger any agent_events row). Without it, those failures stay in his head and never feed the pattern matcher.

---

## Build-order rationale

**Multipliers** (priority 1–2) make the rest ship without Colin in the loop:

1. **T-001 (Coordinator remote)** — without it, every task still requires chat-paste. Build first so T-003/4/5/6 can execute overnight.
2. **T-002 (Safety Agent)** — without it, prestage auto-merge from PR #133 stays flagged off (AD2 barrier). Build second so subsequent PRs auto-merge low-risk diffs.
3. **T-006 (Failures Log)** — feeds T-002's known-failure-pattern signal. Ships in **parallel with T-002**; T-002 can launch with that signal scoring 0 and activate as `failures_log` populates.

**Direct revenue / visibility** (priority 3) — with multipliers live, these run in parallel coordinator windows overnight:

- **T-003 (Receipts)**, **T-005 (Net Worth)**, **T-004 (Scanner)** — fully unblocked except T-004 still waits on Q-002 (tier rules) for its classifier sub-module.

---

## How coordinator should consume this

When the pickup cron claims one of these tasks:

1. The `task_queue.metadata.leverage_target_id` field points back to this doc + section ID (e.g., `T-003`).
2. Coordinator's Phase 1a study reads the target's `done_state` + `metric` + `benchmark` + `surface` lines as the contract.
3. Phase 1b twin Q&A asks any clarifications against this spec, not against the user.
4. Phase 1c writes the formal acceptance doc using the contract above as the spec input.
5. Phase 4 hands the acceptance doc to builder.
6. On ship, this doc moves the target to **Archive** and bumps the inventory row.

This is the F-rule pattern: target = contract, acceptance doc = expansion, code = satisfaction.

---

## Archive — shipped targets

_(none yet — first batch authored 2026-05-08)_

---

## Update protocol

- **New target:** Colin writes a section under "Active targets" with done_state + metric + benchmark + surface. Coordinator does NOT invent these — only Colin writes contracts.
- **Status transitions:** Active → Queued (when row inserted into `task_queue`) → In-flight (when claimed) → Shipped (when merged + inventory bumped) → Archive.
- **Inventory link:** every target row in this doc references an inventory row by ID. The inventory row's `Done-state` cell links back here. One PR updates both.
- **Superseded contracts:** if Colin changes a done_state mid-flight, mark the old version "superseded" and preserve it in the Archive (audit trail for what we built and why).
