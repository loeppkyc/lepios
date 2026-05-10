# Safety Agent — Phase 0 Audit

**Date:** 2026-05-10 (Saturday 01:55 MT / 07:55 UTC)
**Branch:** feat/safety-agent-phase0
**Status:** Audit only — no code changes

---

## 1. Existing scaffolding — what was found

### Code (15 files, 2,066 LOC in lib/harness/safety/v2/)

| File | LOC | Status |
|------|-----|--------|
| `driver.ts` | 302 | Complete — orchestrates all 5 signals + E2E + scorer + router + persist |
| `gate-adapter.ts` | 252 | Complete — GitHub Compare API diff fetch + `runSafetyGateCheck` |
| `scorer.ts` | 142 | Complete — weights from harness_config, per-key cap, secret auto-high |
| `router.ts` | 107 | Complete — all 6 routing branches wired |
| `types.ts` | 82 | Complete — `PRDiffInput`, `SignalFinding`, `WeightKey`, `SafetyAction`, `RiskTier` |
| `signals/secret.ts` | 114 | Complete — 8 patterns, env-ref + comment-line skip |
| `signals/schema.ts` | 164 | Complete — DROP/TRUNCATE/DELETE-no-WHERE, ADD/DROP COLUMN, RLS coverage check |
| `signals/scope.ts` | 134 | Complete — LOC vs `plan_loc * 2` (NULL plan = 0 signal) |
| `signals/coverage-delta.ts` | 97 | Complete — 5%pt / 15%pt drop tiers; null-guards when coverage absent |
| `signals/failures-pattern.ts` | 159 | Complete — JSONB containment query against open/recurring failures_log rows |
| `e2e/runner.ts` | 157 | Complete — Puppeteer E2E runner (browser factory injected) |
| `e2e/archival.ts` | 94 | Complete — archives failures to failures_log |
| `e2e/types.ts` | 76 | Complete — `BrowserFactory`, `E2EAssertion`, `E2EResult` |
| `e2e/test-user.ts` | 55 | Complete — cookie helper for authenticated assertions |
| `arbiter.ts` | 89 | Complete — twin POST + response parse |
| `digest.ts` | 42 | Complete — daily digest formatter |

**Additional safety code pre-dating v2:**
- `lib/harness/safety/{static,index,llm-review,approval}.ts` — 841 LOC (v1, pre-commit path)
- `lib/safety/checker.ts` — 411 LOC (v1 pre-commit)
- `scripts/verify-safety.ts` + `scripts/pre-commit-safety.mjs` — CI + pre-commit static scan

**`app/api/twin/safety-arbitrate/route.ts`** — twin arbiter endpoint (v2 medium-tier path)

**TypeScript:** `tsc --noEmit` passes clean for all safety/v2 files.

### Schema (all live in prod)

| Object | Status |
|--------|--------|
| `safety_decisions` table | Live — 14 columns, correct shape |
| `task_queue.plan_loc INT NULL` | Live — added by migration 0162 |
| `SAFETY_WEIGHT_*` harness_config rows (11 keys) | Live — seeded by 0162 |
| `SAFETY_THRESHOLD_LOW_MAX = 29` | Live |
| `SAFETY_THRESHOLD_MEDIUM_MAX = 70` | Live |

### Deploy gate integration

`app/api/cron/deploy-gate-runner/route.ts` line 594:
```
smoke passed → runAndRecordSafetyCheck() → if blocking: continue → schema check
```
The safety gate is wired **between smoke pass and schema check** on every non-migration clean path. Schema-migration path also calls it (line 693). `runSafetyGateCheck` fetches the PR diff from GitHub Compare API, runs the 5 signals, scores, routes, persists to `safety_decisions`, sends Telegram on block.

### Prior audit docs

- `docs/decisions/safety-agent-direction.md` — 2026-04-28: three options (build/rename/remove). Colin never recorded a pick; the code was built (Option A) without a formal decision.
- `docs/lepios/safety-agent-audit.md` — 2026-05-08: pre-Phase-2 infrastructure audit. Found ~1,252 LOC reuse estimate. Key open questions from that audit: F-N9 mis-citation (resolved — no 800-LOC rule exists), PR-vs-base diff via GitHub API (now resolved in gate-adapter.ts), GITHUB_TOKEN needed (still the live gap, see §3).

---

## 2. Harness component row

`harness_components` has **no row** for safety_agent. All 21 existing rows show 100%. T-002's progress is tracked only in `docs/leverage-targets.md` as "Current %: 0 / Done %: 100".

Contrast: `harness:deploy_gate` (weight 3%) = 100%.

The 0% label is accurate in one sense — 0 safety_decisions rows exist, meaning the system has **never produced a live decision** — but misleading about code completion. Better framing: code = ~90% done; live = 0%.

---

## 3. Why it has never fired (root cause of the 0%)

**Root cause: `GITHUB_TOKEN` not set in Vercel production.**

Evidence chain:
1. `gate-adapter.ts` line 1: `const token = process.env.GITHUB_TOKEN; if (!token) return { input: null, error: 'config' }`
2. When diff fetch returns `null`: gate records `safety-diff-fetch-failed` in `results[]`, returns `blocking: false`. **Non-blocking infra failure does NOT write to `safety_decisions`.**
3. `agent_events` query for `infra_error` in gate meta → zero rows.
4. `harness_config` has no `GITHUB_TOKEN` key (token not in DB-resident config either).
5. Deploy gate last fired: **2026-04-22**. All PRs merged since then (including today's #212 + #214) — 0 safety_decisions rows.

Secondary: deploy gate itself has been dormant since 2026-04-22. The gate fires on `deploy_gate_triggered` events written by CI. No such events appear in `agent_events` for any recent PRs — the trigger event insertion may also have drifted. This is worth verifying separately (out of scope for Phase 0).

**Fix:** Set `GITHUB_TOKEN` (a classic GitHub PAT with `repo` read scope) in Vercel env vars. One key unlocks all 5 signals because the Compare API is the only external call in the diff-fetch path.

---

## 4. Auto-merge gate today — what's wired vs missing

**Current flow (wired):**

```
PR open → Vercel preview build
→ CI passes → deploy_gate_triggered event inserted
→ deploy-gate-runner cron picks up (5-min pg_cron tick)
→ smoke check (GET /api/health on preview URL)
→ [Safety Agent: fetch diff → 5 signals → score → route]  ← code wired, GITHUB_TOKEN missing
→ schema check (migration files via GitHub API)
→ schema-clean → runAutoPromote (merge to main)
→ schema-migrations → Telegram approval card to Colin
```

**What's missing for full T-002 done_state:**

| Gap | Severity | Fix |
|-----|----------|-----|
| `GITHUB_TOKEN` not in Vercel | **Blocking** — nothing runs without it | Set PAT in Vercel env, add harness_config seed migration |
| E2E assertions not populated | Medium — e2e_pass = null on all PRs; router treats null as "no surface, proceed" | Phase 1 work: each module's done_state must declare surface URLs; builder wires assertions when done_state specifies E2E |
| coverage signal requires base data | Low — signal null-guards when coverage absent | Coverage is optional until vitest/coverage-v8 baseline job runs on main |
| `harness_components` row missing | Low — no bump directive fires, rollup understimates harness % | Add row via migration |
| deploy_gate_triggered events not firing on recent PRs | Unknown — gate itself may be dormant | Investigate separately |

---

## 5. Three designs — build cost vs coverage

All three assume `GITHUB_TOKEN` fix is a prerequisite (same for all).

### Design A — Static signals only (current state + GITHUB_TOKEN)

**What it does:** Run the 5 already-written static/pattern signals (secret, schema, scope, coverage-delta, failures-pattern). No E2E, no twin arbiter. Routing: low → auto-merge; medium/high → colin_escalate (no twin path).

**Build cost:** ~2h
- Add `GITHUB_TOKEN` to Vercel + seed migration for harness_config pointer
- Disable twin path temporarily (set twin_arbiter_url = undefined in gate-adapter call)
- Add `harness_components` row at 60% (signals wired, no E2E)
- Smoke-test with a real PR

**Coverage:**
- Catches: hardcoded secrets, destructive SQL, scope creep, test coverage drops, recurring failure patterns
- Misses: UI regression, autonomous-authored code hallucinations (no twin reasoning)
- False-positive risk: higher than B/C because medium-tier goes straight to Colin (no twin to reason about context)

**Best for:** Unblocking auto-merge immediately. Delivers value day 1.

---

### Design B — Static + twin arbiter (recommended)

**What it does:** Design A + medium-tier twin path. Twin receives PR context (branch, LOC, signals breakdown, top findings) and returns PROCEED / HOLD / ESCALATE.

**Build cost:** ~4h
- Everything in A
- Verify `/api/twin/safety-arbitrate` route is live and reachable (F-L4 prevention: test it before referencing)
- Set `twin_arbiter_url` in gate-adapter (already the default when `CRON_SECRET` is set)
- Tune twin prompt in `arbiter.ts` with a sample medium-score PR context
- Add at least 2 safety-reasoning entries to twin corpus (what makes a PR high-risk vs not)

**Coverage:** Everything in A plus:
- Medium-risk PRs get reasoned review, not immediate escalation
- Twin can consider context static signals miss (PR description, task type, author history)
- Fewer Colin interrupts on routine medium-risk PRs (adding an API route, touching coordinator code)

**F18 benchmark target:** ≥80% of medium-tier PRs routed without Colin (twin_proceed or twin_hold vs colin_escalate).

**Best for:** Full T-002 done_state at ~60% coverage. E2E still missing, but the signal+twin path is the core value loop. Recommended first phase.

---

### Design C — Static + twin + capability-aware (full T-002)

**What it does:** Design B + E2E assertions per module done_state + capability-arms-legs cross-reference.

**Build cost:** ~10–15h (across multiple builder tasks)
- Everything in B
- Per-module E2E assertions: each module's done_state must declare surface URLs + interactions. Builder wires `e2e_assertions` when done_state specifies E2E.
- Capability-aware signal: cross-reference PR diff against `capability_registry` — if PR adds a new `arms_legs` capability or loosens a sandbox guard, flag +30 regardless of LOC
- Vitest coverage-v8 baseline job (runs on each main commit, stores JSON in harness_config)
- Post-merge production smoke using `runE2E` as replacement for route-health HTTP-only checks

**Coverage:** Full T-002 spec. Catches UI regressions that static signals miss. Capability privilege escalation (e.g., PR that adds `net.outbound.all` to capability_registry scores +30 automatically).

**Best for:** After B is proven stable (2+ weeks clean). Don't build E2E fixtures before the module's done_state is verified — E2E on wrong interactions is noise.

---

## 6. F18 metrics + F19 % delta

### F18 — Metrics + benchmark

**Capture table:** `safety_decisions` (already live)

| Metric | Query | Unit |
|--------|-------|------|
| `prs_reviewed` | `SELECT COUNT(*) FROM safety_decisions` | count/day |
| `auto_merge_rate` | `COUNT WHERE action='auto_merge' / total` | % |
| `blocks_issued` | `COUNT WHERE action IN ('colin_escalate','twin_hold','twin_escalate')` | count/day |
| `false_positive_rate` | Manual: blocks Colin overrides after grounding check | % of blocks |
| `median_review_latency` | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY decided_at - gate_triggered_at)` (requires joining agent_events) | seconds |
| `e2e_pass_rate` | `COUNT WHERE e2e_pass=true / COUNT WHERE e2e_pass IS NOT NULL` | % |
| `twin_clear_rate` | `COUNT WHERE action IN ('twin_proceed','twin_hold','twin_escalate') / COUNT WHERE tier='medium'` | % of medium-tier |

**Benchmark targets (from T-002 spec):**
- ≥95% of low+medium-risk autonomous (no Colin involvement)
- 100% high-risk escalated
- 0 missed criticals over 30-day window
- ≥98% E2E pass on first run (once E2E assertions exist)
- Median review latency ≤ 30s (static path); ≤ 90s (twin path)

**Surfacing path:** `morning_digest` line: "Safety: X auto-merged, Y twin-cleared, Z escalated, W E2E-failed". `/autonomous` cockpit page counter row: "Today: X blocks issued / Y false positives".

### F19 — % delta to log per cycle

**Primary signal:** `false_positive_rate` (% of blocks Colin overrides on grounding)
- Unit: "% of blocks overridden"
- Direction: lower = better
- Ceiling: 0% (no false positives) — declining trend from a low baseline = signals well-tuned
- Declining % indicates weight/threshold calibration has reached its ceiling → pivot to coverage-delta tuning or E2E additions

**Secondary signals:**
- `auto_merge_rate` — should trend upward as false-positive rate drops (trusting the system more)
- `median_review_latency` — should stay flat or improve as infra stabilizes

**Per-cycle reflection prompt (for morning_digest):**
> "Safety Agent: N reviews this week, X% auto-merge rate, Y% false-positive rate. Last week: Z% false-positive. Δ = [+/-]. Top signal contributor: [weight_key with most contributions]."

---

## Bottom line

The Safety Agent is a **90% code problem, not a 0% code problem.** 2,066 LOC of v2 code + full DB schema + gate integration exists and compiles clean. It has never produced a live decision because `GITHUB_TOKEN` is missing in Vercel — a single env var gap.

**Minimum viable unlock for auto-merge:**
1. Set `GITHUB_TOKEN` (GitHub PAT, `repo` read) in Vercel
2. Verify deploy_gate_triggered events are firing on recent PRs (gate may also be dormant)
3. Test with one PR

**Recommended Phase 1 (Design B):** After confirming GITHUB_TOKEN + gate liveness, tune the twin arbiter prompt and add 2 safety corpus entries. That's ~4h work to reach the full signal+twin path.

**Design C / E2E:** After B is stable for 2 weeks. Don't build E2E fixtures until module done_states are verified.

---

**Halt. Awaiting "go" for Phase 1.**
