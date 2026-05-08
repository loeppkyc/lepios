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

### T-001 — Coordinator v1 remote invocation

- **Inventory row:** `coordinator-agent`
- **Status:** queued
- **Build priority:** 1 (multiplier — unlocks fire-and-forget for T-003 through T-005)
- **Current %:** 35
- **Done %:** 100

**done_state:** Coordinator invoked without Colin typing "Run task" in chat. Triggers: (1) telegram command `/run <task>` or `/run` from queue, (2) cron schedule for recurring sweeps (morning_digest, scheduled audits), (3) `/api/coordinator/fire` authenticated endpoint accepting task payload. Each invocation creates `window_session` row, runs harness, returns status to caller. Fire-and-forget — Colin gets telegram on completion, not start.

**metric:** % of coordinator runs that are remote-fired (no Colin chat involvement)

**benchmark:** ≥80% remote-fired over 7-day window

**surface:** telegram on completion, status dashboard live counter, `decisions_log` row per invocation

---

### T-002 — Safety Agent (REVISED 2026-05-08)

- **Inventory row:** `harness-safety-agent`
- **Status:** queued (description updated in `task_queue` row `edd5af72`)
- **Build priority:** 2 (multiplier — closes AD2 barrier so T-001 + the prestage auto-merge from PR #133 can flip on)
- **Current %:** 0
- **Done %:** 100

**done_state:** Sub-agent invoked by coordinator on every PR before deploy gate. Runs: secret-scanning, schema-impact analysis (migration safety), test coverage delta, scope-creep check (LOC vs plan), known-failure pattern match. Computes a **risk score 0–100** weighted across signals.

- **Risk <30 (low):** auto-merge → deploy → telegram only on a daily completion summary, **not per PR**.
- **Risk 30–70 (medium):** query digital twin with PR context + comparable past decisions → twin returns **PROCEED / HOLD / ESCALATE**.
  - PROCEED → auto-merge
  - HOLD → pause + `decisions_log` row + retry after 24h
  - ESCALATE → telegram Colin
- **Risk >70 (high):** skip twin, telegram Colin directly with risk breakdown + recommendation.

**Never** prompts for approval on commits, pushes, or bash commands within the autonomous loop. Only escalates the **final merge decision** when above threshold.

**metric:** % of merges completed without Colin involvement

**benchmark:** ≥95% of low+medium-risk autonomous; 100% high-risk escalated; **0 missed criticals** over a 30-day window

**surface:** telegram only on ESCALATE or daily summary; `decisions_log` row per invocation; status dashboard line: "today: X auto-merged, Y twin-cleared, Z escalated"

#### Sub-modules implied (coordinator will break these down at Phase 1c)

1. **Risk scorer** — pure function: signals → 0–100 score. Weights configurable in `harness_config`.
2. **Signal modules** (each emits a contribution to the score):
   - secret scanner (existing patterns + new: `.env.*`, key-shape regex)
   - schema-impact analyzer (additive vs destructive, F-N7 search-path coverage)
   - test coverage delta vs base branch
   - scope-creep checker (LOC delta vs `plan_loc` if present)
   - known-failure pattern match (regex against failures_log titles + bodies)
3. **Twin arbiter route** — `/api/twin/safety-arbitrate` accepts PR context + comparable-decisions query; returns PROCEED / HOLD / ESCALATE
4. **Comparable-decisions retrieval** — pgvector search over past `decisions_log` rows to find similar PRs and their outcomes
5. **Decision router** — pure function: score → low/medium/high → action
6. **HOLD retry-after-24h** — task_queue row created with run-after timestamp
7. **Daily summary digest** — adds line to `morning_digest` aggregating low-risk auto-merges
8. **Status dashboard counter** — live metric on `/autonomous` page

#### Notes for coordinator Phase 1a

- Replaces the simpler PASS/WARN/BLOCK design (original spec). Risk-scored + twin-arbiter is more nuanced and aligns with F19 (autonomous-share trending up).
- The twin arbiter requires Twin Q&A to be functional (`twin-qa` row in inventory: 68%) — twin must reliably handle PR-context queries before this layer activates. May need a sub-task to harden twin first.
- Risk-score weights: ASK COLIN at Phase 1b. They're calibration parameters and need his judgment for initial values (e.g., "secrets present = automatic high risk", "test coverage drop > 5% = +30 points").
- Threshold tuning will need a 7-day observe-only run before flipping `auto-merge` on. Same playbook as `DEPLOY_GATE_RISK_TIER` from PR #133.
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
- **BBV (kids book):** checks `bbv_inventory` by ISBN. If exists, increment count. If new, button creates new BBV listing.
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
7. **BBV dual-write** — ISBN check against `bbv_inventory`, increment-or-create flow ⚠️ open question below
8. **Donate logger** — minimal — just `scans.outcome='donate'`
9. **Per-pallet analytics** — acceptance rate, ROI, ranking dashboard on `/pallets`
10. **Active-pallet morning_digest line** — selects current pallet, computes today's stats

#### Open architectural question — BBV cross-system access

BBV is a **separate Supabase project** (`oolgsvhupxutpicxxjfw`, `brick-and-book-vault`) with **Stripe LIVE**. LepiOS lives on a different project (`xpanlbcjueimeofgsara`). Three options for the BBV dual-write:

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

## Build-order rationale

T-001 and T-002 are **multipliers** — they make the other three ship without Colin in the loop:

1. **T-001 (Coordinator remote)** — without it, every task still requires "Run task `<uuid>`" in chat. Build first so T-003/4/5 can execute overnight.
2. **T-002 (Safety Agent)** — without it, the prestage auto-merge from PR #133 stays flagged off (AD2 barrier). Build second so subsequent PRs can auto-merge low-risk diffs.
3. **T-003 / T-004 / T-005** — direct revenue and visibility wins. With T-001 and T-002 live, these can run in parallel coordinator windows overnight. Without them, ship one at a time by chat-paste.

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
