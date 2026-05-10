# F18 Compliance Audit

> Tracking compliance with **F18 — Measurement + benchmark required** across all shipped modules. Companion to `docs/vision/measurement-framework.md` and `lib/rules/registry.ts`.
>
> Last audit: 2026-05-07 · Source: parallel agent audit of `app/(cockpit)/` against `agent_events` writes, benchmark constants, and surfacing widgets.

## What F18 requires

Every shipped module must ship **all three** of:

1. **Capture** — metrics writes to `agent_events` (or a module-owned table) on every meaningful read/write so usage is observable in DB, not folklore.
2. **Benchmark** — an explicit reference number the module is measured against. Sources, in priority order:
   - **Industry standard** (e.g., Stripe checkout completion benchmark, AWS p95 latency target)
   - **Streamlit-baseline** (the Loeppky OS predecessor — for ports, the source-system number is the benchmark)
   - **Colin target** (explicitly stated, e.g., "net worth growth ≥ 8%/yr")
3. **Surfacing path** — a widget on the module page, a `morning_digest` line, or a dashboard card so Colin can ask _"how is X doing?"_ and get a number + comparison without reading code.

If a module has zero of (1), (2), or (3), it cannot satisfy the ARCHITECTURE.md §11 kill criterion (_"measurably helping Colin make or save money"_) — by construction, there's nothing to measure.

## Headline numbers

> Last revised 2026-05-07 EOD after the second Tier-1 retrofit (amazon).

- **38 cockpit modules** under `app/(cockpit)/` (live in production).
- **2 modules fully compliant** — payouts (PR #127) and amazon (this PR). Pattern: capture via `agent_events` on read + `BENCHMARK_*` constant + PaceBadge widget.
- **3 modules with capture only** (betting, bookkeeping, oura) — log to `agent_events` or DB but no benchmark or surfacing.
- **1 module with partial capture + surfacing** (health) — harness consumes oura_daily indirectly.
- **F18 compliance rate: 5%** by strict definition (2/38); **16% (6/38)** if you count any single dimension.

Still the largest systemic technical debt in the project, but a reproducible retrofit pattern is now shipped twice — Tier 1 remaining: bookkeeping, business-review, net-worth.

## Per-module compliance table

Status legend: ✅ shipped · ⚠️ partial · ❌ missing

| Module                | Capture | Benchmark | Surfacing | Notes                                                                                                  |
| --------------------- | ------- | --------- | --------- | ------------------------------------------------------------------------------------------------------ |
| **accounts**          | ❌      | ❌        | ❌        | Bank/CC/loan dashboard. Drives net-worth — high-leverage to instrument.                                |
| **amazon**            | ✅      | ✅        | ✅        | `'amazon.viewed'` on render + SP-API sync. Bench: BENCHMARK_30D_REVENUE_CAD. Surface: AmazonPaceBadge. |
| **amazon-sales**      | ❌      | ❌        | ❌        | Sales charts. Should bench against Streamlit `26_Sales_Charts`.                                        |
| **annual-review**     | ❌      | ❌        | ❌        | Year-over-year wealth + milestones. Bench: prior-year delta.                                           |
| **balance-sheet**     | ❌      | ❌        | ❌        | Static view. Lower priority but trivial to surface.                                                    |
| **bank-register**     | ❌      | ❌        | ❌        | Reconciliation surface. Drives bookkeeping accuracy.                                                   |
| **betting**           | ⚠️      | ❌        | ❌        | Kelly Sizer. Shipped Sprint 2; agent_events on bet log. No surfacing.                                  |
| **bookkeeping**       | ⚠️      | ❌        | ❌        | agent_events on classify/reconcile. Bench: hours/month vs. Streamlit.                                  |
| **bookkeeping-hub**   | ❌      | ❌        | ❌        | Top-level hub view. Composite of sub-tiles.                                                            |
| **business-review**   | ❌      | ❌        | ❌        | Business metrics dashboard. Most-viewed daily — surfacing is the win.                                  |
| **cash-forecast**     | ❌      | ❌        | ❌        | 30-day forecast. Bench: actual vs. forecast variance.                                                  |
| **chat**              | ❌      | ❌        | ❌        | Twin chat. Bench: response success rate, escalation %.                                                 |
| **cogs**              | ❌      | ❌        | ❌        | COGS calculator. Bench: vs. Streamlit historical.                                                      |
| **debt-payoff**       | ❌      | ❌        | ❌        | Household debt schedule.                                                                               |
| **diet**              | ❌      | ❌        | ❌        | Just shipped (PR #116, 2026-05-07). Bench candidate: weight target, biomarker ranges.                  |
| **gst-return**        | ❌      | ❌        | ❌        | Quarterly GST. Bench: filing accuracy vs. CRA.                                                         |
| **health**            | ⚠️      | ❌        | ❌        | Family health records (PR #115).                                                                       |
| **hit-lists**         | ❌      | ❌        | ❌        | Amazon deal lists. Bench: hit→list conversion %.                                                       |
| **import**            | ❌      | ❌        | ❌        | Data import surface. Internal tool.                                                                    |
| **inventory**         | ❌      | ❌        | ❌        | Inventory state. Bench: vs. Streamlit periodic-method baseline.                                        |
| **life-pnl**          | ❌      | ❌        | ❌        | Personal P&L. Bench: prior period delta + Colin target.                                                |
| **mileage**           | ❌      | ❌        | ❌        | Vehicle mileage tracking.                                                                              |
| **money**             | ❌      | ❌        | ❌        | Top-level money hub.                                                                                   |
| **monthly-close**     | ❌      | ❌        | ❌        | Month-end ceremony. Bench: time-to-close vs. Streamlit.                                                |
| **monthly-expenses**  | ❌      | ❌        | ❌        | Combined household expenses.                                                                           |
| **monthly-pnl**       | ❌      | ❌        | ❌        | Monthly P&L.                                                                                           |
| **net-worth**         | ❌      | ❌        | ❌        | Inline-edit net worth. Bench: Colin target ≥ 8%/yr growth. **High value to instrument.**               |
| **oura**              | ⚠️      | ❌        | ⚠️        | `oura_daily` table; harness consumes; no Colin-facing surfacing.                                       |
| **pallets**           | ❌      | ❌        | ❌        | FBA/MF pallet tracker.                                                                                 |
| **payouts**           | ✅      | ✅        | ✅        | `'payouts.viewed'` on API fetch. Bench: BENCHMARK_MONTHLY_NET_CAD. Surface: PaceBadge. (PR #127)       |
| **personal-expenses** | ❌      | ❌        | ❌        | Household sub-view.                                                                                    |
| **receipts**          | ❌      | ❌        | ❌        | Receipts capture (port pending).                                                                       |
| **reconciliation**    | ❌      | ❌        | ❌        | Bookkeeping reconciliation.                                                                            |
| **recurring**         | ❌      | ❌        | ❌        | Recurring subscriptions. Bench: cost trend month-over-month.                                           |
| **savings-goals**     | ❌      | ❌        | ❌        | Goal tracker — has progress but no instrumentation.                                                    |
| **scan**              | ❌      | ❌        | ❌        | PageProfit scanner (port pending).                                                                     |
| **subscriptions**     | ❌      | ❌        | ❌        | Subscription dashboard.                                                                                |
| **tax-centre**        | ❌      | ❌        | ❌        | Tax docs hub.                                                                                          |
| **utility**           | ❌      | ❌        | ❌        | Utility costs tracker.                                                                                 |
| **vehicles**          | ❌      | ❌        | ❌        | Vehicle data + AI valuation. Bench: actual vs. AI valuation MAE.                                       |

## F-rule enforcement state

Per the strategic destination audit:

| Rule                                     | Declared                            | Active enforcement                       | Status                 |
| ---------------------------------------- | ----------------------------------- | ---------------------------------------- | ---------------------- |
| F17 — behavioral-ingestion-justification | `lib/rules/registry.ts`             | None                                     | ⚠️ Declared, not gated |
| **F18 — measurement-benchmark-required** | `lib/rules/registry.ts`             | **None**                                 | ❌ **Largest gap**     |
| F19 — continuous-improvement (process)   | `lib/harness/process-efficiency.ts` | % delta logged per signal, no auto-gate  | ⚠️ Partial             |
| F20 — design-system-enforcement          | `eslint.config.mjs`                 | Active (`style=` grep + reviewer agent)  | ✅ Enforced            |
| F21 — acceptance-tests-first             | Coordinator workflow                | Active (acceptance docs gate PRs)        | ✅ Enforced            |
| F22 — cron-secret-auth-via-helper        | `eslint.config.mjs`                 | Active (no-restricted-syntax + reviewer) | ✅ Enforced            |
| F23 — GPU Day readiness tracker          | `docs/gpu-day-readiness.md`         | Updated on every relevant window close   | ✅ Enforced            |

F20–F23 are well-enforced. F17 + F18 are declared but unenforced. **F18 is the largest enforcement gap** — 67% of shipped modules lack any metrics capture.

## Retrofit priority order

Order modules by leverage = (revenue impact) × (Colin daily-use frequency) × (data already available).

### Tier 1 — Revenue-critical, Colin uses daily (5 modules)

| #   | Module              | Why first                                                        |
| --- | ------------------- | ---------------------------------------------------------------- |
| 1   | **amazon**          | Real revenue. Already captures; needs benchmark + surfacing.     |
| 2   | **bookkeeping**     | Already captures. Hours/month vs. Streamlit is an obvious bench. |
| 3   | **business-review** | Most-viewed page. Surfacing change is high-visibility.           |
| 4   | **payouts**         | Variance is already the implicit bench — formalize it.           |
| 5   | **net-worth**       | Bench against Colin's growth target. Tile already exists.        |

### Tier 2 — Financial close / accuracy critical (8 modules)

life-pnl, monthly-pnl, monthly-expenses, monthly-close, cash-forecast, gst-return, accounts, reconciliation.

### Tier 3 — Operational / health (5 modules)

oura, health, diet, betting, hit-lists.

### Tier 4 — Reference / lower-frequency (everything else)

balance-sheet, annual-review, vehicles, mileage, recurring, savings-goals, debt-payoff, subscriptions, tax-centre, utility, personal-expenses, bank-register, inventory, pallets, money (hub), bookkeeping-hub (hub), cogs, amazon-sales, scan, receipts, import, chat, gst-return.

## Definition of done (per module)

A module is F18-compliant when:

1. ✅ At least one `agent_events.insert` (or module-table write) fires on every read AND every write of the module's primary data.
2. ✅ A `BENCHMARK` constant or `module_benchmarks` row exists, with the source documented (industry / Streamlit / Colin target) and a numeric target value.
3. ✅ Either:
   - A widget on the module page that displays _current value vs. benchmark_ (delta + direction), OR
   - A line in `morning_digest` that reports the same.

A module is **provisionally compliant** if (1) is shipped and (2)+(3) are tracked as a follow-up task in `task_queue`.

## Companion work

- **P3-3** (Sprint 6 backlog): F18 CI gate — block new modules that lack any of the three. Stops the bleeding before retrofitting.
- **F-L13** (already logged): component % bumps require manual SQL — applies the same lesson here. Surfacing % retrofitted should auto-update a rollup.
- **`task_queue` id `a3de7bed`** — "F18 ceiling metric layer" — partially overlaps; align scope before starting that task.

---

_Re-run this audit by listing `app/(cockpit)/`, grepping each module's source for `agent_events.insert` + `BENCHMARK` + a digest emit, and updating the table above. Target: 80% compliance within 4 build sessions._
