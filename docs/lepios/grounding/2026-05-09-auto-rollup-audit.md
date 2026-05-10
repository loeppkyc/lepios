# Auto-Rollup Audit — 2026-05-09

**Branch:** feat/auto-rollup
**Scope:** Phase 0 audit before building `computeHarnessRollup()` pipeline
**Snapshot baseline:** docs/standing/master-rollup.md last updated 2026-05-01 (8 days stale)
**Live queries run:** 2026-05-09 (Edmonton MT = UTC-6)

---

## 1 — master-rollup.md schema

Six tracks, two portfolio-wide numbers:

| Rollup          | Formula                                 | What it answers                             |
| --------------- | --------------------------------------- | ------------------------------------------- |
| **Strategic**   | `SUM(track_weight% × track_rollup%)`    | What to work on next — weighted by leverage |
| **Total scope** | `SUM(all_item_pcts) / total_item_count` | How much of everything is built             |

**Strategic track weights (must sum to 100%):**

| Track                       | Weight | Source                                   |
| --------------------------- | ------ | ---------------------------------------- |
| T1 — Autonomous Harness     | 20%    | `harness_components` DB                  |
| T1b — Product Components    | 5%     | `product_components` DB                  |
| T2 — Amazon Pipeline        | 40%    | `docs/lepios/amazon-pipeline-rollup.md`  |
| T3 — Local Sales            | 5%     | `docs/acceptance/local-sales-webhook.md` |
| T4 — Streamlit Port Backlog | 15%    | `streamlit_modules` DB                   |
| T5 — GPU Day Readiness      | 15%    | `docs/gpu-day-readiness.md`              |

**Total scope item counts (as of snapshot):**

| Track     | Items         | Formula role                                              |
| --------- | ------------- | --------------------------------------------------------- |
| T1        | 21 components | 21 rows × completion_pct each                             |
| T1b       | 7 components  | 7 rows × completion_pct each                              |
| T2        | 21 components | 21 rows × completion_pct each                             |
| T3        | 3 items       | 3 items × completion_pct each                             |
| T4        | 234 modules   | 234 rows × 0% (all pending)                               |
| T5        | 27 line items | 27 line items × completion_pct each                       |
| T6        | 3 items       | visible only, unweighted (excluded from total scope math) |
| T7        | 8 ideas       | 0% by design, included in total scope denominator         |
| **Total** | **324**       | denominator for Total scope                               |

---

## 2 — auto-rollup-scope.md review

Originally scoped on 2026-04-27. Current accuracy:

| Item                                                        | Status                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness_components` table name                             | **Correct** — table exists, schema matches                                                                                                      |
| Formula `SUM(weight_pct * completion_pct / 100.0)`          | **Correct** — confirmed live query returns 100.00                                                                                               |
| `product_components` table                                  | **Missing from original scope** — was split from harness_components via migration 0043 after the scope doc was written; T1b needs its own query |
| "DB foundation is absent" blocker                           | **Stale** — `harness_components` (0032) was applied and seeded long ago; the blocker no longer exists                                           |
| Day-over-day delta via `agent_events` `meta->>'rollup_pct'` | **Not yet wired** — no `rollup_computed` events exist in agent_events; delta will be null on first run                                          |
| Morning digest line                                         | **Infra exists** — `sendMorningDigest` already appends lines; slot is ready                                                                     |
| T2, T3, T5 tracks                                           | **Not mentioned in original scope** — scope doc only covered T1 (harness_components); the full 6-track pipeline was never designed              |

---

## 3 — Live source audit per track

### T1 — Autonomous Harness

**Source:** `harness_components` DB table
**Formula:** `ROUND(SUM(weight_pct * completion_pct / 100.0), 2)`
**Live query result (2026-05-09):** 100.00% (21 components, weight_sum=100)
**Snapshot (2026-05-01):** 61.63%
**Delta:** +38.37 points
**Automatable:** Yes — direct SQL query, no parsing needed
**Schema confirmed:** `id TEXT, display_name TEXT, weight_pct NUMERIC, completion_pct NUMERIC, notes TEXT, updated_at TIMESTAMPTZ`

### T1b — Product Components

**Source:** `product_components` DB table
**Formula:** `ROUND(SUM(weight_pct * completion_pct / 100.0) / SUM(weight_pct) * 100, 2)`
**Live query result (2026-05-09):**

| Component                           | weight_pct | completion_pct | pts        |
| ----------------------------------- | ---------- | -------------- | ---------- |
| Amazon settlements sync cron        | 4.00       | 100%           | 4.000      |
| Amazon orders sync cron             | 4.00       | 100%           | 4.000      |
| Pre-staged tasks tracker            | 2.00       | 66%            | 1.320      |
| Tax sanity check                    | 1.00       | 100%           | 1.000      |
| Streamlit module scanner            | 1.00       | 100%           | 1.000      |
| Amazon reports view                 | 1.00       | 0%             | 0.000      |
| Streamlit rebuild — Utility Tracker | 1.00       | 100%           | 1.000      |
| **Total**                           | **14.00**  |                | **12.320** |

**Live rollup:** 12.32 / 14.00 = **88.0%**
**Snapshot (2026-05-01):** 88.0%
**Delta:** 0 (unchanged)
**Automatable:** Yes — same SQL pattern as T1

### T2 — Amazon Pipeline

**Source:** `docs/lepios/amazon-pipeline-rollup.md` (markdown table, 21 rows)
**Live value (from doc, last updated 2026-05-01):** 56.1% (67.30/120)
**Snapshot (2026-05-01):** 56.1%
**Delta:** 0 (doc not updated since May 1 — no T2 PRs merged since then)
**Automatable:** Partially. The markdown table is structured consistently:
`| # | Component | Weight | % Complete | Contribution | Evidence |`
The `Contribution` column can be summed via regex/parse; denominator is fixed at 120.
**Risk:** % Complete values are manually set — parsing the doc gives the last-human-entered values, not live DB state. T2 has no DB backing table for component-level % — it is a human judgment doc. Auto-rollup for T2 = parse the doc. The number won't auto-update unless someone edits the doc.
**Decision needed:** accept T2 as "parse last-human-entered markdown" with a staleness timestamp shown, OR skip T2 parsing and surface "T2: doc-sourced, last updated DATE" without recomputing.

### T3 — Local Sales

**Source:** `docs/acceptance/local-sales-webhook.md`
**Live value:** 0% (acceptance doc written, not built)
**Snapshot (2026-05-01):** 0%
**Delta:** 0
**Automatable:** Binary. T3 has 3 items:

- Acceptance doc written → 25%
- Builder task assigned → 50%
- PR merged → 100%

The file exists (acceptance doc written). No task_queue row pointing to it → still 0% per the master-rollup definition ("track created, no builder task assigned yet"). Could auto-detect via: `SELECT COUNT(*) FROM task_queue WHERE metadata->>'acceptance_doc' LIKE '%local-sales%'`.
**Risk:** T3 is too sparse and small (5% weight) to warrant complex parsing. Recommend: hardcode 0% with "doc-sourced" flag; bump manually when a builder task is queued.

### T4 — Streamlit Port Backlog

**Source:** `streamlit_modules` DB table
**Formula (count-based):** `ROUND(100.0 * COUNT(*) FILTER (WHERE port_status = 'done') / COUNT(*), 1)`
**Formula (tier-weighted):** `SUM(CASE WHEN port_status='done' THEN suggested_tier ELSE 0 END)::float / NULLIF(SUM(suggested_tier), 0)`
**Live query result (2026-05-09):** 234 pending, 0 done, 0 in_progress → 0.0%
**Snapshot (2026-05-01):** 0%
**Delta:** 0 (structurally)

**Known staleness issue:** `feat/streamlit-modules-lock` (window 2) is building port_status sync. PageProfit is live on a branch (`feat/pageprofit-port`) but shows `port_status='pending'` in the table. T4 will deliberately under-count until the sync lands. This is **logged as a known limitation** — compute pipeline should surface it explicitly.

**Automatable:** Yes — SQL query. Two formulas available; tier-weighted is more informative (tier-4/5 modules count more). Recommend tier-weighted as primary, count-based as secondary.

Tier weight denominator: SUM(suggested_tier) = 542 (all pending). When modules ship, denominator stays at 542, numerator grows.

### T5 — GPU Day Readiness

**Source:** `docs/gpu-day-readiness.md`
**Live value:** 91.0/100 (from doc header: `## Total Readiness: 91.0 / 100`)
**Snapshot (2026-05-01 in master-rollup):** 71.0%
**Delta:** +20.0 points
**Automatable:** Yes — parse the header line `## Total Readiness: XX.X / 100` with regex. This is a deliberate machine-readable anchor in the doc.
**Category breakdown (parseable from section totals):**

- A (Ollama Pipeline): 21.25/25
- B (Harness Reliability): 29.70/30
- C (Doctrine + Docs): 15.00/15
- D (Staged Batch Readiness): 17.00/20
- E (Environment + Secrets): 8.00/10

---

## 4 — Live Strategic Rollup (recomputed 2026-05-09)

Using live T1/T1b values + unchanged T2/T3/T4 + live T5:

| Track                  | Weight   | Live %                | Contribution |
| ---------------------- | -------- | --------------------- | ------------ |
| T1 Autonomous Harness  | 20%      | **100.0%**            | 20.00        |
| T1b Product Components | 5%       | **88.0%**             | 4.40         |
| T2 Amazon Pipeline     | 40%      | 56.1% (doc-stale)     | 22.44        |
| T3 Local Sales         | 5%       | 0%                    | 0.00         |
| T4 Streamlit Port      | 15%      | 0% (known undercount) | 0.00         |
| T5 GPU Day             | 15%      | **91.0%**             | 13.65        |
| **Strategic total**    | **100%** |                       | **60.49%**   |

**vs. snapshot 2026-05-01:** 49.82%
**Delta: +10.67 points** (all from T1 +38.4 pts × 20% weight = +7.67, T5 +20.0 pts × 15% weight = +3.00)

---

## 5 — Design options

### Option A — Read-only compute + master-rollup.md patch (recommended)

**What it does:**

- `scripts/rollup/compute.ts` queries all automatable sources (T1, T1b, T4 from DB; T5 by parsing doc header; T2 by parsing markdown table; T3 hardcoded at 0%)
- Computes Strategic rollup + T4 tier-weighted %
- Returns `RollupReport` JSON with per-track values, timestamps, and staleness flags
- `scripts/rollup/render-master-rollup.ts` regenerates only the fenced `<!-- AUTO-ROLLUP:START --> … <!-- AUTO-ROLLUP:END -->` block in master-rollup.md
- Manual prose (track detail tables, history, Top 10 Leverage Sort) is preserved
- `POST /api/admin/rollup/refresh` for manual kick; nightly via night_tick
- F18: `agent_events` `rollup_computed` row after each run with `meta: { strategic_pct, delta_vs_prev, sources_polled, compute_ms }`
- Digest line: `Rollup: 60.5% strategic (+10.7 vs last run) · T1:100% T2:56.1% T4:0% T5:91.0%`

**Build cost:** ~4h. Entirely in `scripts/rollup/`, one new API route, one digest line.
**Risk:** Low. No DB schema changes. Doc parse is read-only except for the fenced block. Rollback = delete the scripts.

### Option B — Full pipeline: also write back % values into source docs

**What it does:** everything in Option A, plus updates `% Complete` cells in `docs/lepios/amazon-pipeline-rollup.md` from task_queue status, and updates `docs/gpu-day-readiness.md` line items from agent_events signals.

**Build cost:** ~12h. Requires defining update triggers for each doc (which task_queue rows map to which rows 11, 17, etc.).
**Risk:** Moderate. Overwrites hand-curated judgments in T2 doc. T2 % values are human editorial, not machine-derivable without domain rules.
**Recommendation:** Defer Option B. T2 is editorial — a PR merge doesn't automatically mean a % bump (see "caps at 70% for any unmerged component" rule). Build Option A first; revisit Option B when T2 has a DB-backed source.

---

## 6 — Known limitations to log in compute output

1. **T2 staleness:** amazon-pipeline-rollup.md is human-maintained. Auto-rollup parses its current state; it does not update it. Staleness timestamp shown in output.
2. **T3 zero-floor:** hardcoded at 0% until a task_queue row points to the acceptance doc. When that happens, update `computeT3()` to return 25%.
3. **T4 undercount:** `streamlit_modules.port_status` reflects scanner state at last run. PageProfit and any other ported modules show 'pending' until `feat/streamlit-modules-lock` lands a sync. Compute pipeline logs `t4_known_undercount: true` in the JSON output.
4. **T5 doc-parse brittleness:** if the `## Total Readiness: XX.X / 100` header line is reformatted, parse will fail. Fail-safe: on parse error, T5 falls back to last known value from agent_events; digest shows `T5: parse-error (last known: 91.0%)`.
5. **Delta on first run:** no prior `rollup_computed` event exists → delta shown as `null` (not 0).

---

## 7 — Phase 1 build plan (awaiting "go")

Files to create:

| File                                       | Purpose                                                        |
| ------------------------------------------ | -------------------------------------------------------------- |
| `scripts/rollup/compute.ts`                | Entry point — runs all 6 track queries, returns `RollupReport` |
| `scripts/rollup/sources/t1-harness.ts`     | SQL query for harness_components                               |
| `scripts/rollup/sources/t1b-product.ts`    | SQL query for product_components                               |
| `scripts/rollup/sources/t2-amazon.ts`      | Parse docs/lepios/amazon-pipeline-rollup.md                    |
| `scripts/rollup/sources/t3-local-sales.ts` | Hardcoded + task_queue check                                   |
| `scripts/rollup/sources/t4-streamlit.ts`   | SQL query for streamlit_modules                                |
| `scripts/rollup/sources/t5-gpu-day.ts`     | Parse docs/gpu-day-readiness.md header                         |
| `scripts/rollup/render-master-rollup.ts`   | Patch AUTO-ROLLUP fence in master-rollup.md                    |
| `app/api/admin/rollup/refresh/route.ts`    | POST endpoint for manual kick                                  |
| `lib/orchestrator/rollup-digest.ts`        | F18 digest line builder                                        |

Night tick integration: one additional `await buildRollupDigestLine()` call in `sendMorningDigest()` — scope-controlled by window claim (`lib/orchestrator/digest.ts` is claimed by `feat/streamlit-modules-lock`; rollup-digest.ts is a new file not touching digest.ts imports directly until that window closes).

Migration: none needed.

**Waiting for "go".**
