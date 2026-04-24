# Measurement Framework — LepiOS

Companion to F18 (CLAUDE.md §3 rule 8) and F17 (behavioral ingestion).

---

## Why Measurement + Benchmark, Not Just Tracking

Raw tracking answers "what happened." Benchmarks answer "is that good or bad?"

Without a comparison point, a 72% answer rate is uninterpretable. Against a 50% target it means the twin is ahead of plan. Against a 90% SLA it means it is failing. Autonomous systems that only log events drift invisibly — Colin finds out something is broken when a sprint stalls, not when the metric first crossed a threshold.

F18 exists so that for any system Colin can ask "how is X doing?" and immediately get: a number, a reference point, and a delta. No code reading required.

---

## Standard Module Measurement Schema

Every module declares its measurement contract in a `docs/metrics/<module>.md` file (one file per module, referenced from this doc).

```
module: <slug>                     # e.g. harness, twin, sp-api, deploy-gate
metric_name: <human name>          # e.g. "Harness reliability"
unit: <what is measured>           # e.g. "% nightly runs completing without fatal error"
capture_method: <how it is stored> # e.g. agent_events WHERE event='night_tick.complete'
benchmark:
  type: <industry | known-good | colin-target>
  value: <number + unit>           # e.g. 99.9% uptime
  source: <why this number>        # e.g. "AWS SLA for managed services"
surfacing_path: <how Colin queries> # e.g. SQL / Supabase dashboard filter / morning digest field
alert_threshold: <when to notify>  # e.g. 3 consecutive failures
```

---

## Template — Adding a New Module

1. **Pick the metric.** One primary metric per module. Must be a number Colin can compare against the benchmark in under 30 seconds.
2. **Define the benchmark before writing code.** Industry standard > known-good reference > Colin's explicit target. Never leave benchmark blank.
3. **Wire capture on day one.** Log to `agent_events` or a dedicated table on every meaningful event. Add `status`, `meta`, and `actor` fields per the knowledge schema.
4. **Add a surfacing path.** Either a morning digest field, a Supabase saved query, or a dashboard tile. "I could write a query" is not a surfacing path.
5. **Set an alert threshold.** Define when degradation is worth a Telegram notification. Wire it into the harness or cron.
6. **Fill in the schema block** above and commit it to `docs/metrics/<module>.md`.

---

## Existing Modules — Examples

### Harness Reliability

```
module: harness
metric_name: Nightly harness reliability
unit: % of nightly runs completing without fatal error (last 30 nights)
capture_method: agent_events WHERE event='night_tick.complete' OR event='night_tick.fatal'
  — reliability = complete / (complete + fatal)
benchmark:
  type: industry
  value: 99.9% (one failure per ~1000 runs)
  source: AWS managed-service SLA; reasonable bar for an autonomous agent
surfacing_path: morning_digest includes "harness: N/30 runs clean" field
alert_threshold: 2 consecutive fatal events → Telegram alert via outbound_notifications
```

### Twin Accuracy

```
module: twin
metric_name: Digital twin answer rate
unit: % of coordinator questions answered with confidence ≥ threshold (not escalated to Colin)
capture_method: agent_events WHERE event='twin.answer' (answered) or event='twin.escalate' (punted)
  — rate = answered / (answered + escalated)
benchmark:
  type: colin-target
  value: ≥ 50% of questions answered without Colin involvement
  source: Phase 4 design doc — twin replaces Colin as primary questioner for known-context decisions
surfacing_path: morning_digest includes "twin: N% self-answer rate (last 7 days)"
alert_threshold: rate < 20% for 3 consecutive sprint days → flag for corpus gap review
```

### SP-API 429 Recovery

```
module: sp-api
metric_name: SP-API 429 recovery rate
unit: % of 429 responses successfully retried and completed (vs. hard-failed)
capture_method: agent_events WHERE event='sp_api.429_retry' (warning = retry attempted)
  cross-ref events WHERE event='sp_api.request' status='error' (hard fail, no retry)
  — recovery = retried_and_succeeded / (retried + hard_failed)
benchmark:
  type: known-good
  value: 100% recovery (zero hard fails on retryable errors)
  source: SP-API Retry-After header guarantee — if we honor it, retry always succeeds
surfacing_path: Supabase saved query on agent_events; alert fires on first hard fail
alert_threshold: any hard fail on a 429 (should be zero) → immediate Telegram alert
```

### Deploy Gate

```
module: deploy-gate
metric_name: Deploy gate catch rate
unit: % of risky deploys flagged before reaching production (vs. caught post-deploy by Colin manually)
capture_method: agent_events WHERE event='deploy_gate.flagged' (gate caught it)
  vs. agent_events WHERE event='deploy_gate.passed' AND post-deploy incident filed
  — catch rate = gate_flagged / (gate_flagged + post_deploy_catches)
benchmark:
  type: colin-target
  value: > manual review baseline (Colin catching issues by reading diffs himself)
  source: kill criterion — if the gate catches fewer issues than Colin would, it has no value
surfacing_path: weekly digest field "deploy gate: N flags, M post-deploy catches"
alert_threshold: 2 post-deploy catches in one week with gate passing → gate logic review required
```

---

## Relationship to F17

F17 asks: does this module feed behavioral signals to the path probability engine?
F18 asks: can Colin audit this module's health without reading code?

Both must be answered before a module ships. A module that feeds signals but has no benchmark is invisible when it degrades. A module that has metrics but no engine signal is an island.

The measurement contract (this framework) is the audit surface. The behavioral ingestion spec (`behavioral-ingestion-spec.md`) is the signal surface. Both required.
