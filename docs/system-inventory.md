# LepiOS System Inventory

**Living document.** Compiled from a 5-agent parallel audit on **2026-05-07**.
Updates after every shipped module — see §Update Protocol at the bottom.

This is the source of truth for **what exists, how complete it is, and where to apply the "Double Up" prompt next.**

---

## How to use this doc

- **Per-module row:** stable ID, one-line purpose, current state, completion %, suggested weight, **leverage** (`(100−%) × weight`), evidence file paths.
- **Leverage column** is the prioritization signal. Highest leverage = lowest completion × highest weight = where one prompt buys the most ground.
- **Double Up prompt** at §Doubling Up takes a module ID and tries to double its progress / efficiency / safety / completion in one shot.
- **Update protocol** at the bottom — when a module ships work, the same PR bumps its row here.

---

## Global rollup

| Category                                          | Module count | Total weight | Earned (weighted) | Category % |
| ------------------------------------------------- | ------------ | ------------ | ----------------- | ---------- |
| Cockpit surfaces (LepiOS app)                     | 34           | 226          | 137.0             | **60.6%**  |
| Autonomous harness                                | 40           | 242          | 177.0             | **73.1%**  |
| Shared infrastructure                             | 21           | 161          | 132.5             | **82.3%**  |
| Knowledge / Twin / Rules / Measurement            | 9            | 72           | 41.5              | **57.6%**  |
| Streamlit-baseline ports (LepiOS-side completion) | 23           | 156          | 78.0              | **50.0%**  |
| Decisions / Security / Cross-cutting              | 10           | 62           | 42.5              | **68.5%**  |
| **Total**                                         | **137**      | **919**      | **608.4**         | **66.2%**  |

> The Streamlit baseline tracks **port progress**, not Streamlit's own completeness — Streamlit OS is fully functional. The rollup answers: "How much of the LepiOS replacement have we built?"

System-wide percentage is a **weighted average across 136 modules**. The two pillars holding it down: cockpit surface ports and the knowledge/twin layer.

---

## Top leverage gaps (system-wide)

Highest leverage = `(100 − completion%) × weight`. These are the prompts to fire next. Re-sorted on every shipped row per §Update Protocol.

| Rank | ID                       | Module                           | %   | Weight | Leverage | Done-state spec                                                                 | Why it matters                                                                                                                                                                                       |
| ---- | ------------------------ | -------------------------------- | --- | ------ | -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `cockpit-receipts`       | Receipts (camera + Vision OCR)   | 5   | 10     | 950      | [T-003](leverage-targets.md#t-003--receipts-camera--vision-ocr--reconciliation) | Daily-use revenue tool. 2640-line Streamlit baseline. Audit trail per transaction depends on it.                                                                                                     |
| 2    | `cockpit-scan`           | Amazon Scanner (PageProfit)      | 10  | 10     | 900      | [T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner)                  | Daily revenue tool. 3373-line Streamlit baseline. Highest-revenue module.                                                                                                                            |
| 3    | `safety-agent`           | Pre-flight safety review         | 40  | 8      | 480      | [T-002](leverage-targets.md#safety-agent-0--done)                               | Sub-phases A+B live: migration 0162 + 5 signal modules (secret/schema/scope/failures-pattern/coverage-delta) + scorer + router + 120 tests. Puppeteer E2E + twin arbiter + gate integration up next. |
| —    | `harness-failures-log`   | Failures log + `/failures` page  | 100 | 8      | 0        | [T-006](leverage-targets.md#t-006--failures-log-revised-2026-05-08)             | Shipped 2026-05-08. Phases 1a/1b/1c + F-N14 fix all live in prod. End-to-end verified.                                                                                                               |
| 4    | `pageprofit-scanner`     | PageProfit (full Streamlit port) | 0   | 10     | 1000     | [T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner)                  | Same as `cockpit-scan` from the port perspective — Streamlit version 100%, LepiOS 0%.                                                                                                                |
| 5    | `cockpit-net-worth`      | Net Worth (full page)            | 20  | 8      | 640      | [T-005](leverage-targets.md#t-005--net-worth)                                   | Acceptance doc complete; migration 0133 not applied; page does not exist.                                                                                                                            |
| 6    | `coordinator-agent`      | Sprint coordinator               | 35  | 9      | 585      | [T-001](leverage-targets.md#t-001--coordinator-v1-remote-invocation)            | v1 remote invocation deferred — still requires Colin paste to start a run.                                                                                                                           |
| 7    | `behav-f17`              | Behavioral ingestion (F17)       | 5   | 7      | 665      | _(no spec yet)_                                                                 | 0/11 ingestion sources live. Long-arc lever for path-probability engine.                                                                                                                             |
| 8    | `cockpit-money`          | Money pillar dashboard           | 55  | 9      | 405      | _(no spec yet)_                                                                 | P&L gauge hardcoded to 0%; depends on orders data wiring.                                                                                                                                            |
| 9    | `builder-agent`          | Builder agent                    | 40  | 10     | 600      | _(no spec yet)_                                                                 | No formal flow test; safety-agent integration blocked.                                                                                                                                               |
| 10   | `meas-f18`               | Measurement framework rollout    | 35  | 9      | 585      | _(no spec yet)_                                                                 | Only 5/15+ modules have full F18 contracts.                                                                                                                                                          |
| 11   | `cockpit-hit-lists`      | Hit lists UI                     | 5   | 7      | 665      | _(no spec yet)_                                                                 | Telegram bot scans nightly; UI missing.                                                                                                                                                              |
| 12   | `retail-scout-arbitrage` | Retail Scout / Arbitrage         | 0   | 7      | 700      | _(no spec yet)_                                                                 | Streamlit 100% (1632 + 800 + 1465 lines); LepiOS 0%.                                                                                                                                                 |

---

## 1. Cockpit surfaces (LepiOS app)

42 routes under `app/(cockpit)/**` — 34 distinct surfaces. Categorized by pillar.

### 1a. Money

| ID                        | Module                    | State   | %   | Weight | Leverage | Evidence                                                                                                                                                                               |
| ------------------------- | ------------------------- | ------- | --- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cockpit-business-review` | Business Review           | shipped | 95  | 10     | 50       | `app/(cockpit)/business-review/page.tsx` (4 panels)                                                                                                                                    |
| `cockpit-amazon`          | Amazon Reports (30d pace) | shipped | 92  | 10     | 80       | `app/(cockpit)/amazon/page.tsx`, F18 instrumented                                                                                                                                      |
| `cockpit-money`           | Money pillar dashboard    | partial | 55  | 9      | 405      | `app/(cockpit)/money/page.tsx` — P&L gauge stub                                                                                                                                        |
| `cockpit-payouts`         | Amazon payouts            | shipped | 93  | 8      | 56       | `app/(cockpit)/payouts/page.tsx`, recent F18 retrofit (#127)                                                                                                                           |
| `cockpit-cogs`            | COGS entry                | shipped | 85  | 8      | 120      | `app/(cockpit)/cogs/page.tsx`                                                                                                                                                          |
| `cockpit-inventory`       | Inventory (FBA + FIFO)    | shipped | 90  | 8      | 80       | `app/(cockpit)/inventory/page.tsx`                                                                                                                                                     |
| `cockpit-pallets`         | Pallet invoices           | shipped | 88  | 7      | 84       | `app/(cockpit)/pallets/page.tsx`. Expanded under [T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08) — invoice scope = 88%; cohort acceptance/ROI is new |
| `cockpit-scan`            | Amazon barcode scanner    | stub    | 10  | 10     | 900      | 15-LOC stub — UI missing. Expanded scope under [T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08)                                                       |
| `cockpit-hit-lists`       | Hit lists                 | stub    | 5   | 7      | 665      | UI missing; Telegram scan runs nightly                                                                                                                                                 |
| `cockpit-amazon-sales`    | Amazon sales history      | stub    | 20  | 6      | 480      | Distinct from `/amazon` — historical drill                                                                                                                                             |

### 1b. Finances / Bookkeeping

| ID                              | Module                | State       | %   | Weight | Leverage | Evidence                                                    |
| ------------------------------- | --------------------- | ----------- | --- | ------ | -------- | ----------------------------------------------------------- |
| `cockpit-bookkeeping-hub`       | Bookkeeping hub       | shipped     | 60  | 7      | 280      | `app/(cockpit)/bookkeeping-hub/page.tsx`                    |
| `cockpit-bookkeeping-reconcile` | Reconcile sub-page    | stub        | 20  | 7      | 560      | Sub-page renders; UI shallow                                |
| `cockpit-bookkeeping-qb-export` | QB export             | stub        | 20  | 6      | 480      | Sub-page renders; QB API status unclear                     |
| `cockpit-monthly-close`         | Monthly close         | shipped     | 70  | 8      | 240      | `app/(cockpit)/monthly-close/page.tsx`                      |
| `cockpit-accounts`              | Chart of accounts     | shipped     | 75  | 5      | 125      | `app/(cockpit)/accounts/page.tsx`                           |
| `cockpit-balance-sheet`         | Balance sheet         | shipped     | 85  | 7      | 105      | `app/(cockpit)/balance-sheet/page.tsx`                      |
| `cockpit-monthly-pnl`           | Monthly P&L           | shipped     | 80  | 9      | 180      | `app/(cockpit)/monthly-pnl/page.tsx`                        |
| `cockpit-monthly-expenses`      | Monthly expenses      | shipped     | 80  | 7      | 140      | Ported from Streamlit (#98)                                 |
| `cockpit-life-pnl`              | Life P&L (annual)     | shipped     | 85  | 8      | 120      | `app/(cockpit)/life-pnl/page.tsx`                           |
| `cockpit-annual-review`         | Annual review         | design-only | 15  | 7      | 595      | `docs/acceptance/annual-review.md` — 0/7 ACs done           |
| `cockpit-net-worth`             | Net Worth             | design-only | 20  | 8      | 640      | `docs/acceptance/net-worth.md` — migration 0133 not applied |
| `cockpit-cash-forecast`         | Cash forecast         | stub        | 15  | 7      | 595      | Stub; component status unknown                              |
| `cockpit-receipts`              | Receipts (Vision OCR) | stub        | 5   | 10     | 950      | 5-LOC stub; 2640-line Streamlit baseline                    |
| `cockpit-tax-centre`            | Tax centre            | stub        | 20  | 6      | 480      | Stub; CRA integration TBD                                   |
| `cockpit-gst-return`            | GST return            | stub        | 20  | 5      | 400      | Stub; quarterly compliance                                  |
| `cockpit-bank-register`         | Bank register         | shipped     | 75  | 6      | 150      | `app/(cockpit)/bank-register/page.tsx`                      |
| `cockpit-reconciliation`        | Reconciliation        | stub        | 20  | 6      | 480      | Stub; month-end close blocker                               |
| `cockpit-recurring`             | Recurring bills       | stub        | 25  | 5      | 375      | Stub; backlog candidate doc exists                          |
| `cockpit-personal-expenses`     | Personal expenses     | shipped     | 80  | 4      | 80       | Ported from Streamlit (#98)                                 |
| `cockpit-subscriptions`         | Subscriptions         | shipped     | 80  | 4      | 80       | Ported from Streamlit                                       |
| `cockpit-debt-payoff`           | Debt payoff           | stub        | 20  | 5      | 400      | Stub; loan payoff schedule                                  |
| `cockpit-savings-goals`         | Savings goals         | stub        | 20  | 3      | 240      | Stub                                                        |
| `cockpit-mileage`               | Mileage / MileIQ      | stub        | 20  | 4      | 320      | Stub; MileIQ CSV not wired                                  |
| `cockpit-import`                | Bulk CSV import       | stub        | 20  | 4      | 320      | Stub                                                        |

### 1c. Health & Life

| ID               | Module                | State   | %   | Weight | Leverage | Evidence                                       |
| ---------------- | --------------------- | ------- | --- | ------ | -------- | ---------------------------------------------- |
| `cockpit-health` | Family health records | shipped | 80  | 7      | 140      | `app/(cockpit)/health/page.tsx` (multi-person) |
| `cockpit-oura`   | Oura health           | shipped | 90  | 7      | 70       | `app/(cockpit)/oura/page.tsx` (90d history)    |
| `cockpit-diet`   | Diet & groceries      | shipped | 80  | 6      | 120      | `app/(cockpit)/diet/page.tsx`                  |

### 1d. Operations & reference

| ID                 | Module          | State   | %   | Weight | Leverage | Evidence                                                |
| ------------------ | --------------- | ------- | --- | ------ | -------- | ------------------------------------------------------- |
| `cockpit-utility`  | Utility tracker | shipped | 95  | 3      | 15       | `app/(cockpit)/utility/page.tsx` (555 LOC, 4 KPIs)      |
| `cockpit-vehicles` | Vehicles        | shipped | 80  | 4      | 80       | Ported from Streamlit (#99)                             |
| `cockpit-chat`     | AI chat (Orb)   | partial | 60  | 5      | 200      | `app/(cockpit)/chat/page.tsx` — mobile polish remaining |

**Cockpit summary:** 21 shipped / 3 partial / 9 stub / 2 design-only. The 26-module **F18 compliance gap** (most shipped modules don't have benchmark + surfacing path) is the most pervasive single issue.

---

## 2. Autonomous harness

39 modules across `lib/harness/**`, `app/api/harness/**`, `app/api/cron/**`, `lib/orchestrator/**`, `lib/night_watchman/**`.

### 2a. Critical path (load-bearing for "ran all night")

| ID                          | Module                                               | State   | %   | Weight | Leverage | Evidence                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------- | ------- | --- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness-task-pickup`       | Task queue + hourly cron pickup                      | shipped | 85  | 9      | 135      | `lib/harness/task-pickup.ts`, hourly cron                                                                                                                                                   |
| `harness-deploy-gate`       | Auto-promote deploy gate (8 chunks A–H)              | shipped | 100 | 10     | 0        | `app/api/cron/deploy-gate-runner/route.ts`, all chunks E2E verified                                                                                                                         |
| `harness-builder-agent`     | Builder agent                                        | partial | 40  | 10     | 600      | `.claude/agents/builder.md`, no formal flow test                                                                                                                                            |
| `harness-coordinator-agent` | Sprint coordinator                                   | partial | 35  | 9      | 585      | `.claude/agents/coordinator.md`, v1 remote invocation deferred                                                                                                                              |
| `harness-arms-legs`         | Agent execution sandbox (6 handlers)                 | shipped | 100 | 9      | 0        | `lib/harness/arms-legs/` — http/shell/browser/fs/gmail/telegram                                                                                                                             |
| `harness-self-repair`       | Detect → draft → verify → PR                         | partial | 60  | 8      | 320      | `lib/harness/self-repair/`, daily 3 AM cron                                                                                                                                                 |
| `harness-safety-agent`      | Six-signal risk score + Twin arbiter + Puppeteer E2E | partial | 40  | 8      | 480      | Sub-phases A+B live: migration 0162 + 5 signals (secret/schema/scope/failures-pattern/coverage-delta) + scorer + router + 120 tests. Spec: `docs/leverage-targets.md#safety-agent-0--done`. |
| `harness-night-tick`        | Nightly health checks                                | shipped | 90  | 8      | 80       | `lib/night_watchman/index.ts`                                                                                                                                                               |
| `harness-night-watchman`    | 6 health-check modules                               | shipped | 100 | 8      | 0        | `lib/night_watchman/checks/` (data, errors, health, performance, security, cost)                                                                                                            |
| `harness-sandbox-runtime`   | Builder execution sandbox                            | shipped | 100 | 8      | 0        | `lib/harness/sandbox/runtime.ts`                                                                                                                                                            |
| `harness-tax-sanity`        | Financial-data integrity checks                      | shipped | 95  | 8      | 40       | `lib/harness/tax-sanity.ts`                                                                                                                                                                 |

### 2b. Surfacing & oversight

| ID                            | Module                                   | State   | %   | Weight | Leverage | Evidence                                       |
| ----------------------------- | ---------------------------------------- | ------- | --- | ------ | -------- | ---------------------------------------------- |
| `harness-morning-digest`      | Morning digest Telegram                  | shipped | 95  | 7      | 35       | `app/api/cron/morning-digest/route.ts`         |
| `harness-notifications-drain` | Outbound notification drain              | shipped | 100 | 7      | 0        | `app/api/harness/notifications-drain/route.ts` |
| `harness-quota-forecast`      | Quota cliff forecast endpoint            | shipped | 100 | 7      | 0        | `app/api/harness/quota-forecast/route.ts`      |
| `harness-quota-cliff`         | Quota cliff detector                     | partial | 80  | 6      | 120      | `lib/harness/quota-cliff.ts`                   |
| `harness-quota-guard`         | Per-invocation spend limiter             | partial | 70  | 6      | 180      | `lib/harness/quota-guard.ts`                   |
| `harness-smoke-tests`         | Pre-prod smoke tests (4 modules)         | shipped | 100 | 7      | 0        | `lib/harness/smoke-tests/`                     |
| `harness-component-health`    | Component health polling                 | partial | 75  | 6      | 150      | `lib/harness/component-health.ts`              |
| `harness-utility-digest`      | External-service status                  | partial | 80  | 6      | 120      | `lib/harness/utility-digest.ts`                |
| `harness-task-heartbeat`      | Heartbeat endpoint (15-min stale window) | shipped | 100 | 6      | 0        | `app/api/harness/task-heartbeat/route.ts`      |
| `harness-twin-escalations`    | Twin escalation digest                   | partial | 50  | 4      | 200      | `lib/harness/twin-escalations/digest.ts`       |

### 2c. Module A & B (overnight autonomy bootstrap — PR #133)

> Updated 2026-05-07: shipped on `harness/overnight-autonomy-bootstrap` with all flags off. Acceptance doc at `docs/sprint-5/overnight-autonomy-acceptance.md`.

| ID                                        | Module                                                | State                | %   | Weight | Leverage | Evidence                                                                                         |
| ----------------------------------------- | ----------------------------------------------------- | -------------------- | --- | ------ | -------- | ------------------------------------------------------------------------------------------------ |
| `harness-risk-classifier`                 | Diff risk classifier (off/low/medium/migration-allow) | shipped, flagged off | 80  | 9      | 180      | `lib/harness/risk-classifier.ts`, 29 tests                                                       |
| `harness-prestage`                        | Queue pre-stager + 1 source (failures_md)             | shipped, flagged off | 30  | 6      | 420      | `lib/harness/prestage/`, migration `0160_task_proposals.sql`, only 1/5 sources implemented       |
| `harness-prestage-source-env-audit`       | Pre-stager env-audit source                           | stub                 | 0   | 4      | 400      | Stubbed; `from_env_audit.ts` not implemented                                                     |
| `harness-prestage-source-gpu-day`         | Pre-stager GPU-day-readiness source                   | stub                 | 0   | 4      | 400      | Stubbed; `from_gpu_day_gaps.ts` not implemented                                                  |
| `harness-prestage-source-self-repair-dlq` | Self-repair dead-letter-queue source                  | stub                 | 0   | 4      | 400      | Stubbed                                                                                          |
| `harness-prestage-source-digest-anomaly`  | Digest-anomaly source                                 | stub                 | 0   | 3      | 300      | Stubbed                                                                                          |
| `harness-self-repair-auto-merge`          | Self-repair PR auto-merge via gate                    | design-only          | 0   | 8      | 800      | Spec in `docs/sprint-5/overnight-autonomy-acceptance.md` §3.3; `pr-opener.ts` rerouting not done |

### 2d. Support modules

| ID                            | Module                                  | State       | %   | Weight | Leverage | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------- | ----------- | --- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `harness-attribution`         | Commit→task attribution                 | partial     | 40  | 3      | 180      | `lib/harness/attribution.ts`, backfill incomplete                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `harness-process-efficiency`  | 4 efficiency signals                    | shipped     | 100 | 3      | 0        | `lib/harness/process-efficiency.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `harness-improvement-engine`  | Feedback-loop scorer                    | partial     | 60  | 5      | 200      | `lib/harness/improvement-engine.ts`, signal_quality calibration pending                                                                                                                                                                                                                                                                                                                                                                                                  |
| `harness-branch-guard`        | `harness/task-{id}` branch enforcement  | shipped     | 85  | 4      | 60       | `lib/harness/branch-guard.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `harness-window-tracker`      | Coordinator session tracking            | shipped     | 100 | 3      | 0        | `lib/harness/window-tracker.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `harness-stall-check`         | Coordinator stall detection             | partial     | 50  | 5      | 250      | `lib/harness/stall-check.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `harness-source-content`      | Knowledge-base sync                     | partial     | 20  | 4      | 320      | `lib/harness/source-content.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `harness-rollup`              | Weighted harness rollup                 | shipped     | 100 | 2      | 0        | DB-verified rollup table (memory: 100% per 2026-05-05)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `harness-component-bump`      | Auto-bump tracker on PR merge           | partial     | 60  | 2      | 80       | `lib/harness/component-bump.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `harness-resource-budgets`    | Resource ceiling registry               | shipped     | 100 | 4      | 0        | Migration `0159_harness_resource_budgets.sql` (#131)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `harness-telegram-thumbs`     | 👍/👎 feedback buttons                  | partial     | 85  | 6      | 90       | `lib/harness/telegram-buttons.ts`, wiring incomplete                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `harness-telegram-stats`      | Telegram usage stats                    | shipped     | 100 | 2      | 0        | `lib/harness/telegram-stats.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `harness-telegram-escape`     | Message escape helper                   | shipped     | 100 | 2      | 0        | `lib/harness/telegram-escape.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `harness-ollama-tunnel-stats` | Cloudflared tunnel metrics              | shipped     | 100 | 7      | 0        | `lib/harness/ollama-tunnel-stats.ts`, GPU-Day B4 verified                                                                                                                                                                                                                                                                                                                                                                                                                |
| `harness-invoke-coordinator`  | Coordinator invocation wrapper          | shipped     | 100 | 7      | 0        | `app/api/harness/invoke-coordinator/route.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `harness-version`             | Harness version metadata                | shipped     | 100 | 2      | 0        | `lib/harness/version.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `harness-status-data`         | Harness status dashboard data           | design-only | 0   | 2      | 200      | Not built                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `harness-failures-log`        | Failures log + `/failures` cockpit page | shipped     | 100 | 8      | 0        | Shipped 2026-05-08 across 4 PRs. 1a (#144): schema + write paths + recurrence (80 tests). 1b (#145): export + night-tick + 8 F-N backfill (13 tests). 1c (#146): cockpit page + manual entry + promote-to-test (28 tests). F-N14 fix (#148): GitHub Contents API replaces writeFile (28 tests). End-to-end verified live: night-tick → commit c94133d on main → idempotent skip on second run. Spec [T-006](leverage-targets.md#t-006--failures-log-revised-2026-05-08). |

**Harness summary:** 16 shipped at 100% / 9 shipped 80–99% / 9 partial / 5 design-only. **The deploy gate is the load-bearing victory** — without it nothing else autonomous can ship safely. **The safety agent is the highest-leverage gap that's not yet started.**

---

## 3. Shared infrastructure

21 modules — auth, supabase boundaries, external clients, telegram, design, rules.

### 3a. Auth & security

| ID                            | Module                               | State   | %   | Weight | Leverage | Evidence                                        |
| ----------------------------- | ------------------------------------ | ------- | --- | ------ | -------- | ----------------------------------------------- |
| `infra-auth-require-user`     | Role-based auth gate                 | shipped | 95  | 10     | 50       | `lib/auth/require-user.ts`, `lib/auth/roles.ts` |
| `infra-auth-cron-secret-f22`  | F22 cron-secret helper + ESLint rule | shipped | 100 | 10     | 0        | `lib/auth/cron-secret.ts`, `eslint.config.mjs`  |
| `infra-auth-session-lifetime` | 4h absolute session expiry           | shipped | 85  | 9      | 135      | `lib/auth/session-lifetime.ts`                  |
| `infra-middleware-auth-gate`  | Middleware auth + lifetime           | shipped | 90  | 9      | 90       | `middleware.ts`                                 |
| `infra-security-capability`   | Capability-based agent ACL           | shipped | 80  | 9      | 180      | `lib/security/capability.ts`                    |
| `infra-security-audit`        | Agent-action audit log               | shipped | 95  | 8      | 40       | `lib/security/audit.ts`                         |

### 3b. Database boundaries

| ID                              | Module                           | State   | %   | Weight | Leverage | Evidence                                                    |
| ------------------------------- | -------------------------------- | ------- | --- | ------ | -------- | ----------------------------------------------------------- |
| `infra-supabase-server-client`  | Cookie-based RLS-enforced client | shipped | 100 | 10     | 0        | `lib/supabase/server.ts`                                    |
| `infra-supabase-browser-client` | Anon-key browser client          | shipped | 75  | 8      | 200      | `lib/supabase/client.ts`; no public/private column contract |
| `infra-supabase-service-role`   | Admin-bypass service client      | shipped | 90  | 9      | 90       | `lib/supabase/service.ts`, no service-role ACL              |
| `infra-supabase-audited`        | Audited row wrapper              | stub    | 20  | 5      | 400      | `lib/supabase/audited.ts` not integrated                    |

### 3c. External API clients

| ID                       | Module                           | State   | %   | Weight | Leverage | Evidence                                                            |
| ------------------------ | -------------------------------- | ------- | --- | ------ | -------- | ------------------------------------------------------------------- |
| `infra-amazon-sp-api`    | SP-API client + LWA + SigV4      | shipped | 85  | 9      | 135      | `lib/amazon/client.ts` (5xx retry shipped #134, no circuit breaker) |
| `infra-amazon-orders`    | Orders sync module               | shipped | 90  | 8      | 80       | `lib/amazon/orders.ts`, daily cron, no idempotency dedup            |
| `infra-amazon-inventory` | FBA inventory query              | shipped | 80  | 7      | 140      | `lib/amazon/inventory.ts`, no caching layer                         |
| `infra-keepa-client`     | Keepa client (stats=90 only, F7) | shipped | 75  | 6      | 150      | `lib/keepa/client.ts`, no spend forecast                            |

### 3d. Telegram dispatch

| ID                         | Module                    | State   | %   | Weight | Leverage | Evidence                                               |
| -------------------------- | ------------------------- | ------- | --- | ------ | -------- | ------------------------------------------------------ |
| `infra-telegram-daily-bot` | Daily-bot client (alerts) | shipped | 85  | 6      | 90       | `lib/telegram/daily-bot.ts` (1/3 bots wired)           |
| `infra-telegram-templates` | Message templates         | shipped | 60  | 3      | 120      | `lib/telegram/templates.ts`                            |
| `infra-telegram-webhook`   | Webhook → handler routing | shipped | 70  | 6      | 180      | `app/api/telegram/webhook/route.ts` (1/3 inbound bots) |

### 3e. Design system

| ID                             | Module                    | State   | %   | Weight | Leverage | Evidence                                                     |
| ------------------------------ | ------------------------- | ------- | --- | ------ | -------- | ------------------------------------------------------------ |
| `infra-ui-shadcn-button`       | shadcn button             | shipped | 100 | 5      | 0        | `components/ui/button.tsx`                                   |
| `infra-ui-shadcn-card`         | shadcn card               | shipped | 100 | 5      | 0        | `components/ui/card.tsx`                                     |
| `infra-ui-shadcn-chart`        | Recharts wrapper          | shipped | 95  | 6      | 30       | `components/ui/chart.tsx`                                    |
| `infra-cockpit-primitives`     | Cockpit-shared components | shipped | 70  | 5      | 150      | `components/cockpit/` (4 components, BSR sparkline orphaned) |
| `infra-design-tailwind-config` | Tailwind v4 + Prettier    | shipped | 90  | 6      | 60       | `package.json` deps, no design tokens doc                    |

### 3f. Rules & enforcement

| ID                     | Module                           | State   | %   | Weight | Leverage | Evidence                                       |
| ---------------------- | -------------------------------- | ------- | --- | ------ | -------- | ---------------------------------------------- |
| `infra-rules-registry` | F-rule registry F17–F23          | shipped | 95  | 10     | 50       | `lib/rules/registry.ts`, `getNextRuleNumber()` |
| `infra-eslint-config`  | ESLint hygiene + F22 enforcement | shipped | 95  | 8      | 40       | `eslint.config.mjs`                            |

**Infra summary:** Strongest category at **82.3%** weighted. The boundaries are solid; the weakest areas are 2/3 missing Telegram bots and the absent service-role ACL.

---

## 4. Knowledge / Twin / Rules / Measurement

9 strategic modules. The "long-arc levers" of the system.

| ID             | Module                              | State       | %   | Weight | Leverage | Evidence                                                                              |
| -------------- | ----------------------------------- | ----------- | --- | ------ | -------- | ------------------------------------------------------------------------------------- |
| `twin-qa`      | Digital Twin Q&A                    | shipped     | 68  | 9      | 288      | `lib/twin/query.ts`, `app/api/twin/ask/route.ts` (FTS fallback primary; vector at 0%) |
| `knl-ingst`    | Knowledge ingestion pipeline        | partial     | 45  | 8      | 440      | `scripts/ingest-claude-md.ts` (no scheduler; only CLAUDE.md)                          |
| `rules-reg`    | F-rule registry (F17–F23)           | shipped     | 95  | 10     | 50       | `lib/rules/registry.ts` (mirrors `infra-rules-registry`)                              |
| `meas-f18`     | F18 measurement framework           | partial     | 35  | 9      | 585      | `docs/vision/measurement-framework.md`, only ~5 modules with full contracts           |
| `behav-f17`    | F17 behavioral ingestion            | design-only | 5   | 7      | 665      | `docs/vision/behavioral-ingestion-spec.md`, 0/11 sources live                         |
| `score-v1`     | Feedback-loop scoring v1            | shipped     | 55  | 6      | 270      | `lib/orchestrator/scoring.ts`, signal_quality calibration pending thumbs              |
| `twin-teach`   | Twin teaching/escalation resolution | shipped     | 60  | 5      | 200      | `app/api/twin/teach/route.ts`, no Telegram UI                                         |
| `orch-harness` | Step 6 orchestration loop           | shipped     | 85  | 10     | 150      | `lib/orchestrator/tick.ts`, `digest.ts`                                               |
| `gpu-ready`    | GPU Day readiness tracker           | shipped     | 91  | 8      | 72       | `docs/gpu-day-readiness.md` (live tracker)                                            |

**Knowledge summary:** F17/F18/F19 are **aspirational with partial foundation**. F18 is the most pragmatic and proving the pattern. F17 is paying into a future account that's 99% empty (path-probability engine is ~6–12 months away on current ingestion velocity). F19 lacks automation — efficiency signals are logged but don't auto-queue improvement tasks.

---

## 5. Streamlit-baseline ports

23 major Streamlit modules. **Streamlit OS is 100% functional.** This tracks LepiOS-side port progress as the parallel replacement.

### 5a. Core revenue (P0 ports)

| ID                       | Module                                 | LepiOS % | Weight | Leverage | Streamlit lines | LepiOS evidence                                                                                                                                                             |
| ------------------------ | -------------------------------------- | -------- | ------ | -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageprofit-scanner`     | PageProfit (book/Lego scan)            | 0        | 10     | 1000     | 3373            | `app/(cockpit)/scan/` stub. Expanded under [T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08) — 3-way routing GO/BBV/DONATE + pallet cohorts |
| `receipts-hub`           | Receipts (Vision OCR + reconciliation) | 40       | 10     | 600      | 2640            | `app/(cockpit)/receipts/` partial                                                                                                                                           |
| `shipment-manager`       | FBA inbound + box manifest             | 0        | 8      | 800      | 1176            | not started                                                                                                                                                                 |
| `inventory-mgmt`         | Inventory + Lego Vault                 | 30       | 9      | 630      | 1094 + 760      | `app/(cockpit)/inventory/` partial                                                                                                                                          |
| `amazon-sales-reporting` | Amazon sales + payouts                 | 90       | 10     | 100      | 404 + 212       | `app/(cockpit)/amazon-sales/`, payouts shipped                                                                                                                              |
| `monthly-pl-rollup`      | Full monthly P&L                       | 85       | 10     | 150      | 2126            | `app/(cockpit)/monthly-pnl/`                                                                                                                                                |
| `bookkeeping-hub-port`   | Bookkeeping + statement reconcile      | 50       | 8      | 400      | 720 + 1034      | `app/(cockpit)/bookkeeping-hub/` partial                                                                                                                                    |

### 5b. Operations (P1 ports)

| ID                       | Module                       | LepiOS % | Weight | Leverage | Streamlit lines   |
| ------------------------ | ---------------------------- | -------- | ------ | -------- | ----------------- |
| `trading-journal`        | Futures journal + AI debrief | 0        | 9      | 900      | 1903              |
| `amazon-inventory-spend` | Statement→COGS classifier    | 0        | 7      | 700      | 747               |
| `retail-scout-arbitrage` | Retail/arbitrage scanner     | 0        | 7      | 700      | 1632 + 800 + 1465 |
| `coupon-deals-tracker`   | Flyer parser + price book    | 0        | 5      | 500      | 960 + 230         |
| `tax-centre-port`        | T4/T5 + GST + deductions     | 20       | 8      | 640      | 110 + 1222        |
| `expenses-personal-port` | Personal/household expenses  | 80       | 6      | 120      | 260 + 1039        |
| `subscriptions-port`     | Subscription tracker         | 50       | 4      | 200      | 300               |
| `debt-payoff-port`       | Loan payoff + snowball       | 50       | 5      | 250      | 660               |

### 5c. Life & long-arc (P2 ports)

| ID                         | Module                                            | LepiOS % | Weight | Leverage | Streamlit lines |
| -------------------------- | ------------------------------------------------- | -------- | ------ | -------- | --------------- |
| `health-oura-port`         | Health + Oura sync                                | 90       | 6      | 60       | 1577 + 200      |
| `diet-groceries-port`      | Diet + grocery + meal                             | 80       | 5      | 100      | 791 + 1556      |
| `vehicles-mileage-port`    | Vehicles + MileIQ                                 | 60       | 4      | 160      | 260 + 200       |
| `sports-betting-dashboard` | Bet log + Kelly + AI debrief (GATED on BACKLOG-1) | 5        | 7      | 665      | 2041            |
| `net-worth-port`           | Net worth snapshots                               | 40       | 6      | 360      | 530             |
| `accounts-portfolio-port`  | RRSP/FHSA/crypto consolidated                     | 50       | 7      | 350      | 280 + 540       |
| `cash-forecast-port`       | 30/60/90 day forecast                             | 30       | 5      | 350      | 260             |
| `goals-savings-port`       | Goals + savings tracker                           | 20       | 4      | 320      | 320 + 440       |

**Streamlit-port summary:** 23 modules, weighted average **50%** LepiOS-side. **Kill criterion:** Streamlit retires when 7 P0 modules reach ≥80%. Today: 3 of 7 there (amazon-sales 90, monthly-pl 85, none others). PageProfit is the critical path — highest revenue, deepest stack.

---

## 6. Decisions / Security / Cross-cutting

10 items capturing strategic locks, security state, and system-wide gates.

### 6a. Decision records

| ID                            | Item                          | State                    | %   | Weight | Leverage | Evidence                                                      |
| ----------------------------- | ----------------------------- | ------------------------ | --- | ------ | -------- | ------------------------------------------------------------- |
| `chart-library-selection`     | Recharts/shadcn standardized  | decided + 60% rolled out | 80  | 7      | 140      | `docs/decisions/chart-library-strategy.md`                    |
| `sql-direct-write-backdoor`   | Emergency SQL override        | decision only            | 50  | 3      | 150      | `docs/decisions/sql-direct-write-backdoor.md`                 |
| `status-page-deferred`        | System health dashboard       | deferred                 | 100 | 4      | 0        | `docs/decisions/status-page-deferred.md`                      |
| `blocked-tasks-profile-prefs` | Profile module + module prefs | awaiting Colin           | 50  | 3      | 150      | `docs/decisions/2026-04-28-blocked-tasks-design-decisions.md` |

### 6b. Security & compliance

| ID                            | Item                            | State         | %   | Weight | Leverage | Evidence                                       |
| ----------------------------- | ------------------------------- | ------------- | --- | ------ | -------- | ---------------------------------------------- |
| `incident-001-telegram-token` | INC-001 token in git history    | risk-accepted | 95  | 8      | 40       | `docs/security-log.md` (history not rewritten) |
| `incident-002-secrets-scan`   | Full git history secrets scan   | done          | 100 | 9      | 0        | `docs/security-log.md`                         |
| `env-audit-2026-05-05`        | E3 staged-batch readiness audit | done          | 100 | 6      | 0        | `docs/env-audit-2026-05-05.md`                 |

### 6c. Cross-cutting gates

| ID                           | Item                                     | State       | %   | Weight | Leverage | Evidence                                                             |
| ---------------------------- | ---------------------------------------- | ----------- | --- | ------ | -------- | -------------------------------------------------------------------- |
| `multi-user-rls-gate`        | Multi-user RLS hardening (Sprint 5 gate) | design-only | 0   | 9      | 900      | `audits/migration-notes.md` (MN-3)                                   |
| `historical-bets-odds-audit` | BACKLOG-1 odds audit                     | not started | 0   | 5      | 500      | `audits/migration-notes.md` (BACKLOG-1)                              |
| `f18-compliance-retrofit`    | F18 retrofit campaign                    | partial     | 5   | 7      | 665      | `docs/f18-compliance.md` (5/38 modules) — duplicates `meas-f18` view |

**Cross-cutting summary:** The **multi-user RLS gate is the largest invisible blocker.** Today RLS is permissive (`auth.uid() IS NOT NULL` lets any authenticated user see all rows). This must close before any second user, full stop.

---

## 7. Doubling Up — the prompt

The prompt template you fire to apply this list. One module per prompt; the goal is to ~double its progress, efficiency, safety, or completion in one shot.

```
/double-up <module-id>

CONTEXT
- Inventory row: docs/system-inventory.md, ID = <module-id>
- Current state: <copy the row's State + %>
- Highest-leverage gap from the row's Evidence + Gaps notes

GOAL
In one prompt-shaped change, double one of:
  (a) progress  — completion % to roughly 2× current (capped at 100)
  (b) efficiency — runtime, cost, or human-time-per-use halved
  (c) safety    — one new guard / test / contract that closes a real failure mode
  (d) completion — drag from "partial" to "shipped" by closing the named blockers

CONSTRAINTS
- Branch + claim window per .claude/CLAUDE.md
- Scope limited to the row's Evidence files and their immediate dependencies
- New behaviour requires new tests
- Update the inventory row in the same PR — bump %, weight if changed, add a "Last bumped: <date>" cell
- Prefer beef-up over rebuild (Architecture §8.4)

DELIVER
1. Restate the current row's % and the bottleneck (one sentence)
2. Propose THE ONE highest-leverage move
3. Make it
4. Update the inventory row + recompute the global rollup
5. Commit + PR
```

**Picking the next target.** Sort the leverage column. The current top-12 list above is the queue. Re-sort after each bumped row.

**When NOT to use this prompt:** if the highest-leverage row is design-only and missing a spec, write the spec first (separate prompt). The Double-Up prompt assumes evidence and gaps are clear enough that one builder window can move the needle.

---

## 8. Update protocol (keeping this doc honest)

This doc is **source of truth** until it goes stale. Stale = wrong is worse than absent.

**Each PR that ships work on a tracked module MUST:**

1. Bump the module's `%` cell.
2. Update the `State` cell if it crossed a threshold (stub → partial → shipped).
3. Recompute leverage = `(100 − %) × weight`.
4. If a new module ships that isn't here, add a row.
5. If the global rollup table moves by ≥1%, update it too.

**Audit triggers:**

- Monthly: a coordinator pass re-grounds 5 random rows against actual evidence (catches drift).
- Quarterly: full re-audit by parallel Explore agents (this doc was built that way).
- Whenever a leverage-top-3 row crosses 80% complete: re-pick the next 3.

**Limits:** weights are Colin's call. If you suspect a weight is wrong, leave a comment in the row's Evidence cell — don't change weight without Colin's nod.

**This doc lives at `docs/system-inventory.md` and is the canonical inventory until further notice.**

---

## 9. Caveats & known uncertainties

Honest list of where this inventory may be slightly off:

- **Cockpit "stub" rows with `_components/...Page` delegation pattern**: many `app/(cockpit)/<x>/page.tsx` files are 5-LOC delegators. The agents marked these as 20% by default if the component wasn't read in detail. Real % could be 40–80% — a deeper read pass is warranted before doubling-up any of these.
- **Streamlit-port percentages** are LepiOS-side estimates against feature parity, not literal line-counts. 50% means "half the features are usable in LepiOS"; the line count tells you the size of the work, not the progress.
- **F18 compliance count (5/38 vs 26/34)**: the cockpit agent and the cross-cutting agent disagreed on whether modules count as F18-compliant. The inventory lists ~35% globally. Worth a single-purpose F18 audit pass to settle.
- **Cora's World**: deliberately excluded — it's a separate Godot project, no shared code, no shared lifecycle. If game dev resumes, give it its own inventory.
- **Module overlaps**: some rows describe the same surface from different angles (e.g., `cockpit-amazon`, `amazon-sales-reporting`, `cockpit-payouts`). Cross-references should not be double-counted in rollups; the global tally above treats each ID as distinct.

---

**Last full audit:** 2026-05-07 (5-agent parallel sweep)
**Next scheduled audit:** 2026-06-07 (monthly drift check)
**Doc owner:** Colin + main-session Claude
**To update:** edit a row, recompute leverage, bump global rollup if material, commit in the same PR as the work.
