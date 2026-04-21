# Autonomous Harness — Step 6.5: Ollama Daytime Tick

**Status:** Design — approved  
**Build status:** DEFERRED 2026-04-21 — component #5 (task pickup) reprioritized as coordinator unblock. This design doc remains the spec; build resumes after #5 stabilizes.  
**Author:** Colin + Claude, 2026-04-21  
**Scope:** Daytime orchestration tick powered by local Ollama; OLLAMA_TUNNEL_URL production wiring  
**Gated on:** Step 6 running clean (in progress — night_tick + morning_digest live as of 2026-04-20)

---

## 1. Goal

Steps 1–6 establish an overnight, read-only orchestration loop: night_tick fires at 02:00 MT,
morning_digest delivers a Telegram summary at 06:00 MT, rule-based quality scoring stamps every
run. The system is blind for the remaining ~20 hours of each day.

Step 6.5 adds a **daytime orchestration tick** that runs during Colin's active hours using
local Ollama — no frontier API calls, no per-token cost. It does two things:

1. **Proves the OLLAMA_TUNNEL_URL pathway end-to-end in production.** The Ollama client
   (`lib/ollama/client.ts`) already reads `OLLAMA_TUNNEL_URL` and falls back to localhost.
   The env var has never been set in Vercel. Until it is, every Ollama call in production
   silently hits nothing. Step 6.5 forces that wiring to happen and verifies it with a live check.

2. **Runs lightweight daytime classification** — Ollama-assisted review of recent agent_events
   output for anomalies the rule-based night_tick checks can't detect. Cheap, local, repeatable.

**Why this is the Sprint 4 resume trigger:** Sprint 4 is paused while the autonomous harness
is built to assist its execution. Before Colin trusts the harness to assist sprint chunk execution,
it needs a week of evidence that the full stack — Vercel orchestrator → Cloudflare tunnel → local
Ollama → Supabase write — is stable during daytime hours, not just overnight. Three consecutive
clean days of daytime ticks is the minimum signal. See §11.

---

## 2. Scope

### In scope

- New Vercel cron route: `GET /api/cron/daytime-tick`
- New `runDaytimeTick()` function in `lib/orchestrator/` (parallel to `runNightTick()`)
- Three checks:
  - `ollama_health` — verify OLLAMA_TUNNEL_URL is reachable and qwen2.5:32b is loaded
  - `signal_review` — Ollama-assisted anomaly scan of the last 12 hours of agent_events
  - `site_health` — reuse existing `checkSiteHealth()` (sanity baseline, same as night_tick)
- `task_type: 'daytime_tick'` rows in `agent_events`
- `quality_score` using `rule_based_v1` (same scorer, applied to the daytime TickResult shape)
- Feature flag: `DAYTIME_TICK_ENABLED` env var
- `OLLAMA_TUNNEL_URL` set in Vercel production env (infrastructure prerequisite, not code)
- `KNOWN_EVENT_DOMAINS` and `vercel.json` updated to include the new route

### Explicitly out of scope

**LLM-based quality scoring (feedback-loop-scoring.md §11.3 / §7.2)** — the second-opinion
scorer where Ollama reviews a TickResult and produces its own `quality_score` JSONB alongside
the rule-based one. That feature is _enabled_ by Step 6.5 shipping but is a separate design
track. Step 6.5 does not include it. Rationale: keeping 6.5 minimal shortens the clean-running
observation window needed before Sprint 4 resumes.

Other explicit non-inclusions:

- Telegram thumbs buttons (feedback-loop §11.1)
- Dashboard drill-down (feedback-loop §11.2)
- Any write to tables other than `agent_events`
- Any code changes to night_tick, morning_digest, or existing scorers

---

## 3. Model choice

**Chosen: Qwen 2.5 32B (`qwen2.5:32b`) — already configured as `OLLAMA_ANALYSIS_MODEL`.**

Reasoning:

| Criterion                                       | Qwen 2.5 32B          | Phi-4 14B                          |
| ----------------------------------------------- | --------------------- | ---------------------------------- |
| VRAM at Q4 quant                                | ~18–20 GB             | ~8–9 GB                            |
| Fits 16–24 GB target?                           | Yes, at the upper end | Yes, with headroom                 |
| Already wired in `autoSelectModel('analysis')`? | Yes                   | No                                 |
| Reasoning depth for anomaly detection           | Strong                | Adequate for simple classification |
| Load time from cold                             | Slow (~20–40s)        | Fast (~5–10s)                      |
| Context window                                  | 32K tokens            | 16K tokens                         |

The daytime tick's `signal_review` check passes serialized agent_events output summaries to
Ollama and asks it to identify anomalies. This is a structured-reasoning task, not a simple
label prediction. Qwen 2.5 32B is meaningfully better at it and is already the configured
default — no new env vars, no new model pulls.

**Fallback:** if load times consistently push the tick past its 60-second budget (see §8),
Phi-4 14B becomes the fallback for `signal_review`. Implement the switch as an env var:
`OLLAMA_DAYTIME_MODEL` (default: `qwen2.5:32b`). This env var is not required at launch —
the `autoSelectModel('analysis')` default is sufficient.

**VRAM note:** Qwen 2.5 32B at Q4 occupies ~18–20 GB. Colin's machine targets 16–24 GB.
Running other Ollama models concurrently during the daytime tick may cause OOM or eviction.
Daytime tick should be the only Ollama workload during its ~60-second execution window.
No scheduling enforcement needed in v1 — Colin's usage patterns during a single midday
minute make collision unlikely.

---

## 4. Tick cadence

### Daytime window definition

08:00 MT – 21:00 MT (Mountain Time, MDT in summer / MST in winter). Colin's active hours
per ARCHITECTURE.md §6 daily loop. Outside this window: night_tick and morning_digest own
the orchestration surface.

### v1 schedule: once per day at noon MT

One tick at 12:00 MT (18:00 UTC) for v1. Rationale:

- One data point per day is enough to establish "is the tunnel stable?" during the clean-running
  observation window (§11).
- Midday placement is away from all existing crons (see coexistence table below), minimizing
  Supabase and Vercel concurrency noise.
- Simple to monitor: one morning digest + one daytime tick per day = clear mental model.

Expand to 3× per day (10:00, 14:00, 19:00 MT — 16:00, 20:00, 01:00 UTC) once the v1 cadence
has run clean for a week and there's a reason to want higher temporal resolution.

### Coexistence with existing crons

All times UTC. All existing crons are clustered in the 06:00–13:00 UTC window.

| UTC       | MT (MDT)  | Route                        | What                  |
| --------- | --------- | ---------------------------- | --------------------- |
| 06:00     | 00:00     | `/api/knowledge/nightly`     | Knowledge rollup      |
| 08:00     | 02:00     | `/api/cron/night-tick`       | Night watchman checks |
| 12:00     | 06:00     | `/api/cron/morning-digest`   | Telegram digest       |
| 13:00     | 07:00     | `/api/metrics/digest`        | Metrics rollup        |
| **18:00** | **12:00** | **`/api/cron/daytime-tick`** | **← new**             |

No overlap. Five-hour gap before the new cron; five-hour gap after until the next day's
knowledge nightly. No scheduling conflicts.

### Mode field

The existing `TickResult.mode` is typed as `'overnight_readonly'` (literal). Step 6.5
implementation will extend this to `'overnight_readonly' | 'daytime_ollama'`. The daytime
tick writes `mode: 'daytime_ollama'` to distinguish it in the dashboard and agent_events
queries.

---

## 5. Inputs / outputs

### What the tick reads

| Source                 | Fields                                                 | Purpose                                            |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `agent_events`         | `output_summary`, `status`, `task_type`, `occurred_at` | Last 12 hours — input for `signal_review` check    |
| `agent_events`         | `status`                                               | Count of errors/warnings for completeness baseline |
| Ollama `/api/tags`     | `models[]`                                             | Confirm qwen2.5:32b is loaded                      |
| Ollama `/api/generate` | `response`, `eval_count`                               | `signal_review` Ollama output                      |

The tick does NOT read: `products`, `bets`, `trades`, `transactions`, `net_worth_snapshots`,
or any user-data tables. It is read-only on `agent_events` and read/write on `agent_events`
(one insert for its own row). No other tables touched.

### What the tick writes

**Exactly one `agent_events` row per invocation — always, even if all checks fail.**
See §7 guiding principle and §7.6 for the heartbeat guarantee and its limits.

Shape:

```json
{
  "domain": "orchestrator",
  "action": "daytime_tick",
  "actor": "daytime_watchman",
  "status": "success | warning | error",
  "task_type": "daytime_tick",
  "output_summary": "<serialized DaytimeTickResult JSON>",
  "duration_ms": 12345,
  "tags": ["daytime_tick", "step6.5", "ollama", "read_only"],
  "quality_score": {
    "aggregate": 84.2,
    "capacity_tier": "tier_1_laptop_ollama",
    "dimensions": {
      "completeness": 100,
      "signal_quality": 70,
      "efficiency": 75,
      "hygiene": 100
    },
    "weights_version": "v1",
    "scored_at": "2026-04-21T18:00:05Z",
    "scored_by": "rule_based_v1"
  },
  "meta": {
    "tick_id": "<uuid>",
    "run_id": "<uuid>",
    "mode": "daytime_ollama",
    "tick_status": "completed | partial_failure | failed",
    "mapped_from": "spec_v1",
    "ollama_model": "qwen2.5:32b",
    "tunnel_used": true
  }
}
```

No other writes. The `tags` array includes `step6.5` for easy filtering during the
observation window.

### Tables involved

| Table          | Operation | Notes                                  |
| -------------- | --------- | -------------------------------------- |
| `agent_events` | SELECT    | Read last 12h rows for `signal_review` |
| `agent_events` | INSERT    | One row per tick invocation            |

---

## 6. Integration with feedback-loop scorer

**The daytime tick feeds the rule_based_v1 scorer — no parallel track, no LLM scoring.**

Concretely:

- `runDaytimeTick()` produces a `DaytimeTickResult` (parallel type to `TickResult`)
- A sibling function `scoreDaytimeTick()` is added alongside `scoreNightTick()` — same four
  dimensions and weights, but with `fetchHistoricalContext()` called with
  `task_type: 'daytime_tick'` to build a separate efficiency baseline
- The resulting `QualityScore` is stamped `scored_by: 'rule_based_v1'` — identical to night_tick
- `task_feedback` rows (future thumbs) will work against daytime_tick rows the same way
  they will for night_tick rows, because the schema is shared

### signal_quality score mapping (locked for v1)

The `signal_quality` dimension for a daytime tick is determined by the outcome of the
`signal_review` check. These values are fixed — acceptance tests assert against them.

| Ollama outcome                 | signal_quality | Reasoning                                                                                                                     |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ran clean, 0 flags raised      | **50**         | Neutral — "nothing to report" cannot be distinguished from "checker is blind" (same placeholder rationale as night_tick §4.2) |
| Ran clean, 1–2 flags raised    | **70**         | Tentative positive signal, pending future thumb validation                                                                    |
| Ran clean, 3+ flags raised     | **80**         | Stronger signal — higher flag density increases probability of a real anomaly                                                 |
| Ollama output confidence < 0.4 | **40**         | Below neutral — output exists but is inconclusive; slightly penalized for hedging                                             |
| Ollama generate timed out      | **35**         | Degraded — attempted but incomplete. Missing data ≠ clean data; must differ from 0-flags neutral                              |
| Ollama tunnel unreachable      | **25**         | Structural failure — the entire Ollama pathway is broken, not just slow                                                       |

The 50/70 base rule matches night_tick exactly (feedback-loop §4.2). The 35 (timeout) and 25
(unreachable) values are new states that have no analogue in the rule-based night_tick because
night_tick has no Ollama calls. The 80 (3+ flags) extension is also new — more evidence of
signal warrants a higher score than the tentative 70.

**Important:** these scores are placeholders in the same sense as night_tick's 50/70. The
real distinction between "0 flags = healthy" and "0 flags = blind checker" only becomes
legible once Telegram thumbs (§11.1) are live and Colin can validate individual runs
retrospectively.

### Flag output path

**signal_review flags are stored in the `DaytimeTickResult` and feed the `signal_quality`
dimension. They have no independent alerting surface in v1.**

Specifically: when `signal_review` detects anomalies, each anomaly becomes a `Flag` object
in the check's `flags` array. Those flags are serialized into `output_summary` in the
`agent_events` row. The flag count determines `signal_quality` per the table above. The
flags are visible in two places:

1. **Supabase directly** — anyone querying `agent_events` where `task_type = 'daytime_tick'`
   can read them from `output_summary`.
2. **Next morning digest** — the existing morning digest reads the most recent night_tick
   row, not the daytime_tick row. **Daytime tick flags do not currently appear in the morning
   Telegram message.** They will surface only if the morning digest is extended to also
   summarize the prior day's daytime_tick status (a future task, not part of 6.5).

**Consequence:** an anomaly flagged at 12:00 MT has no alerting path to Colin until he
manually checks Supabase, or until the morning digest is extended. Under the current design,
noon-flagged anomalies are visible but not surfaced. This is an accepted limitation of v1.
The daytime tick's primary purpose is tunnel stability verification, not real-time alerting.

If a daytime anomaly requires real-time alerting, that belongs to a future Step 7 feature
(Telegram threshold alerts from daytime check flags) — out of scope for 6.5.

**What Step 6.5 does NOT do for the feedback-loop scorer:**

- It does NOT produce a second `quality_score` entry from Ollama (that is §11.3, deferred)
- The `scored_by` field remains `'rule_based_v1'` for all Step 6.5 output

The LLM-based scoring track (feedback-loop §11.3) picks up after Step 6.5 is stable.
Its trigger is: "OLLAMA_TUNNEL_URL set in Vercel env AND Step 6 running clean for a week" —
both of which are satisfied once Step 6.5 ships and passes its observation window.

---

## 7. Failure modes

Each failure mode has a defined behavior. The guiding principle: **the tick always completes
and always writes an `agent_events` row**, even if every check fails. Silent non-writes are
worse than noisy failures. See §7.6 for what happens when the write itself fails.

### 7.1 Ollama unreachable (tunnel down or OLLAMA_TUNNEL_URL misconfigured)

**Detection:** `healthCheck()` returns `{reachable: false}` within its 5s timeout.

**Behavior:**

- `ollama_health` check → status `'fail'`, flag severity `'critical'`, message includes
  tunnel URL (masked) and latency
- `signal_review` check → skipped; status `'warn'`, flag: "skipped — Ollama unreachable";
  signal_quality score = **25** (see §6 table)
- Tick status: `'partial_failure'` (not `'failed'` — site_health still ran)
- agent_events row written with `status: 'warning'`
- No Telegram alert in v1 (morning digest next day will surface the partial_failure via
  existing flag logic)

**Recovery:** manual: set `OLLAMA_TUNNEL_URL` correctly in Vercel env, verify tunnel is
running locally, re-invoke tick manually to confirm.

### 7.2 Model not loaded (Ollama reachable but qwen2.5:32b absent from `/api/tags`)

**Detection:** `healthCheck()` returns `{reachable: true, models: [...]}` where `models`
does not include `qwen2.5:32b`.

**Behavior:**

- `ollama_health` check → status `'warn'`, flag severity `'warn'`, message: "qwen2.5:32b
  not in available models: [list]"
- `signal_review` → skipped with same pattern as 7.1; signal_quality score = **25**
  (tunnel is structurally available but the model cannot run — equivalent failure from
  signal_review's perspective)
- Tick status: `'partial_failure'`

**Recovery:** run `ollama pull qwen2.5:32b` locally; verify model appears in `/api/tags`.

### 7.3 Ollama timeout (model cold-loading or GPU busy)

**Detection:** the `generate()` call exceeds its timeout. Two timeout boundaries apply:

- **Inner:** `generate()` is called with `timeoutMs: 45_000`. This is the time budget
  for the Ollama call itself, extended beyond the client's 30s default to accommodate
  qwen2.5:32b cold-load (20–40s to bring the model into VRAM from disk).
- **Outer:** the `safeCheck()` wrapper around `signal_review` is given a check-level
  timeout of **50s** (not the default 15s used by night_tick checks). This gives the
  inner call 45s plus 5s overhead for the SELECT query and response handling.

**Why not option (a) — warm-up ping via ollama_health?** `healthCheck()` calls
`GET /api/tags`, which returns the list of available models. It does not invoke
`/api/generate` and does not trigger model loading into VRAM. The ollama_health check
running first does NOT warm the model. A real warm-up would require a separate low-cost
generate call with an effectively free prompt (e.g., `"Hi"`), adding ~5–10s to the tick
for a feature not otherwise needed. Not worth it for v1.

**Behavior — graceful degradation (option c):**

When the `generate()` call times out, the tick does NOT fail:

- `signal_review` check → status `'warn'` (not `'fail'`); flag: "Ollama generate timed
  out after 45s — signal_review degraded"; signal_quality score = **35** (see §6 table)
- Tick continues to `site_health` check normally
- Tick status: at most `'partial_failure'` (because `signal_review` is `'warn'`);
  `'failed'` is not reachable from a timeout alone
- agent_events row written with `status: 'warning'`
- Route returns HTTP 200

Using `'warn'` (not `'fail'`) for a timeout is the key choice. `'fail'` on signal_review
would still only produce `'partial_failure'` tick status (since site_health and
ollama_health can still pass), but establishing a consistent policy — **timeouts are warn,
not fail** — keeps the tick non-brittle for the stability observation window.

**Note on cold-load reality:** qwen2.5:32b takes 20–40s to load from disk on Colin's
machine. The first invocation of the day is the risky one. If the model is warm (already
loaded from earlier local use), generate() typically completes in < 5s for a short
classification prompt. The 45s inner timeout is sized for worst-case cold-load plus
inference, not warm-model inference.

### 7.4 Low-confidence Ollama output

**Detection:** `extractConfidence(text)` from the existing client returns < 0.4 (two or
more uncertainty phrases in the response).

**Behavior:**

- `signal_review` check → status `'warn'`, flag: "Ollama confidence below threshold (0.4):
  response treated as inconclusive"; signal_quality score = **40** (see §6 table)
- Flag count from the Ollama output is discarded — inconclusive output is not promoted
  as a signal
- Tick continues; completeness is penalized for the `'warn'` check

### 7.5 Malformed agent_events SELECT (Supabase error on read)

**Detection:** Supabase client returns an error on the SELECT query in `signal_review`.

**Behavior:**

- `signal_review` → status `'warn'`, flag: "Failed to read agent_events: [error]";
  signal_quality score = **35** (same as timeout — missing data ≠ clean data)
- The tick INSERT still proceeds (INSERT uses the service client independently)
- Tick status: `'partial_failure'` if site_health and ollama_health pass

### 7.6 INSERT failure (agent_events write fails)

**Detection:** the INSERT at the end of `runDaytimeTick()` throws or returns an error.

**Heartbeat guarantee and its limit:**

The intent is that the tick always writes a row — even when all checks fail, the row is
the evidence that the cron fired and the pipeline ran. This matters for the 3-day
stability counter in §11: "no row in agent_events" must mean "cron did not fire," not
"cron fired but INSERT failed."

In practice: INSERT failure is swallowed (identical to `runNightTick()` behavior — see
`tick.ts` line 114). The `DaytimeTickResult` is returned to the route handler and included
in the HTTP response body, which is captured in Vercel function logs. So even if Supabase
is completely unreachable, the Vercel logs prove the cron fired.

**Consequence for §11 stability counter:** the SQL query used to verify 3 clean days
(§11 "How to verify") counts agent_events rows. An INSERT failure produces a day with
zero rows — indistinguishable from "cron didn't fire" in the database. To surface this:

The existing `event_log_consistency` night_tick check must be extended (as a future task,
not part of 6.5) to flag "expected 1 daytime_tick row in the last 24h, found 0." This
makes INSERT failures visible in the morning digest. Until that extension ships, INSERT
failures are only visible in Vercel function logs.

For the §11 stability counter in v1: a day with zero rows resets the counter regardless
of cause. This is conservative — it is possible a cron fired successfully but the INSERT
failed. Accept that ambiguity for v1; fix it when the `event_log_consistency` extension
ships.

---

## 8. Cost ceiling

Ollama is local — **$0 API cost per tick**. Cost is denominated in time and memory.

### Time budget

```
Route-level timeout:      60 s
├── ollama_health:         5 s   (healthCheck() 5s timeout, unchanged from client default)
├── signal_review:        50 s   (extended safeCheck timeout — see §7.3)
│   ├── SELECT query:      2 s
│   └── generate() call:  45 s   (inner timeout, cold-load aware)
└── site_health:          15 s   (existing safeCheck default)
```

Total theoretical maximum (sequential, all at limit): 5 + 50 + 15 = 70s. This exceeds
the 60s route-level timeout. In the absolute worst case — all three checks run to their
limits back-to-back — the route timeout fires before site_health completes.

This is acceptable for v1 for two reasons:

1. In practice, checks run to their limits only in failure scenarios. A healthy tick
   (Ollama reachable, model warm) completes site_health well within 60s because
   signal_review finishes fast (< 5s warm, < 45s cold).
2. site_health already runs in night_tick at 02:00 MT. If the 18:00 MT daytime tick
   drops site_health due to a cold-model timeout, the site health check isn't lost
   for the day — it ran 16 hours earlier.

If this tradeoff becomes a real problem (signal_review routinely cold-loading and
starving site_health), the fix is: drop site_health from the daytime tick entirely.

**Target wall time:** < 30s on a warm model. The efficiency baseline will establish the
actual distribution after 7+ runs (per `BASELINE_MIN_RUNS`).

### Token budget (local)

Qwen 2.5 32B context window: 32K tokens. The `signal_review` prompt includes:

- System instruction: ~200 tokens
- Last 12 hours of `output_summary` fields (truncated): up to 4,000 tokens
- Instruction: ~100 tokens

Total prompt: < 5,000 tokens. Well within context. No chunking required for v1. If
agent_events volume grows enough that 12 hours of output_summary exceeds 4K tokens,
truncate to the most recent N rows rather than expanding the prompt.

### Memory

~18–20 GB VRAM for qwen2.5:32b at Q4. No concurrent Ollama workloads during the tick
window. Colin's machine stays under 24 GB VRAM ceiling.

---

## 9. Acceptance criteria

Machine-checkable. Tests must be written and passing before any Step 6.5 code is merged.
All SQL assertions are against the live Supabase test/staging instance; all HTTP assertions
are against the local dev server or Vercel preview URL.

### AC-1: Route exists, is authorized, and returns a valid DaytimeTickResult

```
GET /api/cron/daytime-tick
  Authorization: Bearer <CRON_SECRET>
→ HTTP 200
→ body is valid JSON with all of:
    tick_id       — string matching UUID format
    run_id        — string matching UUID format
    status        — one of: "completed" | "partial_failure" | "failed"
    duration_ms   — number ≥ 0
    checks        — array of exactly 3 objects, each with:
                      name     (string)
                      status   ("pass" | "fail" | "warn")
                      flags    (array)
                      duration_ms (number)
    started_at    — ISO 8601 string
    finished_at   — ISO 8601 string
```

### AC-2: Unauthorized requests are rejected and write nothing

```
GET /api/cron/daytime-tick
  (no Authorization header, CRON_SECRET is set in env)
→ HTTP 401
→ zero new rows in agent_events with task_type = 'daytime_tick'
   in the 10 seconds following the request
```

### AC-3: Exactly one agent_events row per invocation

```
-- Before invocation:
SELECT count(*) FROM agent_events WHERE task_type = 'daytime_tick'
  AND occurred_at > now() - interval '10 seconds'
→ 0

-- After one invocation:
→ 1

-- After a second invocation (10s+ later):
→ 1 (for the 10s window — total across both invocations = 2)
```

### AC-4: agent_events row has correct shape and quality_score

```sql
SELECT
  task_type,
  status,
  meta->>'mode' AS mode,
  meta->>'tunnel_used' AS tunnel_used,
  quality_score->>'scored_by' AS scored_by,
  quality_score->>'capacity_tier' AS capacity_tier,
  (quality_score->>'aggregate')::float AS aggregate,
  quality_score->'dimensions' AS dimensions
FROM agent_events
WHERE task_type = 'daytime_tick'
ORDER BY occurred_at DESC
LIMIT 1;
```

Expected:

- `task_type` = `'daytime_tick'`
- `mode` = `'daytime_ollama'`
- `scored_by` = `'rule_based_v1'`
- `capacity_tier` = `'tier_1_laptop_ollama'`
- `aggregate` between 0.0 and 100.0 inclusive
- `dimensions` contains keys: `completeness`, `signal_quality`, `efficiency`, `hygiene`
- `quality_score` is non-null

### AC-5: Ollama unreachable → HTTP 200, partial_failure, signal_quality = 25

```
Test setup: set OLLAMA_TUNNEL_URL to a guaranteed-unreachable URL
  (e.g., http://localhost:19999 — nothing listening)

GET /api/cron/daytime-tick (authorized)
→ HTTP 200  (route never 500s on Ollama failure)
→ body.status = "partial_failure"
→ body.checks contains check with name = "ollama_health" and status = "fail"
→ body.checks contains check with name = "signal_review" and status = "warn"

After invocation:
SELECT quality_score->'dimensions'->>'signal_quality' AS sq
FROM agent_events WHERE task_type = 'daytime_tick'
ORDER BY occurred_at DESC LIMIT 1;
→ sq = '25'
```

### AC-6: signal_quality timeout → 35, not 25 or 50

```
Test setup: OLLAMA_TUNNEL_URL is reachable (healthCheck passes),
  but generate() call is mocked/stubbed to time out after 45s

→ body.checks contains check with name = "signal_review" and status = "warn"
→ body.checks check named "signal_review" flags array contains entry
    with message containing "timed out"

SELECT quality_score->'dimensions'->>'signal_quality' AS sq ...
→ sq = '35'   (not '50' — timeout ≠ clean; not '25' — tunnel is reachable)
```

### AC-7: OLLAMA_TUNNEL_URL wiring is reflected in meta.tunnel_used

```
With OLLAMA_TUNNEL_URL set to a non-localhost URL:
  meta->>'tunnel_used' = 'true'

Without OLLAMA_TUNNEL_URL (falls back to localhost):
  meta->>'tunnel_used' = 'false'
```

Assert via the most recent agent_events row after invocation in each env config.

### AC-8: Feature flag gates the tick completely

```
Test setup: DAYTIME_TICK_ENABLED is unset or empty

GET /api/cron/daytime-tick (authorized)
→ HTTP 200
→ body = { "ok": false, "reason": "daytime-tick-disabled", "duration_ms": 0 }
→ zero new agent_events rows with task_type = 'daytime_tick' written
→ zero Ollama calls made
```

### AC-9: vercel.json cron entry is present and correct

```
Read vercel.json. Parse JSON. Assert crons array contains:
  { "path": "/api/cron/daytime-tick", "schedule": "0 18 * * *" }
```

This is a static file check, no server needed.

### AC-10: Tick completes within budget on warm model

```
Test setup: Ollama is reachable and qwen2.5:32b is loaded (warm)

GET /api/cron/daytime-tick (authorized)
→ HTTP 200 within 30 000ms wall clock
→ body.duration_ms < 30 000
```

Note: cold-model timing (< 60s) is verified during the manual canary phase (§10 rollout
step 3), not in automated tests, because reliably cold-loading the model in CI is not
practical.

### AC-11: Heartbeat row is written even when all three checks fail

```
Test setup: mock all three check functions to throw errors synchronously

GET /api/cron/daytime-tick (authorized)
→ HTTP 200  (route does not propagate check errors to HTTP status)
→ body.status = "failed"
→ exactly 1 new agent_events row with task_type = 'daytime_tick'
   written within 5 seconds
→ that row has status = 'error'
→ quality_score is non-null (scoring ran on the failed tick result)
```

This verifies the heartbeat guarantee from §7. A "cron fired but all checks broke" day
must be distinguishable from "cron did not fire" — the DB row is that distinction.

### AC-12: Night tick is unaffected after Step 6.5 deploys

```
→ npm test passes with all 370 prior tests green (no regressions)
→ agent_events rows with task_type = 'night_tick' continue to be written
   at the expected rate (checked via next night_tick run after deploy)
→ morning_digest rows continue to be written after night_tick
→ event_log_consistency check in night_tick does not produce new flags
   related to daytime_tick's presence in agent_events
```

The last point requires that `KNOWN_EVENT_DOMAINS` in `lib/orchestrator/config.ts`
remains unchanged — `'orchestrator'` domain already covers daytime_tick since it uses
`domain: 'orchestrator'` in its agent_events rows.

---

## 10. Rollout

### Feature flag

`DAYTIME_TICK_ENABLED` environment variable.

- **Truthy** (`1`, `true`, any non-empty string): tick runs normally
- **Absent or empty**: route returns immediately:
  ```json
  { "ok": false, "reason": "daytime-tick-disabled", "duration_ms": 0 }
  ```
  No agent_events write. No Ollama call.

This is the fast-disable path. Set `DAYTIME_TICK_ENABLED=` (empty) in Vercel env dashboard
→ redeploy is not required (env var changes take effect on next invocation).

### Rollout order

1. **Prerequisites (no code):**
   - Set `OLLAMA_TUNNEL_URL` in Vercel production env (the Cloudflare tunnel URL)
   - Verify tunnel is running locally on Colin's machine
   - Confirm qwen2.5:32b is pulled and available (`ollama list`)

2. **Code merged, feature flag off:** merge Step 6.5 PR with `DAYTIME_TICK_ENABLED` not set.
   Existing behavior unchanged. Route exists but is inert.

3. **Manual canary:** invoke the route manually via curl or the Vercel dashboard:

   ```
   POST https://lepios-one.vercel.app/api/cron/daytime-tick
     Authorization: Bearer <CRON_SECRET>
   ```

   Verify: HTTP 200, agent_events row appears in Supabase, `tunnel_used: true` in meta,
   `quality_score` non-null, `ollama_health` check passes, `signal_quality` in expected
   range per §6 table.

4. **Enable cron:** set `DAYTIME_TICK_ENABLED=1` in Vercel env. The cron fires at the
   next scheduled time (18:00 UTC). Monitor agent_events for the first few days.

5. **Observe:** 3+ consecutive days clean before Sprint 4 resumes (see §11).

### Fast disable

Two ways to disable, in order of speed:

1. **Env var (fastest):** set `DAYTIME_TICK_ENABLED=` (empty) in Vercel → immediate on
   next cron invocation. No redeploy.
2. **Remove from vercel.json:** removes the cron schedule. Requires a deploy. The route
   still exists and can be invoked manually.

---

## 11. Resume-Sprint-4 criteria

Sprint 4 is paused awaiting Step 6.5 per `docs/sprint-state.md`. The criteria for resuming:

### Required (all must be true simultaneously)

1. **OLLAMA_TUNNEL_URL is set and verified in Vercel production env.**
   Verification: `tunnel_used: true` appears in at least one daytime_tick `agent_events` row.

2. **Three consecutive days of daytime ticks completing with `status: 'completed'`.**
   "Consecutive" means no `partial_failure` or `failed` row in `agent_events` where
   `task_type = 'daytime_tick'` during those three calendar days (MT timezone).
   A day with zero rows — whether because the cron didn't fire or the INSERT failed —
   does not count toward the three days and resets the counter.

3. **No regressions to the Step 6 overnight loop during the observation window.**
   The night_tick must not introduce new failures in `event_log_consistency` or
   `scan_integrity` checks during the same three-day period.

4. **AC-12 holds:** 370 existing unit tests still passing on main at resume time.

### Not required

- Three days of _perfect_ quality scores (aggregate = 100). `partial_failure` from an
  Ollama cold-load timeout on day 1 is acceptable context, not a blocker, as long as the
  _pattern_ is clean (day 2 and 3 both `completed`). Use judgment. The spirit is:
  "the pipeline is stable," not "the pipeline is perfect."

### How to verify

```sql
-- Check last 3 calendar days (MT)
SELECT
  date_trunc('day', occurred_at AT TIME ZONE 'America/Denver') AS day_mt,
  count(*)                                               AS ticks,
  count(*) FILTER (WHERE status = 'success')             AS clean,
  count(*) FILTER (WHERE status != 'success')            AS dirty,
  count(*) FILTER (WHERE quality_score IS NOT NULL)      AS scored
FROM agent_events
WHERE task_type = 'daytime_tick'
  AND occurred_at > now() - interval '4 days'
GROUP BY 1
ORDER BY 1 DESC;
```

**Resume criteria met when:** three rows present, all with `ticks = 1, clean = 1, dirty = 0`.

When criteria are met: update `docs/sprint-state.md` — set `status` to `active`, clear
`awaiting` and `paused_reason`, set `last_updated_at` to the resume date.
