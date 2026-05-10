# Quota Forecaster Audit — 2026-05-09

**Branch:** feat/routines-quota-forecaster  
**Triggered by:** 429 cliffs at 14:35 UTC + 20:40 UTC + 02:40 UTC (next day)  
**Status:** Phase 0 complete — awaiting "go" for Phase 1

---

## 1. Today's 429 Timeline (grounded, agent_events)

| Time (UTC)       | Event                   | upstream_status | retry_after     | Task     |
| ---------------- | ----------------------- | --------------- | --------------- | -------- |
| 2026-05-09 14:35 | **429 cliff #1**        | 429             | 43710s (12.14h) | 3d3869f3 |
| 2026-05-09 20:40 | **429 cliff #2**        | 429             | 21810s (6.05h)  | 3d3869f3 |
| 2026-05-10 02:40 | **429 cliff #3**        | 429             | 210s (3.5min)   | a3de7bed |
| 2026-05-10 02:45 | Success — quota reset   | —               | —               | a3de7bed |
| 2026-05-10 02:50 | Network abort (not 429) | —               | —               | dbbb1a53 |
| 2026-05-10 02:55 | Success                 | —               | —               | dbbb1a53 |

**Invocations (successes) on 2026-05-09 before cliff #1 (14:35):**

| #   | Time (UTC)       | Task     |
| --- | ---------------- | -------- |
| 1   | 2026-05-08 23:06 | 3dcf9706 |
| 2   | 2026-05-09 02:43 | 57ef5c6a |
| 3   | 2026-05-09 02:44 | 3dcf9706 |
| 4   | 2026-05-09 03:02 | d82411e1 |
| 5   | 2026-05-09 03:28 | 3dcf9706 |
| 6   | 2026-05-09 11:13 | d4c6e2ae |
| 7   | 2026-05-09 12:32 | b362b865 |
| 8   | 2026-05-09 13:55 | 4aa53419 |
| 9   | 2026-05-09 14:00 | efa60e5c |
| 10  | 2026-05-09 14:05 | a2edc7ba |
| 11  | 2026-05-09 14:10 | a3de7bed |
| 12  | 2026-05-09 14:15 | 3d3869f3 |
| 13  | 2026-05-09 14:20 | dbbb1a53 |
| 14  | 2026-05-09 14:25 | c12da8dd |
| 15  | 2026-05-09 14:30 | da9bba88 |
| 16  | **14:35 → 429**  | —        |

**Conclusion:** Routines API hard limit = **~15–16 successful invocations per 24h rolling window.**  
The 24h window anchors to the oldest invocation (02:43 May 9 + 24h = 02:43 May 10 → matches observed reset).

---

## 2. Current Quota System Architecture (grounded)

### Files and their actual roles

| File                                | What it does                                                                         | Called from                          |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `lib/harness/invoke-coordinator.ts` | Fires Routines API; logs success/error (with `retry_after`) to `agent_events`        | `pickup-runner.ts:393`               |
| `lib/harness/quota-guard.ts`        | Reactive: looks back 6h for 429 events; returns `safe_to_claim`                      | `pickup-runner.ts:277`               |
| `lib/harness/quota-forecast.ts`     | Proactive: counts 24h invocations vs `CLIFF_THRESHOLD=10`; checks active 429 backoff | **NOT called from pickup-runner.ts** |
| `lib/harness/quota-monitor.ts`      | Token budget check (HARNESS_QUOTA_TOKENS_USED); halts continuous mode                | **NOT called from pickup-runner.ts** |
| `lib/harness/quota-cliff.ts`        | F18 digest line: 429 count + stuck tasks                                             | `digest.ts` only                     |

### harness_config quota keys (grounded)

| Key                          | Value       | Status                                   |
| ---------------------------- | ----------- | ---------------------------------------- |
| `HARNESS_QUOTA_TOKENS_USED`  | `"0"`       | **Dead — never incremented**             |
| `HARNESS_QUOTA_TOKENS_LIMIT` | `"1000000"` | Placeholder                              |
| `HARNESS_QUOTA_THRESHOLD`    | `"40"`      | App-layer token threshold — wrong signal |
| `HARNESS_HALTED`             | `"false"`   | Active                                   |
| `HARNESS_CONTINUOUS_RUN_ID`  | (UUID)      | Active                                   |

---

## 3. Root Cause Analysis

### Root cause 1 — Proactive check not wired (primary)

`quota-forecast.ts::forecastQuotaBeforeStart()` exists and has correct logic (burn rate + cliff check), but **is not imported or called from `pickup-runner.ts`**. It was designed for "coordinator startup" gating but the coordinator startup path doesn't hit the pickup runner.

If it were wired at line 277 (before `preClaimQuotaCheck`), today's cliff would have been caught at invocation 8 (10 - 3 = 7 remaining → unsafe when ≥ CLIFF_THRESHOLD - TASK_COST_MAX).

### Root cause 2 — Guard window shorter than retry_after (secondary)

`quota-guard.ts::GUARD_WINDOW_MS = 6h` but today's first 429 had `retry_after = 43710s (12.14h)`.

Timeline of failure:

- 14:35: 429 recorded with retry_after=43710s → cutoff=02:44 May 10
- 20:40: guard looks back 6h → 14:35 event is **6h 5min ago = outside window** → sees no 429 → says "safe_to_claim" → fires → hits 429 again

Extending GUARD_WINDOW_MS to 24h would fix this entirely, but it's still a lookback query (O(n) scan of agent_events every 5 min).

### Root cause 3 — Token budget signal is wrong (tertiary)

`HARNESS_QUOTA_TOKENS_USED = "0"` is never incremented. But even if it were, Anthropic API tokens ≠ Routines API invocations. The quota that matters is **invocation count**, not token count. The entire token-budget branch of `quota-monitor.ts` is wrong-signal and should be replaced.

---

## 4. What Works Today

- `invoke-coordinator.ts` correctly captures `retry_after` from the response header and logs it to `agent_events.meta.retry_after` — this is the source of truth the guard uses
- `quota-guard.ts` logic is correct for the cases it sees — the window is the only bug
- `quota-cliff.ts` F18 digest line is correct — surfaced today's 429 count accurately
- `agent_events` has complete invocation history for forensic analysis

---

## 5. Three Forecaster Designs

### Design A — Minimal Fix (2–3h build)

**Changes:**

1. `quota-guard.ts`: extend `GUARD_WINDOW_MS` from 6h → 24h
2. `pickup-runner.ts`: add `forecastQuotaBeforeStart()` call before `preClaimQuotaCheck()` (import already nearby, add ~10 lines)
3. `quota-forecast.ts`: update `CLIFF_THRESHOLD` from 10 → 12 (confirmed safe from today's data; actual limit ~15-16)

**Stops today's failure modes:** Yes — both cliff #2 (guard window) and future proactive halting (forecast wired)  
**Proactive vs reactive:** Partially proactive (forecast wired = proactive halt before cliff)  
**New DB tables:** 0  
**New harness_config keys:** 0  
**Build complexity:** Low — all edits to existing files, ~25 lines total  
**Risk:** CLIFF_THRESHOLD=12 still leaves 3-4 buffer invocations (safe); guard window=24h costs one extra DB lookup per tick (negligible)

**Verdict:** Fixes the immediate problem. Doesn't eliminate the agent_events lookback query per tick.

---

### Design B — Persistent Backoff Cursor (4–6h build) ✅ Recommended

**Changes:**

1. `invoke-coordinator.ts`: on 429, write `ROUTINES_BACKOFF_UNTIL` ISO timestamp to `harness_config`; on success, write `ROUTINES_INVOCATIONS_TODAY` count + `ROUTINES_INVOCATIONS_WINDOW_START` ISO (lazy-reset when > 24h old)
2. `quota-guard.ts`: primary check reads `ROUTINES_BACKOFF_UNTIL` from `harness_config` (O(1), no lookback); falls back to agent_events lookback if key absent
3. `quota-forecast.ts`: primary check reads `ROUTINES_INVOCATIONS_TODAY` from `harness_config`; falls back to agent_events count if key absent. Update `CLIFF_THRESHOLD` to 12.
4. `pickup-runner.ts`: wire `forecastQuotaBeforeStart()` before `preClaimQuotaCheck()`
5. Remove dead token-budget branch from `quota-monitor.ts` (or mark clearly as disabled)

**Stops today's failure modes:** Yes — completely  
**Proactive vs reactive:** Fully proactive — pickup halts before cliff, not after  
**New DB tables:** 0  
**New harness_config keys:** 3 (`ROUTINES_BACKOFF_UNTIL`, `ROUTINES_INVOCATIONS_TODAY`, `ROUTINES_INVOCATIONS_WINDOW_START`)  
**Build complexity:** Medium — 5 files, ~100 lines, 1 migration (seed 3 harness_config keys)  
**Risk:** Low — all keys have agent_events fallback; fails open if harness_config write fails  
**F18:** Guard/forecast reads become O(1) harness_config lookups → no per-tick DB scan  
**20% better:** Eliminates per-pickup lookback query + adds proactive cliff avoidance

**Verdict:** Right scope. Solves the root cause (not just the symptom). Cheap enough to build clean.

---

### Design C — Full Predictive Halt + Digest Surface (8–12h build)

**All of Design B plus:**

- `quota-monitor.ts`: replace token budget with Routines invocation count; proactively set `HARNESS_HALTED=true` when count ≥ CLIFF_THRESHOLD - TASK_COST_MAX (halts BEFORE first 429)
- Morning digest: add "Routines: X/15 invocations (24h) — resets HH:MM UTC" line
- `quota-cliff.ts`: update to show cursor-based remaining + reset time
- Telegram alert when proactive halt triggered (not just post-429 alert)

**Stops today's failure modes:** Yes, plus prevents first 429 entirely  
**New migrations:** 1 (seed new keys)  
**Build complexity:** High — 8 files, ~200 lines  
**Risk:** Medium — proactive halt means coordinator stops before hitting any errors; user must confirm intended behavior  
**F18:** Full observability — Colin can ask "how many Routines left today?" and get a live number

**Verdict:** The ideal end state. But the 20% better gains over Design B are marginal for today's problem.

---

## 6. Recommendation

**Design B.** Fixes both root causes cleanly, adds proactive cliff avoidance, adds O(1) guard, and fits in a ~4-6h build window. Design A is too minimal (still reactive on cliff; doesn't add proactive halt). Design C is the right long-term state but non-urgent — the proactive halt and digest surfacing can follow in a fast-follow chunk once B is stable.

### Required migration: 0175

Seed 3 new `harness_config` keys:

```sql
INSERT INTO harness_config (key, value) VALUES
  ('ROUTINES_BACKOFF_UNTIL', ''),
  ('ROUTINES_INVOCATIONS_TODAY', '0'),
  ('ROUTINES_INVOCATIONS_WINDOW_START', '')
ON CONFLICT (key) DO NOTHING;
```

### Acceptance criteria (Design B)

- [ ] After a 429, `ROUTINES_BACKOFF_UNTIL` is populated within 1s; pickup ticks return `quota-guard` until timestamp passes
- [ ] Guard no longer relies solely on 6h lookback; 12h backoff is honored in full
- [ ] Pickup halts proactively when `ROUTINES_INVOCATIONS_TODAY ≥ CLIFF_THRESHOLD - TASK_COST_MAX` (i.e., ≤ 3 remaining)
- [ ] On quota reset (first success after backoff), `ROUTINES_INVOCATIONS_TODAY` resets and `ROUTINES_BACKOFF_UNTIL` clears
- [ ] All changes fail open — guard/forecast errors never block pickup
- [ ] Dead token-budget branch (`HARNESS_QUOTA_TOKENS_USED`) removed or clearly disabled
- [ ] `agent_events` fallback present in guard + forecast if harness_config keys are absent

---

_Grounding sources: agent_events (SQL), harness_config (SQL), lib/harness/quota-guard.ts, quota-forecast.ts, quota-monitor.ts, quota-cliff.ts, invoke-coordinator.ts, pickup-runner.ts_
