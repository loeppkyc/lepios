# Feedback Loop Scoring System — Design Doc

**Status:** Draft — pending Colin review
**Author:** Colin + Claude, 2026-04-20
**Scope:** Scoring framework for all LepiOS autonomous work, starting with Step 6 night tick.

---

## 1. Purpose

Every autonomous action LepiOS takes produces an `agent_events` row.
Today those rows record *what happened* (status, duration, output).
They do not record *how well it went* in a way that's comparable
across runs or time.

This system adds that layer. Every run gets a quality score on a
0–100 scale, broken into four dimensions, stamped with the capacity
tier it was scored against. This enables:

- Trend detection (is night_tick getting better or worse over time?)
- Regression alerts (did something drop sharply this week?)
- Capacity signals (are we plateauing against our current substrate?)
- Agent self-improvement (future: agent reads its own history
  before planning the next run)

## 2. The score

**Scale: 0–100.** Finer than 0–5 so 20% improvements are legible
as visible numerical movement.

**Meaning of the number:** the score measures utilization of current
capacity. 100 does not mean "objectively perfect work." It means
"this system, as currently built, has nothing more to give."
Approaching 100 is itself a signal — the substrate is saturated
and further gains require a capacity upgrade, not optimization.

## 3. Capacity tiers

Scores are only meaningful *within* a tier. Comparing a score from
Tier 1 to a score from Tier 2 is meaningless — the ceiling moved.

Every `quality_score` writes is stamped with the tier it was scored
against. Tier strings:

- `tier_1_laptop_ollama` — current. Local Ollama on Colin's machine,
  single-node, laptop-hosted. Vercel for the orchestrator shell.
- `tier_2_dedicated_gpu` — future. Dedicated GPU server (home or
  cloud), faster/larger models, more parallel capacity.
- `tier_3_agent_council` — further future. Multiple specialized
  agents running in parallel, council-of-models decision making.
- `tier_N_...` — added as needed. String field, never enumerated
  in code as an enum.

When the tier changes, baselines reset. The dashboard segments by
tier by default; historical views can overlay tiers with visual
separation.

## 4. Quality dimensions

Each dimension scores 0–100. Aggregate is weighted mean.

### 4.1 Completeness (weight: 0.4)

Did the run do what it set out to do?

- 100 = every sub-task finished cleanly
- 67 = one of three sub-tasks failed
- 33 = two of three failed
- 0 = nothing ran / everything errored

For tasks with N sub-tasks, each finished sub-task contributes
100/N. Partial completion (e.g. a check that timed out halfway)
contributes proportionally.

Weighted highest because a task that didn't finish is worse than
a slow or ugly one.

### 4.2 Signal quality (weight: 0.3)

Did the output surface anything useful? This is the dimension
that matters most for the edge-finder vision and is also the
hardest to score mechanically.

- 100 = caught a real flag that turned out to matter (validated
  later by Colin's 👍)
- 75 = caught something borderline / worth looking at
- 50 = ran cleanly, surfaced nothing (neither good nor bad —
  it did its job, there was just nothing to find)
- 20 = surfaced a flag that turned out to be noise (false positive)
- 0 = missed something it should have caught (validated later
  by Colin's 👎 or a later run finding the missed thing)

Rule-based scoring (v1) cannot know whether a flag was real or
noise at time-of-scoring — that's only known retrospectively via
Colin's thumbs or subsequent events. So the initial rule is:

- Zero flags raised → 50 (neutral)
- At least one flag raised → 70 (tentative positive, pending
  thumb confirmation)
- Scores are retroactively updated when thumbs arrive.

**Important note on the 50/70 rule:** This is deliberately a
placeholder. Zero flags on a rule-based scorer cannot distinguish
"system is healthy" from "checker is blind," and a flag raised
cannot distinguish "real signal" from "false positive." The 50/70
values are intentionally narrow and tilted just enough to reward
activity over silence — enough to move the aggregate, not enough
to dominate it. Real signal_quality scoring only becomes meaningful
once retroactive thumbs (§7.3) and LLM-based second-opinion scoring
(§7.2) are live. Until then, a signal_quality of 50 does NOT mean
"bad run" — it means "this dimension does not have enough information
to score." Treat aggregate scores through Tier 1 with a grain of
salt for this reason.

### 4.3 Efficiency (weight: 0.2)

How fast relative to this task type's baseline in this tier?

- 100 = at or below the 20th percentile of the 14-day rolling
  baseline for this task_type + capacity_tier
- 75 = at the 50th percentile (median)
- 50 = at the 80th percentile
- 25 = 2x the median
- 0 = 5x the median or worse

Smooth interpolation between these anchors, not step functions,
so small speedups register.

Requires at least 7 runs in the current tier before a meaningful
baseline exists. Before that threshold, efficiency scores default
to 50 (neutral) so they don't poison aggregate early.

### 4.4 Hygiene (weight: 0.1)

Did it write clean, well-formed data?

- Start at 100
- -5 for each missing optional field
- -20 for each missing required field
- -40 for malformed JSON / schema violation
- Floor at 0

This one is mostly a regression detector — if it drops, something
upstream changed the data shape. Weighted low because it's boring
but nonzero because silent data corruption is bad.

## 5. Aggregate

```
aggregate =
  (Completeness  × 0.4)
+ (Signal        × 0.3)
+ (Efficiency    × 0.2)
+ (Hygiene       × 0.1)
```

Result is 0–100, rounded to one decimal place.

Weights are v1. They will be tuned based on a month of real data.
The design doc is the source of truth — when we change weights,
we update this section and note the date.

## 6. Schema

### 6.1 Additions to `agent_events`

Two new fields:

- `task_type` — TEXT, required going forward. Enum-like string
  identifying the kind of work. Starting values:
  - `night_tick`
  - `morning_digest`
  - future: `claude_code_task`, `edge_scan_books`, etc.

- `quality_score` — JSONB, nullable. Shape:

```json
{
  "aggregate": 84.2,
  "capacity_tier": "tier_1_laptop_ollama",
  "dimensions": {
    "completeness": 100,
    "signal_quality": 50,
    "efficiency": 78,
    "hygiene": 100
  },
  "weights_version": "v1",
  "scored_at": "2026-04-20T17:33:53Z",
  "scored_by": "rule_based_v1"
}
```

### 6.2 New table: `task_feedback`

For human thumbs and retrospective signal-quality corrections.

```sql
CREATE TABLE task_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_event_id UUID REFERENCES agent_events(id),
  feedback_type TEXT CHECK (feedback_type IN ('thumbs_up','thumbs_down','signal_validation')),
  value TEXT,
  source TEXT, -- 'telegram_digest_button' | 'dashboard_click' | 'retrospective'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  meta JSONB
);
```

## 7. Scoring engines (layered)

### 7.1 Rule-based (v1 — ships this weekend)

Pure function in `lib/orchestrator/scoring.ts`. Takes a TickResult +
historical context, returns a `quality_score`. Called synchronously
at the end of every tick. Writes the score to the `agent_events`
row.

Deterministic, fast, free. Captures the obvious stuff. Bakes in
"what good looks like" explicitly.

Rule-based scoring is weakest on Signal Quality — see §4.2 for the placeholder acknowledgment.

### 7.2 LLM-based (v2 — ships with Step 6.5 Ollama wiring)

Second-opinion scorer. Ollama reviews the tick's output and
produces its own `quality_score`. Stored alongside rule-based in
the same JSONB with `scored_by: "ollama_qwen25"` or similar.

Disagreements between rule-based and LLM-based are themselves
valuable signal — the interesting cases worth reviewing.

### 7.3 Human (ongoing — starts when Telegram buttons ship)

Colin taps 👍/👎 on each morning digest. Writes to `task_feedback`.
Over time, this becomes ground truth against which rule-based and
LLM-based are calibrated.

## 8. What's explicitly out of scope for v1

- **LLM-based scoring.** Waits for Ollama in Step 6.5.
- **Attribution.** When a regression is detected, we do not
  automatically identify which change caused it. Dumb version
  ("show commits since last known-good score > threshold")
  comes later.
- **Routing ground-truth for Ollama vs Claude escalation.**
  Waits until Ollama is actually in the loop.
- **Agent-readable history during planning.** v1 scores get
  *written*. Reading them back into the agent's planning phase
  is v2+.
- **Multi-tier overlay visualizations.** Dashboard v1 shows
  current tier only.

## 9. Implementation order (this weekend)

1. Commit this doc (paste into Claude Code, commit, no code yet)
2. Migration: add `task_type` + `quality_score` to `agent_events`;
   create `task_feedback` table
3. Backfill today's rows with `task_type` values
4. `lib/orchestrator/scoring.ts` — rule-based scorer
5. Wire scorer into `runNightTick()` + morning digest
6. Extend `/autonomous` dashboard with per-task-type trend view
7. Telegram digest: add 👍/👎 inline buttons + webhook handler
8. Handoff doc

## 10. Success criteria

- Every `agent_events` row from v1-onward has `task_type` + `quality_score`
- Dashboard shows a visible trend line for night_tick over 14 days
- Telegram digest has working thumbs buttons
- Tier 1 baseline data begins accumulating from day 1
- No regressions to Step 6 tick behavior

## 11. Deferred work

The following are intentionally deferred from v1 and should be
revisited on the triggers listed.

### 11.1 §9 Step 7 — Telegram thumbs buttons

Inline 👍/👎 buttons on the morning digest that write to
task_feedback. Provides the ground truth that calibrates the
rule-based scorer's placeholder signal_quality rule (§4.2).

**Triggers to revisit:**

- Signal Quality's 50/70 placeholder is visibly distorting aggregates
- Step 6.5 (LLM-based scoring) is about to ship and needs ground
  truth to compare against
- Enough scored runs exist (2+ weeks) that calibration would have
  statistical meaning

**Estimated scope:** 2-3 hours. Involves a new public webhook
endpoint, Telegram API registration, callback_data encoding of
agent_event_id, message editing after tap, and the task_feedback
write path.

### 11.2 Dashboard dimension drill-down

The QualityTrends cards currently show latest/avg/sparkline + a
2x2 dimension grid. A drill-down view per task_type (click a card
→ detailed per-dimension history over time) was designed but not
built. Revisit when enough tier-1 runs exist that dimensional
patterns become interesting to look at.

### 11.3 LLM-based scoring (§7.2)

Tied to Step 6.5 (Ollama wiring). Second-opinion scorer that
reviews TickResult output and produces its own QualityScore
stored alongside rule-based. Blocked on OLLAMA_TUNNEL_URL
being set in Vercel env and Step 6 running clean for a week
(per yesterday's trust-building rule).

### 11.4 Attribution

When a regression is detected (score drops significantly), identify
which commit caused it. Dumb v1 = "show commits since the last
known-good score above threshold." Revisit when a real regression
happens and attribution would actually be useful.
