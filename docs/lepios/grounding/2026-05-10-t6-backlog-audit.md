# T6 Parked Backlog — Phase 0 Audit

**Date:** 2026-05-10  
**Branch:** feat/rollup-t6-parked-backlog  
**Sources consumed:** master-rollup.md, feature_backlog.md (memory), docs/harness/PENDING_ADDITIONS.md, task_queue (live query — 40 open rows)  
**Status:** Phase 0 complete — awaiting Colin go-signal before Phase 1 build

---

## 1. Naming Conflict: T6/T7 Already in Use

Current `master-rollup.md` has two unweighted sections below the rollup table:

| Existing label                | Content                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `T6 — Life Tracks`            | USA move, Tesla API, Edge injury insurance                                |
| `T7 — Parked/Future Products` | 8 product ideas (legal tool, permit pre-screener, dev_market_intel, etc.) |

The user's requested "T6 Parked Backlog" would collide with the existing T6 name if added as a new _weighted_ track.

**Proposed resolution for Phase 1:**

- Rename existing unweighted `T6 — Life Tracks` → `L1 — Life Tracks`
- Rename existing unweighted `T7 — Parked/Future Products` → absorbed into new weighted T6 (its content folds in)
- New weighted T6 = `T6 — Parked Backlog` (covers all parked features: products, infrastructure, enhancements, harness automation)

---

## 2. Full Parked Feature Inventory

28 items total, grouped by tier. Initial state: all `parked` (0% resolved).

### Tier A — Standalone Product Ideas (6 items)

| ID  | Item                                                                            | Source                              | Notes                                    |
| --- | ------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| A1  | AI Amazon seller legal tool (suspensions, appeals, PoA drafts)                  | master-rollup T7, feature_backlog   | High-value if business grows             |
| A2  | AI building permit pre-screener (Edmonton zoning/bylaw lookup)                  | master-rollup T7, feature_backlog   |                                          |
| A3  | dev_market_intel — Keepa for dev work (Upwork/Toptal/Fiverr pricing intel)      | master-rollup T7, PENDING_ADDITIONS | Hard: no public completed-job data feeds |
| A4  | Internal status page (per-component uptime, 90-day history bars)                | feature_backlog                     |                                          |
| A5  | AI Control Center governance dashboard (agent audit trail, capability grant UI) | master-rollup T7, feature_backlog   |                                          |
| A6  | GitHackers (GitHub trending / HN jobs — unclear; park until resurfaced)         | PENDING_ADDITIONS, master-rollup T7 | Name only, no spec                       |

### Tier B — Data & Infrastructure (7 items)

| ID  | Item                                                                              | Source                              | Notes                                   |
| --- | --------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| B1  | Ollama Analyst System Prompt (files prepared, waiting Colin go-signal)            | feature_backlog                     | Files exist at lib/llm/ + infra/ollama/ |
| B2  | Daily Gmail Scanner (receipts/invoices/statements foundation)                     | feature_backlog                     | Blocks T-003 Receipts                   |
| B3  | Training pipeline — LoRA fine-tune 7B on LepiOS corpus                            | master-rollup T7, PENDING_ADDITIONS | Gates on GPU + 6-mo corpus              |
| B4  | Arbitrage training corpus (structured reselling decision capture)                 | master-rollup T7, PENDING_ADDITIONS | ~10% started                            |
| B5  | Square webhook ingestion (in-person sales via Colin's Square terminal)            | PENDING_ADDITIONS                   | Captured 2026-05-01                     |
| B6  | Custom MCP server for LepiOS (Supabase schema + harness as Claude Code tools)     | PENDING_ADDITIONS                   | Closes paste-loop bottleneck            |
| B7  | CI/CD pipeline (GitHub Actions PR-level CI — currently ~20%: Vercel + husky only) | PENDING_ADDITIONS                   | Independent of local env                |

### Tier C — Feature Enhancements, Post-Sprint Parked (9 items)

| ID  | Item                                                                                 | Source                                | Notes                                 |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------- |
| C1  | prompt-patterns skill at .claude/skills/prompt-patterns/                             | feature_backlog                       |                                       |
| C2  | Chunk D v2 — Statement Coverage Grid (Gmail-based)                                   | feature_backlog, task_queue #a169f782 | task_queue entry exists: queued       |
| C3  | Personal Spending view (separate surface for personal accounts)                      | task_queue #abac1bac                  | queued priority 5                     |
| C4  | Tesla auto-valuation button on Net Worth page                                        | feature_backlog                       | "Estimate current value" on Tesla row |
| C5  | Add/delete row on Net Worth page                                                     | feature_backlog                       | Currently SQL-only                    |
| C6  | Currency-aware balances on Net Worth (USD positions ~$163 under-reported at 1.37 FX) | feature_backlog                       |                                       |
| C7  | FBA inventory live-pull for Net Worth (currently manual $10k entry)                  | feature_backlog                       |                                       |
| C8  | Amazon pending live-pull for Net Worth (stale Mar-31 values)                         | feature_backlog                       |                                       |
| C9  | Edge injury insurance follow-up                                                      | feature_backlog, master-rollup T6     | Personal/life track                   |

### Tier D — Harness Automation (6 items)

| ID  | Item                                                                      | Source                            | task_queue ID | Notes                          |
| --- | ------------------------------------------------------------------------- | --------------------------------- | ------------- | ------------------------------ |
| D1  | harness_approval_listener (auto-fire builder on task_queue=approved)      | task_queue                        | #57ef5c6a     | priority 2, awaiting_grounding |
| D2  | Watchdog monitor (detect silent stalls + alert)                           | task_queue                        | #ac4c57df     | awaiting_grounding             |
| D3  | Auto-approve acceptance docs when Twin confidence > 80%                   | task_queue                        | #b6055674     | queued                         |
| D4  | Auto-resume continuous mode when quota refreshes after halt               | task_queue                        | #1fb70813     | queued                         |
| D5  | F18 ceiling metric layer (ceiling cause + lift cost per module dashboard) | task_queue                        | #a3de7bed     | awaiting_grounding priority 3  |
| D6  | Tesla developer API access follow-up                                      | feature_backlog, master-rollup T6 | —             | Personal/life track            |

**Total: 28 items (A: 6, B: 7, C: 9, D: 6)**

---

## 3. Proposed Schema: Option B — Doc-Based (parked-backlog.md)

Same pattern as `docs/gpu-day-readiness.md` / T5. One markdown file, machine-readable header, hand-editable per item.

### Doc path

```
docs/standing/parked-backlog.md
```

### Machine-readable anchor (parser regex)

```
## Backlog Progress: XX.X / 100
```

Regex: `/##\s+Backlog Progress:\s*([\d.]+)\s*\/\s*100/`

Same regex shape as T5's `## Total Readiness:` — parseable by a single `readFileSync` call.

### Per-item states and scoring

Each item carries a `status` field on the same line or in a trailing parenthetical:

| State       | Score contribution | Meaning                                          |
| ----------- | ------------------ | ------------------------------------------------ |
| `parked`    | 0                  | In the list, not started, not explicitly dropped |
| `active`    | 0.5                | Has a task_queue entry or is in an active sprint |
| `delivered` | 1                  | Shipped to production                            |
| `dropped`   | 1                  | Explicitly decided not to build (with reason)    |

**T6% = (sum of scores / total items) × 100**

Starting state: all 28 items = `parked` → **T6% = 0.0**

As items are shipped or deliberately dropped, the score climbs toward 100%.

### Why option B vs option A (DB-based)

- T5 (doc-based) already proven in the pipeline
- Parked backlog changes slowly — no benefit to DB row-per-item overhead
- Human-editable: Colin can flip a status in one line without SQL
- Parser failure falls back to `lastKnownFromEvents()` same as T5

---

## 4. Proposed Weights

### Constraint

T6 weight = 10% (as specified). Existing tracks scale by 0.9 to preserve ∑=100%.

### New weight table

| Track     | Old weight | New weight | Label                    |
| --------- | ---------- | ---------- | ------------------------ |
| T1        | 20%        | **18%**    | Autonomous Harness       |
| T1b       | 5%         | **4.5%**   | Product Components       |
| T2        | 40%        | **36%**    | Amazon Business          |
| T3        | 5%         | **4.5%**   | Local Sales              |
| T4        | 15%        | **13.5%**  | Streamlit Port Inventory |
| T5        | 15%        | **13.5%**  | GPU Day Readiness        |
| **T6**    | —          | **10%**    | **Parked Backlog**       |
| **Total** | 100%       | **100%**   |                          |

Note: T1b, T3, T4 become non-integer (4.5, 4.5, 13.5). The rollup formula handles floats natively — not a problem. Alternatively round to integers: T1b→5, T3→5, T1→17, T4→14, T5→14, T6→10 = 101 or similar — rounding errors worse. Keep as floats.

---

## 5. Rollup Impact

### Current strategic rollup (T5 now at 96%, per PR #231)

Approx current track values used:

- T1: 100% (harness memory: all 21 components 100%, verified 2026-05-05)
- T1b: 88% (from AUTO-ROLLUP section)
- T2: 56.1% (from AUTO-ROLLUP section)
- T3: 0% (from AUTO-ROLLUP section)
- T4: 0% (from AUTO-ROLLUP section; stale — recent port work not yet reflected)
- T5: 96.0% (PR #231 corrected value)

**Before T6 (current corrected):**

```
20×1.00 + 5×0.88 + 40×0.561 + 5×0 + 15×0 + 15×0.96
= 20.0 + 4.4 + 22.44 + 0 + 0 + 14.4
= 61.24%
```

**After adding T6 at 0% (Phase 1 ship day):**

```
18×1.00 + 4.5×0.88 + 36×0.561 + 4.5×0 + 13.5×0 + 13.5×0.96 + 10×0
= 18.0 + 3.96 + 20.2 + 0 + 0 + 12.96 + 0
= 55.12%
```

**Drag = -6.1 points** (from 61.2 → 55.1).

This is intentional: T6 starts at 0% and creates a pull toward clearing the backlog. As items are shipped or dropped, T6% climbs and recovers the drag. Full recovery (T6=100%) would restore to ≈64.1%.

### Break-even point

T6 needs to reach ~61% for the strategic rollup to match current (pre-T6) level:

- `10 × 0.61 = 6.1` points → exactly offsets the scaling drag
- That means 17/28 items delivered or dropped.

---

## 6. Rollup Script Changes Needed (Phase 1)

1. **New file:** `scripts/rollup/sources/t6-parked-backlog.ts`
   - `DOC_PATH` → `docs/standing/parked-backlog.md`
   - Regex: `/##\s+Backlog Progress:\s*([\d.]+)\s*\/\s*100/`
   - `strategic_weight_pct: 10`
   - `lastKnownFromEvents()` fallback (same pattern as T5)

2. **Edit:** `scripts/rollup/compute.ts`
   - Import `computeT6` from `./sources/t6-parked-backlog`
   - Add to `Promise.all()` array
   - Add to `tracks` array

3. **Edit:** `scripts/rollup/render-master-rollup.ts`
   - Add T6 to the weight table rendered in the AUTO-ROLLUP fence
   - Add T6 digest line

4. **Edit:** `docs/standing/master-rollup.md`
   - In the weights table: update T1/T1b/T2/T3/T4/T5 to new values; add T6 row
   - Rename `T6 — Life Tracks` → `L1 — Life Tracks`
   - Remove `T7 — Parked/Future Products` (content absorbed into `docs/standing/parked-backlog.md`)

5. **New file:** `docs/standing/parked-backlog.md`
   - All 28 items from §2 above
   - Machine-readable header: `## Backlog Progress: 0.0 / 100`
   - Per-item state column

6. **Run rollup refresh** via `POST /api/admin/rollup/refresh` — rewrites AUTO-ROLLUP fence.

---

## 7. Open Questions for Colin

1. **Drag accepted?** Adding T6 at 0% drops strategic rollup from ~61% to ~55%. Is that the right tradeoff, or should T6 start at partial credit (e.g., "acknowledged + tracked" = 30%)?

2. **Naming conflict resolution accepted?** Renaming existing T6→L1 (Life Tracks) and absorbing T7 into new T6?

3. **28 items feels right?** Any obvious additions or things that should NOT be in the parked-backlog doc?

4. **Tier D (harness automation) belongs here?** D1–D6 have task_queue entries — they're technically queued, not just parked ideas. Alternatively, exclude Tier D and let task_queue track those, making T6 = product/feature ideas only (22 items).

---

_Grounding manifest: master-rollup.md (read), feature_backlog.md memory (read), PENDING_ADDITIONS.md (read), task_queue live query (40 rows), t5-gpu-day.ts (read for pattern), compute.ts (read for pattern)._
