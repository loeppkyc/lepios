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

### T-002 — Safety Agent

- **Inventory row:** `harness-safety-agent`
- **Status:** queued
- **Build priority:** 2 (multiplier — closes AD2 barrier so T-001 + the prestage auto-merge from PR #133 can flip on)
- **Current %:** 0
- **Done %:** 100

**done_state:** Sub-agent invoked by coordinator on every PR before deploy gate. Runs: secret-scanning, schema-impact analysis (migration safety), test coverage delta, scope-creep check (LOC vs plan), known-failure pattern match against `failures_log`. Returns PASS / WARN / BLOCK with reasoning. BLOCK halts merge; WARN appends to PR + telegram; PASS auto-merges when all gates green.

**metric:** false-block rate vs missed-issue rate

**benchmark:** <5% false-blocks, 0 missed criticals over 30-day window

**surface:** PR comments, telegram on BLOCK, `decisions_log` row per invocation

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

### T-004 — PageProfit / Amazon Scanner

- **Inventory row:** `cockpit-scan` + `pageprofit-scanner` (same module from two angles)
- **Status:** queued
- **Build priority:** 3 (parallel with T-003, T-005)
- **Current %:** 10
- **Done %:** 100

**done_state:** `/scanner` accepts ASIN or Amazon URL, fetches SP-API + Keepa, computes landed cost (purchase + prep + shipping + FBA fees + referral), margin, ROI, BSR trend (90d/180d/365d), price history. Caches <6h data. Sourcing decision panel: GO / HOLD / SKIP using Colin's tier rules (high-demand tier 1, collectible tier). Bulk scan accepts CSV of ASINs, returns ranked list.

**metric:** GO/HOLD/SKIP agreement vs Colin's manual decision

**benchmark:** ≥90% agreement across 50-item sample

**surface:** cockpit nav → `/scanner`, telegram on bulk completion

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
