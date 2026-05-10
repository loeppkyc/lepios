# F18 Ceiling Metric Layer — Study Doc

**task_id:** a3de7bed-2bce-4832-a1a1-28b87f104d62  
**chunk:** f18-ceiling  
**sprint:** 5  
**date:** 2026-05-10  
**type:** greenfield (no Streamlit predecessor)

---

## What this chunk does

Extends the F18 measurement framework with a new dimension: **ceiling metrics**.

Current F18 state: benchmark (what we're targeting) + current (what we're achieving). Gap is
measured as `current - benchmark`.

New with ceiling metrics: **ceiling** (what is theoretically achievable at current resources).

This adds a second gap: `ceiling - benchmark` = the "blocked headroom" — benefit we can't
reach until we lift the ceiling. Colin can now see:
- Module A: current=65%, benchmark=80%, ceiling=75% — gap is real, but ceiling is time-fixable (corpus grows)
- Module B: current=72%, benchmark=80%, ceiling=80% — achievable, just needs work
- Module C: current=72%, benchmark=80%, ceiling=74% — ceiling blocks benchmark; money-fixable ($20/mo)

---

## Existing F18 infrastructure (Check-Before-Build results)

| Component | What exists | Relevant to this chunk? |
|-----------|-------------|------------------------|
| `agent_events` | Core event log, foundation for all metrics | Read-only — ceiling metrics are declared data, not event-derived |
| `daily_metrics` | Per-domain daily rollup table | Not directly — different grain |
| `build_metrics` + view | Build estimate-vs-actual tracking | No overlap |
| `harness_resource_budgets` (migration 0159) | **Code-level** ceiling counts (vercel crons=18, package.deps=300) | **Parallel concept, NOT the right table to extend.** See §2 below. |
| `lib/metrics/rollups.ts` | Aggregation helpers for morning digest | May add a ceiling rollup function here later |
| `lib/harness/process-efficiency.ts` | 4 F19 process signals with benchmarks | Pattern to follow for ceiling signals |
| `lib/payouts/benchmark.ts` | BENCHMARK constant + pace computation | Pattern for declaring benchmark values |
| `docs/vision/measurement-framework.md` | F18 framework definition | This chunk extends it |
| `docs/f18-compliance.md` | 38-module audit, 5% compliance rate | Notes this task `a3de7bed` — "partially overlaps; align scope before starting" |

### Why harness_resource_budgets is a different concept

`harness_resource_budgets` tracks **discrete count limits** of infrastructure resources:
- Vercel cron slots used (integer count vs. 18 max)
- Package dependencies count (integer count vs. 300 max)
- Env var count (integer count vs. 100 max)

This chunk needs **module performance ceilings**:
- Twin answer rate ceiling (percentage, not a count)
- Ollama embed throughput ceiling (docs/min, not a count)
- Vercel cron *frequency* ceiling (runs/day the plan allows, not count of crons)

The vercel ceiling in harness_resource_budgets = "how many cron jobs exist." The vercel ceiling here = "how often can a cron job run" (1/hr on Hobby = 24/day ceiling). These are orthogonal. New table required.

---

## Three ceiling cause categories (from task description)

| Category | Meaning | Example | Path to lift |
|----------|---------|---------|--------------|
| `money` | Upgrade a paid tier or add a service | Vercel Pro ($20/mo) → crons run more frequently | Colin decides + pays |
| `hardware` | Physical or cloud compute constraint | GPU upgrade → Ollama throughput 10× | Colin decides + capital |
| `time` | Grows passively without action | Corpus density → twin answer rate improves as project runs | Wait; track progress |

---

## Examples baked in (from task description)

### 1. Vercel cron frequency

- **Module:** `vercel-cron`
- **Metric:** Max task pickup runs per day (Hobby = 1/hr = 24/day; Pro = unlimited)
- **Current:** 24 runs/day (1 per hour, Hobby plan)
- **Benchmark:** 24 runs/day (sufficient for current queue depth)
- **Ceiling:** 24 runs/day (Hobby plan hard limit)
- **Ceiling cause:** Vercel Hobby plan: 1 hourly cron max
- **Ceiling category:** `money`
- **Lift cost:** ~$20/month Vercel Pro → continuous crons
- **Lift gain:** Coordinator could run every 5 min instead of hourly (~12× pickup frequency)
- **Note:** Currently at ceiling, benchmark is met. Lift only needed if queue grows.

### 2. Ollama embed throughput

- **Module:** `ollama-embed`
- **Metric:** Knowledge corpus embedding throughput (docs/minute)
- **Current:** ~10 docs/min (estimated, RAM-bound on current hardware)
- **Benchmark:** 50 docs/min (acceptable for weekly re-embed of ~500 docs)
- **Ceiling:** ~15 docs/min at current RAM config
- **Ceiling cause:** RAM constraint on current hardware limits Ollama parallel inference
- **Ceiling category:** `hardware`
- **Lift cost:** GPU + RAM upgrade OR cloud inference API
- **Lift gain:** ~5× throughput → weekly embed job drops from 50 min to 10 min

### 3. Twin answer rate

- **Module:** `twin`
- **Metric:** % of coordinator questions answered without Colin escalation
- **Current:** unknown (twin blocked from coordinator sandbox) — needs live measurement
- **Benchmark:** ≥50% self-answered (from measurement-framework.md)
- **Ceiling:** ~75% (corpus density-limited; many design-intent questions lack corpus entries)
- **Ceiling cause:** Corpus gaps — sprint acceptance docs, CLAUDE.md entries, architecture decisions not yet ingested
- **Ceiling category:** `time`
- **Lift cost:** Passive — grows as more sprint work ingests into corpus; accelerated by ingest-claude-md runs
- **Lift gain:** From ~50% → ~75% when corpus reaches critical density (~200+ high-quality entries)

---

## Twin Q&A — blocked (endpoint unreachable)

All three batch queries returned `Host not in allowlist` from coordinator sandbox. Questions added to pending Colin questions:

1. "Should ceiling metrics extend `harness_resource_budgets` or use a new table?" — [twin: unreachable, endpoint blocked from coordinator sandbox]
2. "Where should the F18 ceiling metrics dashboard live in the LepiOS cockpit?" — [twin: unreachable]
3. "Which modules beyond the 3 task-specified examples should be seeded in v1?" — [twin: unreachable]

**Coordinator position on each (pending Colin confirmation):**

1. → New table `module_ceiling_metrics`. `harness_resource_budgets` is count-of-discrete-resources; ceiling metrics are performance-percentage ceilings. Different schema, different mental model.
2. → New page at `/harness/ceiling` or section on existing harness scoring dashboard. Colin's call — see open question in acceptance doc.
3. → Seed only the 3 specified by the task. Expanding scope in v1 risks bloat; retrofit pattern established, new rows added by INSERT later.

---

## 20% Better Analysis

Compared to a naïve "store ceiling text fields in a table":

| Category | Naive | 20% Better |
|----------|-------|-----------|
| **Correctness** | Single `ceiling_note` text field | Separate `ceiling_value` (numeric) + `ceiling_cause_category` (enum) — enables automated alerting and sorting |
| **Performance** | N queries per module per page load | Single SQL query returns all rows; view computes status (ok/warning/at_ceiling) at read time |
| **UX** | Plain table of ceilings | Traffic-light coloring by category: 🟡 money, 🔴 hardware, 🟢 time; sort hardest-to-fix first |
| **Extensibility** | Code change required for new module | New modules = new INSERT rows; no code deploy |
| **Data model** | Only ceiling value | `ceiling_value` + `ceiling_lift_gain_pct` + `ceiling_lift_cost` → Colin can prioritize by ROI |
| **Observability** | Static table | `last_updated_at` column + staleness indicator (>30d = stale); F17 signal: log `ceiling_lift_decision` to `agent_events` on upgrade |

**F17 integration (deferred):** When Colin upgrades (lifts a ceiling), log to `agent_events`:
`action='ceiling_lift_decision', meta.module=X, meta.category=money, meta.cost='$20/mo'`
This creates the preference signal for the path engine. Deferred to follow-up chunk (avoids scope creep in builder session).

---

## Pending Colin Questions

1. **Dashboard location:** New route `/harness/ceiling` vs. section on existing harness scoring dashboard (`/harness` or `/metrics`). Coordinator recommends new route — keeps harness concerns separate from module metrics, avoids crowding existing pages.

2. **harness_resource_budgets relationship:** New table `module_ceiling_metrics` is recommended (different concept). Should the two be surfaced on the same dashboard or separate? If separate, does Colin want a link between them?

3. **v1 seed scope:** Task description specifies 3 examples (vercel cron frequency, ollama embed, twin accuracy). Coordinator recommends v1 = exactly those 3. Expand via INSERT, not via acceptance doc scope.
