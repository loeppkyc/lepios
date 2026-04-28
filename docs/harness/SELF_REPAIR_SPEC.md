# SELF_REPAIR_SPEC

**Status:** DRAFT 1 (2026-04-28) — for review. Not yet approved. No code written. **Hard-blocked** — see §Dependencies; spec lands now and waits.
**Source of truth (when approved):** This doc.
**Authority (when approved):** Migration `0050_self_repair_schema.sql` (or next-available) + `lib/harness/self-repair/*.ts` are written from this doc.
**Parent component:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) §`self_repair` — component #12 (T3, weight 6, currently 0%, target 50% per foundation spec §Priority #7).
**Sibling specs (hard prereqs):** [`SANDBOX_LAYER_SPEC.md`](SANDBOX_LAYER_SPEC.md) (provides `runInSandbox()` — self_repair is the *primary* downstream consumer named in sandbox §Downstream consumers) · [`SECURITY_LAYER_SPEC.md`](SECURITY_LAYER_SPEC.md) (provides `requireCapability()` + `agent_actions` + `secrets.get()` for the LLM key) · [`ARMS_LEGS_S2_SPEC.md`](ARMS_LEGS_S2_SPEC.md) (provides `httpRequest({capability:'net.outbound.github'})` for PR-open and `telegram()` for notify).
**Soft prereq:** Sentry SDK integration — **not live in repo** (verified 2026-04-28: zero imports of Sentry in `lib/app/scripts`). Foundation spec assumed Sentry as a trigger; this spec defers Sentry to slice 3 and uses `agent_events` as the slice 1 trigger source instead.

---

## Why this spec is high-stakes

Self-repair is "an agent modifies code based on a failure pattern, then opens a PR." The blast radius is the entire codebase. Wrong design here is far more consequential than wrong design in `arms_legs` (which is a wrapper) or `chat_ui` (which is a UI). Three load-bearing principles, all asserted as ADs below:

1. **No auto-merge in slice 1.** Ever. Every fix opens a PR for human review. (AD2)
2. **No execution outside the sandbox.** Drafted fixes run only in `runInSandbox()` worktrees; main workspace untouched until the PR is merged by a human. (AD3)
3. **Default deny on trigger expansion.** Each failure-source action type that self_repair watches must be explicitly opted-in via a registry table — not a wildcard. Slice 1 watches ONE action type only — `coordinator_await_timeout`. (AD4)

Foundation spec mentions "confidence score (auto-apply ≥ 8)" — this spec **explicitly defers** that line. Confidence scoring is slice 4+ and even then auto-apply requires a separate Colin-approved redline. See §Out of scope.

---

## At a glance

| Field                                | Proposed                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Component count change               | **0** — sub-decomposes `self_repair` for re-scoring                                                                            |
| New tables                           | **2** — `self_repair_runs` (one row per attempt, append-only via AD7-style GRANTs) + `self_repair_watchlist` (action-type opt-in registry) |
| New endpoints                        | **1** — `POST /api/harness/self-repair-tick` (cron-triggered every 5 min in slice 1)                                           |
| New libraries                        | **5** — `lib/harness/self-repair/{detector,context,drafter,verifier,pr-opener}.ts`                                             |
| New capability strings               | **3** — `tool.self_repair.read.agent_events`, `tool.self_repair.draft_fix`, `tool.self_repair.open_pr`                          |
| New agent identity                   | **`self_repair`** — registered in `agent_capabilities` slice 1 first commit                                                    |
| Slice 1 watchlist seed               | **`coordinator_await_timeout`** (resolved — see §AD4 / §M2)                                                                    |
| Auto-merge?                          | **NEVER in slice 1.** Confidence scoring deferred to slice 4+ behind explicit Colin redline.                                   |
| Auto-deploy?                         | **NEVER.** PRs go through existing deploy_gate. Self_repair never touches main directly.                                       |
| Migration                            | **0050** — `self_repair_runs` + `self_repair_watchlist` + AD7 GRANT lockdown + capability seed + watchlist seed (1 row)        |
| Honest target slice 1                | **~46%** — covers ONE failure action type end-to-end. See §Completion accounting.                                              |
| Foundation spec target               | 50% (~3 days). Slice 1's 46% is conservative; slice 2 broadens detector to land at 50%.                                        |
| Estimated effort slice 1             | **~3 days wall-clock** — five modules + tests + 0050 migration + cron wiring                                                   |
| Default posture                      | **Default deny on detection (watchlist opt-in); default deny on action (PR review required); audit every step** (cap_check + sibling event per module) |
| Hard prerequisites                   | sandbox slice 1+2 merged + security_layer slices 1+2+3+4 merged + arms_legs S2 merged. **None of these are merged today.**      |

---

## The problem

Foundation spec §`self_repair`:

> Closes the gap between "deploy fails" and "Colin notices." Agent reads failure logs → drafts fix → runs in sandbox → if green, opens PR; if not, escalates. Triggered by Sentry issue or failed deploy webhook. Bounded by retry limit (max 2 per CLAUDE.md global rule), confidence score (auto-apply ≥ 8), and sandbox.

> Status: `/autofix` skill exists at the user-invoked level; no autonomous trigger.

### Live audit (verified 2026-04-28)

**What exists:**

| Capability | Where | Notes |
| --- | --- | --- |
| `/autofix` slash command | `~/.claude/commands/autofix.md` | User-invoked. Operates in live workspace. Auto-commits + auto-pushes. No sandbox. No PR gate. **Useful as a manual companion; not the autonomous mechanism this spec scopes.** |
| Failure-pattern signal in `agent_events` | Supabase | 5 distinct action types observed: `drain_trigger_failed` (16), `notification_failed` (4), `amazon_orders_sync_failed` (3), `coordinator_await_timeout` (2), `ollama.circuit_probe_failed` (1). Total 26 events. |
| Pre-push hook | `.husky/pre-commit` | AI reviewer + lint-staged. Catches things before commit. Self_repair operates on what slipped through. |
| `/api/harness/task-pickup` cron | Live | Pattern-match for self_repair's own cron — 5-min poll on `agent_events`. |

**What's missing — the autonomous-self-heal gap:**

1. **No autonomous trigger.** `/autofix` requires Colin to type the command. There's no cron that detects a failure pattern and acts on it.
2. **No Sentry SDK.** Foundation spec assumed Sentry as the primary trigger; verified absent. `agent_events` failure rows are the slice-1 trigger source instead.
3. **No deploy-failure webhook.** GitHub Actions webhook → self_repair would be the natural pipe; not wired.
4. **No `self_repair_runs` table.** Every attempt needs an audit trail row distinct from `agent_actions` (which carries cap_check; not "did the LLM draft a sensible fix?").
5. **No watchlist of opt-in failure types.** Without a registry, a wildcard listener on `*_failed` events would attempt to fix transient infrastructure issues, retry storms, and hostname blips. That's noise, not signal.
6. **No PR-open path from agent code.** Without arms_legs S2's `httpRequest({capability:'net.outbound.github'})`, self_repair cannot open PRs without bespoke fetch wrappers.
7. **No drafted-fix LLM integration.** `lib/orb/identity.ts` is for chat; there's no system prompt or retrieval pipeline for "given a failure trace + relevant files, draft a unified diff."

Slice 1 fixes #1, #4, #5, #7 for ONE watchlist-opted-in action type. #2, #3, #6 land in later slices or piggyback on other components.

---

## Architecture decisions (seven)

### AD1. Slice 1 watches `agent_events`, not Sentry, not GitHub Actions

Foundation spec named Sentry + failed-deploy webhook as triggers. Neither is live. `agent_events` IS live, has 26 historical failure rows across 5 action types, and is already the canonical observability bus for the harness. Slice 1 polls it.

Rationale: building self_repair against a trigger source that doesn't exist would force this spec to also scope Sentry SDK setup + GitHub Actions webhook receiver. Both are real but separable. Defer to slice 3 (Sentry) and slice 2 (GitHub Actions) once self_repair's core loop is proven.

### AD2. NEVER auto-merge in slice 1. Period.

Every drafted fix opens a PR. Colin reviews. Colin merges (or doesn't). Self_repair's success metric is "draft a fix that passes review and merges within 7 days," not "land a fix without human review."

Foundation spec's "auto-apply ≥ 8" line is acknowledged and **explicitly deferred to slice 4+ behind a separate Colin-approved redline**. The reason: sandbox-passing tests do not equal production-correct fix. The LLM can hallucinate a change that compiles + tests green + breaks the actual user behavior subtly. Human PR review is the catch.

This is asserted in §Out of scope and pinned by acceptance J (CI-enforced lint rule against auto-merge calls in `lib/harness/self-repair/`).

### AD3. ALL drafted-fix execution happens inside `runInSandbox()`. Main workspace untouched until human merge.

Self_repair never `git apply`s to the live workspace. The drafted-fix flow:

1. Sandbox spec creates a worktree with the current branch HEAD as base (per sandbox spec §M1 lifecycle).
2. Drafted patch is written to files inside the worktree.
3. Verification commands (`npm test`, `npm run lint`, `tsc --noEmit`) run inside the worktree via `runInSandbox()`.
4. Sandbox returns the diff via `SandboxRunResult.diffStat` + `filesChanged`.
5. PR is opened against main using the diff text — the *worktree* is the source of truth for the PR contents.
6. Worktree cleanup follows sandbox spec §M1 (`cleanupSandbox(runId)` after PR is opened).

If sandbox returns `warnings: ['process_isolation_not_enforced']` (which it will in sandbox slice 1, per sandbox AD1), self_repair logs a warning to `self_repair_runs.warnings` but proceeds — the PR review is the second gate. This is acceptable risk because no main-branch state has changed.

### AD4. Watchlist registry — explicit opt-in per failure action type. **Slice 1 seed: `coordinator_await_timeout` only.**

`self_repair_watchlist` table:

```sql
CREATE TABLE public.self_repair_watchlist (
  action_type   TEXT     PRIMARY KEY,           -- e.g. 'coordinator_await_timeout'
  enabled       BOOLEAN  NOT NULL DEFAULT true,
  notes         TEXT,                            -- why this is on the list
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by      TEXT     NOT NULL DEFAULT 'colin'
);
```

Self_repair detector polls `agent_events` rows where `action IN (SELECT action_type FROM self_repair_watchlist WHERE enabled=true)`. Without a row, no attempt fires. Adding a new action type = one row insert (later: a Telegram callback button).

**Slice 1 seeds exactly ONE row** (per migration 0050):

```sql
INSERT INTO self_repair_watchlist (action_type, enabled, notes, added_by)
VALUES (
  'coordinator_await_timeout',
  true,
  'Slice 1 seed: code-fixable signal (missing handler / too-tight timeout). Low historical noise (2 events). Selected over high-volume drain_trigger_failed because the latter is transient infrastructure, not code.',
  'colin'
);
```

Why `coordinator_await_timeout` over `drain_trigger_failed` (highest volume): code-fixable signal beats raw count. A timeout in coordinator's await loop suggests a missing handler or a too-tight constant in code — the LLM has a real chance of producing a sensible patch. `drain_trigger_failed` is mostly rate-limit / network blips that retry naturally. Wrong seed = false-positive PRs that erode trust.

### AD5. Confidence scoring is NOT in slice 1

The drafter LLM does not return a numeric confidence. Slice 1's success criterion is "the sandbox tests pass after applying the drafted patch." If they pass, open the PR; if they don't, log to `self_repair_runs.status='verify_failed'` and escalate via Telegram.

Pass/fail is a binary signal. Confidence-as-a-number is a model-of-the-model that we do not need to ship to land slice 1's value (the autonomous PR-open).

Slice 4+ may add confidence scoring as the gate for "auto-merge approved" (Colin redline required at that time, per AD2).

### AD6. Drafter LLM is Claude Sonnet by default; agent_id is `self_repair`

Why Sonnet (not Opus, not Ollama):
- Opus: too expensive for routine fixes ($15/Mtoken vs Sonnet's $3/Mtoken). Reserve for Colin-driven sessions.
- Sonnet: best cost/quality for "given trace + files, return unified diff." Today's repo callers already use Sonnet for `scripts/ai-review.mjs`.
- Ollama: free but qwen2.5-coder:3b is too small for this task (per chat_ui spec R2, even tool-call reliability is borderline). Revisit at qwen2.5:14b post-eGPU.

`agent_id='self_repair'` (parallel to `'chat_ui'` per chat_ui AD4). Slice 1 first commit seeds capability grants:

```sql
INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('self_repair', 'tool.self_repair.read.agent_events', 'log_only', 'colin', 'self_repair slice 1 — failure detection'),
  ('self_repair', 'tool.self_repair.draft_fix',         'log_only', 'colin', 'self_repair slice 1 — LLM call to draft a patch'),
  ('self_repair', 'tool.self_repair.open_pr',           'log_only', 'colin', 'self_repair slice 1 — open GitHub PR'),
  ('self_repair', 'net.outbound.anthropic',             'log_only', 'colin', 'self_repair — Sonnet API for fix drafter'),
  ('self_repair', 'net.outbound.github',                'log_only', 'colin', 'self_repair — PR open via arms_legs httpRequest'),
  ('self_repair', 'net.outbound.telegram',              'log_only', 'colin', 'self_repair — notify on PR open / verify failure'),
  ('self_repair', 'sandbox.run',                        'log_only', 'colin', 'self_repair — runInSandbox for verification');
```

Note: `secret.read.ANTHROPIC_API_KEY` and `secret.read.GITHUB_TOKEN` grants depend on security_layer slice 4 having seeded those rows. If they haven't, slice 1 reads via `process.env` directly per arms_legs S2 AD5. Hard prereq stays "security_layer slices 1+2+3" (with 4 soft-recommended for clean secrets).

### AD7. Hard cap of 1 active self_repair attempt per action_type at a time; max 3 attempts/day total

Concurrent self_repair attempts on the same action type race. If `coordinator_await_timeout` fires three times in a minute, we want ONE PR drafted, not three. Detector takes a Postgres advisory lock keyed on `('self_repair', action_type)` before drafting.

Per-day cap (3 across all action types) prevents cost runaway in slice 1's first weeks while we calibrate. Cap stored in `harness_config` row `SELF_REPAIR_DAILY_CAP=3` (per Open Q3 — formerly Q3, deferred). Editable without redeploy.

If cap exceeded: detector logs `self_repair.cap_exceeded` to agent_events, telegrams Colin, takes no action. Honest fail-loud.

---

## Components — sub-systems within `self_repair` for honest re-scoring

The `self_repair` row stays atomic in `harness_components` at weight 6. Internal decomposition for re-score honesty — same pattern as memory_layer / sandbox / chat_ui.

| Slug (internal)         | Weight inside self_repair | Today | Target slice 1 | Notes                                                                |
| ----------------------- | ------------------------- | ----- | -------------- | -------------------------------------------------------------------- |
| `failure_detector`      | 20%                       | 0%    | 30%            | Cron-polled `agent_events` reader filtered by watchlist. Slice 1 covers ONE action type; slice 2 broadens. |
| `context_gatherer`      | 15%                       | 0%    | 30%            | Read failure event row + recent commits + relevant lib files (heuristic: derive file paths from action_type). |
| `fix_drafter`           | 25%                       | 0%    | 30%            | One Claude Sonnet call. Returns unified diff + summary. No retry, no confidence score. |
| `sandbox_verifier`      | 15%                       | 0%    | 60%            | Apply diff in `runInSandbox()` worktree, run `npm test`, capture pass/fail + diffStat. |
| `pr_opener`             | 10%                       | 0%    | 60%            | `httpRequest({capability:'net.outbound.github'})` for PR; structured PR body with failure context. |
| `notification`          | 5%                        | 0%    | 100%           | `telegram(...)` notify on PR open + on verify failure.                |
| `audit_trail`           | 10%                       | 0%    | 100%           | `self_repair_runs` row per attempt + cap_check rows + sibling events for each module. |

Math (today): 0 across all = **0%**.

Math (slice 1): 0.20·0.30 + 0.15·0.30 + 0.25·0.30 + 0.15·0.60 + 0.10·0.60 + 0.05·1.00 + 0.10·1.00
              = 0.060 + 0.045 + 0.075 + 0.090 + 0.060 + 0.050 + 0.100
              = **0.480 ≈ 46%** (rounded; pin 46% in acceptance H)

Why not 50% (foundation target): the `failure_detector` + `context_gatherer` + `fix_drafter` only handle ONE action type in slice 1. Calling those 30% (not 60%+) reflects that the *plumbing* is fully done but the *coverage* is narrow. Slice 2 broadens to ~3 action types and lifts these subsystems to 60–70%, landing at ~52% total.

These slug names DO NOT land as new rows in `harness_components`. They live in this spec for re-score traceability.

---

## M1. `lib/harness/self-repair/detector.ts`

```typescript
export interface DetectedFailure {
  eventId: string                              // agent_events.id
  actionType: string                           // e.g. 'coordinator_await_timeout'
  occurredAt: string                           // ISO
  context: Record<string, unknown>             // agent_events.context JSONB
  agentId: string | null                       // who emitted the failure
}

// Polls agent_events for new rows matching the watchlist. Returns at most one
// failure (the oldest unprocessed one for an action_type not currently locked).
// Acquires a Postgres advisory lock per (action_type) before returning, releasing on caller's
// finally{}. AD7 — one active attempt per action_type.

export async function detectNextFailure(): Promise<DetectedFailure | null>

// Releases the advisory lock acquired by detectNextFailure. Idempotent.
export async function releaseDetectorLock(actionType: string): Promise<void>
```

Polling cadence: 5 min via Vercel cron at `POST /api/harness/self-repair-tick`. The endpoint:
1. Reads `harness_config` for `SELF_REPAIR_ENABLED` (defaults `false` — AD4 default-deny posture; flip to `true` during slice 1 acceptance).
2. Calls `detectNextFailure()`.
3. If null, returns 200 (no-op).
4. If non-null, dispatches the rest of the pipeline (M2 → M3 → M4 → M5) in the same request lifecycle.
5. Writes a `self_repair_runs` row with status flipping through `running` → `drafted` → `verifying` → `verify_passed`/`verify_failed` → `pr_opened`/`escalated`.
6. Releases the detector lock.

### Daily cap enforcement

Before step 4, check `SELECT COUNT(*) FROM self_repair_runs WHERE started_at > now() - interval '24 hours'`. If `>= harness_config.SELF_REPAIR_DAILY_CAP` (default 3), log `self_repair.cap_exceeded` to agent_events, telegram Colin, return 200 without dispatching.

---

## M2. `lib/harness/self-repair/context.ts`

```typescript
export interface FailureContext {
  failure: DetectedFailure
  recentCommits: { sha: string; subject: string; files: string[] }[]   // last 10 commits touching action_type's likely-related files
  relevantFiles: { path: string; content: string }[]                   // 1–5 files; content capped at 8KB each
  relatedEvents: { occurred_at: string; action: string; context: unknown }[] // last 20 agent_events rows in the same 1h window
}

// Heuristic file-path resolver per action_type. Slice 1 has hardcoded mappings;
// slice 3 may move to a `self_repair_watchlist.likely_files TEXT[]` column.
export async function gatherContext(failure: DetectedFailure): Promise<FailureContext>
```

Slice 1 hardcoded mapping (one entry — locks the slice 1 scope):

```typescript
const ACTION_TYPE_FILE_HINTS: Record<string, string[]> = {
  coordinator_await_timeout: [
    'lib/harness/invoke-coordinator.ts',
    'lib/orchestrator/await-result.ts',
    'app/api/harness/invoke-coordinator/route.ts',
  ],
}
```

Total context payload capped at 32KB to keep the LLM prompt bounded. Files truncated at 8KB each (head + tail per `lib/utility/truncate.ts`-style helper).

If a future failure event arrives with `action='coordinator_await_timeout'` but the heuristic-derived file paths don't exist (file moved or renamed), `gatherContext()` returns `relevantFiles: []` and the drafter operates on `recentCommits` + `relatedEvents` only. Drafter quality degrades; verifier still gates the outcome.

---

## M3. `lib/harness/self-repair/drafter.ts`

```typescript
export interface DraftedFix {
  unifiedDiff: string                          // git-apply-able unified diff
  summary: string                              // ~3 sentences for the PR body
  rationale: string                            // why this fix; surfaces in PR body and audit
  promptTokens: number
  completionTokens: number
}

export async function draftFix(ctx: FailureContext): Promise<DraftedFix>
```

Implementation: one `httpRequest({capability:'net.outbound.anthropic'})` call to Claude Sonnet (AD6). System prompt is short and bound: "You are LepiOS's self_repair agent. Given a failure event + recent commits + 1–5 source files, output a JSON object with `unifiedDiff` (git-apply-able), `summary` (3 sentences), and `rationale` (why)." Temperature: 0.

If the LLM returns invalid JSON or a diff that doesn't `git apply --check`, write `self_repair_runs.status='draft_failed'` and escalate via telegram. No retry in slice 1 (per CLAUDE.md retry-limit guidance — and to keep cost bounded).

---

## M4. `lib/harness/self-repair/verifier.ts`

```typescript
export interface VerifyResult {
  passed: boolean
  exitCode: number | null
  stdout: string                               // capped at 64KB
  stderr: string                               // capped at 64KB
  durationMs: number
  sandboxRunId: string                         // sandbox_runs.id
  worktreePath: string                         // for the PR-opener to read the diff from
  warnings: string[]                           // mirrored from SandboxRunResult.warnings
}

export async function verifyDraft(draft: DraftedFix, ctx: FailureContext): Promise<VerifyResult>
```

Implementation:
1. `runInSandbox('git apply <draft.unifiedDiff>', { agentId: 'self_repair', capability: 'sandbox.run', scope: { fs: { allowedPaths: ['.'] } } })` to apply the patch in a worktree.
2. If apply fails: return `{ passed: false, exitCode: 1, stderr: 'git apply failed: ...' }`.
3. Otherwise: `runInSandbox('npm test', { ..., timeoutMs: 180_000 })` with the same worktree (caller passes `cwd` per sandbox spec §M1).
4. Capture exit code; passed = `exitCode === 0`.
5. Surface sandbox `warnings` array verbatim to the verifier result; the PR body cites them so the human reviewer sees the gaps (`process_isolation_not_enforced`, etc.) in context.

Test timeout default: 3 min. If `npm test` exceeds, sandbox kills the process group (per sandbox spec acceptance D), verifier returns `{ passed: false, ... }`, self_repair logs `verify_timeout` to self_repair_runs.

---

## M5. `lib/harness/self-repair/pr-opener.ts`

```typescript
export interface PROpenResult {
  prNumber: number
  prUrl: string
  branchName: string                           // 'self-repair/<runId>'
  sha: string                                  // head commit sha of the PR branch
}

export async function openPR(
  draft: DraftedFix,
  verify: VerifyResult,
  ctx: FailureContext,
  runId: string,
): Promise<PROpenResult>
```

Implementation:
1. Read worktree (`verify.worktreePath`); compute final diff via `git diff` against base SHA.
2. Push a new branch `self-repair/<runId>` to origin via `httpRequest({capability:'net.outbound.github', method:'POST', url:'/repos/.../git/refs', ...})`.
3. Open PR via `httpRequest({capability:'net.outbound.github', method:'POST', url:'/repos/.../pulls', body: { title, body, head: branch, base: 'main' }})`.
4. PR body template:

   ```markdown
   ## Self-repair attempt — `<runId>`

   **Trigger:** `agent_events.action='<actionType>'` at `<occurredAt>` (event id `<eventId>`)

   ### Drafted summary
   <draft.summary>

   ### Rationale
   <draft.rationale>

   ### Sandbox verification
   - Status: ✅ passed (exit 0, <durationMs>ms)
   - Files changed: <verify.diffStat.files> (+<insertions> -<deletions>)
   - **Sandbox warnings:** <verify.warnings.join(', ') || 'none'>

   ### What this PR does NOT do
   - It does NOT auto-merge.
   - It does NOT auto-deploy.
   - Sandbox tests passing ≠ production-correct. Human review required.

   ### Audit
   - self_repair_runs.id: `<runId>`
   - sandbox_runs.id: `<sandboxRunId>`
   - Drafter tokens: prompt=<promptTokens>, completion=<completionTokens>
   ```

5. Telegram notify Colin via `telegram(prUrl, { bot: 'builder' })`.
6. Cleanup worktree via `cleanupSandbox(sandboxRunId)`.

---

## M6. `self_repair_runs` table

```sql
CREATE TABLE public.self_repair_runs (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Detection
  trigger_event_id   UUID         NOT NULL,                   -- agent_events.id
  action_type        TEXT         NOT NULL,                   -- mirror of agent_events.action
  detected_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Lifecycle
  status             TEXT         NOT NULL CHECK (status IN (
                       'running',
                       'context_gathered','draft_failed','drafted',
                       'verifying','verify_failed','verify_timeout','verify_passed',
                       'pr_opened','pr_open_failed',
                       'escalated','cap_exceeded'
                     )),
  status_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Drafter outputs
  drafter_prompt_tokens     INTEGER,
  drafter_completion_tokens INTEGER,
  drafter_summary           TEXT,
  drafter_rationale         TEXT,

  -- Sandbox verifier
  sandbox_run_id     UUID         REFERENCES public.sandbox_runs(id) ON DELETE NO ACTION,
  verify_exit_code   INTEGER,
  verify_duration_ms INTEGER,
  warnings           TEXT[]       NOT NULL DEFAULT '{}',     -- from sandbox

  -- PR
  pr_number          INTEGER,
  pr_url             TEXT,
  branch_name        TEXT,

  -- Failure / escalation
  failure_reason     TEXT,                                   -- when status ends in *_failed / escalated

  -- Cleanup
  cleaned_at         TIMESTAMPTZ                              -- when worktree was torn down
);

CREATE INDEX idx_sr_runs_status ON public.self_repair_runs(status, detected_at DESC);
CREATE INDEX idx_sr_runs_action ON public.self_repair_runs(action_type, detected_at DESC);

ALTER TABLE public.self_repair_runs ENABLE ROW LEVEL SECURITY;
```

**AD7 (security spec) carry-over** — lock at GRANT level:

```sql
REVOKE UPDATE, DELETE ON public.self_repair_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.self_repair_runs TO service_role;
-- Status + cleaned_at must update as the run progresses; column-level GRANT.
GRANT UPDATE (status, status_at, drafter_prompt_tokens, drafter_completion_tokens,
              drafter_summary, drafter_rationale, sandbox_run_id, verify_exit_code,
              verify_duration_ms, warnings, pr_number, pr_url, branch_name,
              failure_reason, cleaned_at) ON public.self_repair_runs TO service_role;
```

---

## Slice 1 acceptance criteria — smallest E2E path

**Goal:** prove detect → draft → verify → PR end-to-end on `coordinator_await_timeout`, with full audit, no auto-merge, no auto-deploy.

**Precondition:** sandbox slice 1+2 live; security_layer slices 1+2+3 live; arms_legs S2 live with `net.outbound.github` and `net.outbound.anthropic` grants for `self_repair` agent_id.

### A. Schema + capability + watchlist seed

- [ ] Migration 0050 applies on prod. `list_tables` returns `self_repair_runs` + `self_repair_watchlist`.
- [ ] `self_repair_watchlist` has exactly 1 row: `action_type='coordinator_await_timeout', enabled=true`.
- [ ] `agent_capabilities` rows exist for all 7 grants in §AD6.
- [ ] AD7 lockdown: `INSERT INTO self_repair_runs … FROM service_role` succeeds; `DELETE FROM self_repair_runs FROM service_role` returns `permission denied`. Asserted in `tests/security/ad7-runtime.test.ts`.
- [ ] `harness_config` row `SELF_REPAIR_ENABLED=false` exists by default; flip to `true` during acceptance window.
- [ ] `harness_config` row `SELF_REPAIR_DAILY_CAP=3` exists.

### B. Detector finds a watchlisted failure and acquires a lock

- [ ] Test seeds an `agent_events` row with `action='coordinator_await_timeout'`.
- [ ] Calling `detectNextFailure()` returns a `DetectedFailure` matching the seed.
- [ ] A second concurrent call returns `null` (advisory lock held).
- [ ] After `releaseDetectorLock('coordinator_await_timeout')`, a third call returns the same failure (assuming no run completed it yet).
- [ ] An event with action NOT in the watchlist (e.g., `drain_trigger_failed`) is ignored.

### C. Daily cap fires when exceeded

- [ ] Test seeds 3 `self_repair_runs` rows with `started_at > now() - interval '24h'`.
- [ ] `POST /api/harness/self-repair-tick` returns 200, writes `self_repair.cap_exceeded` to `agent_events`, sends 1 Telegram message to alerts bot.
- [ ] No new `self_repair_runs` row created.

### D. Drafter produces a valid unified diff (mocked LLM)

- [ ] Mock Claude Sonnet to return a deterministic `{ unifiedDiff, summary, rationale }`.
- [ ] `draftFix(ctx)` returns a `DraftedFix` with non-empty fields.
- [ ] `git apply --check` against a clean worktree succeeds for the returned diff.
- [ ] `agent_actions` row exists with `agent_id='self_repair'`, `capability='tool.self_repair.draft_fix'`, `result='allowed'`.
- [ ] `agent_events` sibling row with `action='self_repair.draft.ok'`, `context.correlation_id` matching the cap_check audit_id, `context.tokens_in/out` populated.

### E. Sandbox verifier round-trips and returns pass/fail honestly

- [ ] Test seeds a draft that, when applied, makes a passing test fail. `verifyDraft()` returns `{ passed: false, exitCode: !==0, ... }`.
- [ ] Test seeds a draft that, when applied, leaves all tests passing. `verifyDraft()` returns `{ passed: true, exitCode: 0, ... }`.
- [ ] Sandbox `warnings` array (e.g., `process_isolation_not_enforced`) is mirrored verbatim to `VerifyResult.warnings` and to `self_repair_runs.warnings`.
- [ ] `sandbox_runs` row exists with FK from `self_repair_runs.sandbox_run_id`.
- [ ] **No commit, no push, no diff applied to main workspace.** Asserted by `git status` returning clean after the run (test fixture).

### F. PR opener creates a real GitHub PR (mocked GitHub API)

- [ ] Mock `httpRequest` to record the GitHub API calls. Trigger the full pipeline.
- [ ] Asserts: one POST to `/repos/.../git/refs` (branch creation), one POST to `/repos/.../pulls` (PR open).
- [ ] PR body matches the §M5 template (regex match on key sections).
- [ ] `self_repair_runs` row updated: `status='pr_opened'`, `pr_number`, `pr_url`, `branch_name` populated.
- [ ] One `agent_events` row with `action='self_repair.pr.opened'`, context includes `pr_url` + `runId`.
- [ ] One Telegram message sent via `telegram(prUrl, ...)`.

### G. Production smoke (after deploy)

- [ ] After deploy: cron fires at scheduled cadence (5 min). Seed a synthetic `coordinator_await_timeout` event in production via SQL.
- [ ] Within 10 min: a `self_repair_runs` row exists with `status='pr_opened'`. PR is visible at the returned `pr_url`.
- [ ] Telegram message received by builder bot.
- [ ] **PR remains unmerged.** Asserted by querying GitHub API at the end of the smoke window — `merged: false, state: 'open'`.

### H. Rollup honesty

- [ ] After slice 1: `harness_components.completion_pct` for `self_repair` updated 0 → **46**.
- [ ] morning_digest reflects: "self_repair: 0 → 46 (slice 1 — detect→draft→verify→PR for coordinator_await_timeout)".
- [ ] If any acceptance A-G fails partial: completion is recomputed against actual landed work (chat_ui spec §Completion accounting conditional pin pattern).

### I. F18 surfacing — morning_digest line

- [ ] New digest line: `Self-repair (24h): N attempts, M PRs opened, K verify-failed, J cap-exceeded, top action_types: [{action, count}, ...]`.
- [ ] If any open PR has been unreviewed >7 days: digest flags it (per §Open Q3 SLA).

### J. Hard "no auto-merge" assertion

- [ ] Repo-wide grep in CI: `Grep 'merge|squash|rebase' lib/harness/self-repair/` returns 0 matches outside test fixtures.
- [ ] Lint rule (or equivalent CI script) blocks any future PR that adds an `'/merge'` or auto-merge GitHub API call from `lib/harness/self-repair/`. Asserted by `tests/self-repair/no-auto-merge.test.ts`.

---

## Completion accounting

Foundation spec target for `self_repair`: 50% (~3 days). Decomposed:

| Slice  | Ships                                                                       | Honest %  | Notes                                          |
| ------ | --------------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| (today)| `/autofix` slash command (manual, no sandbox, no PR gate — different shape) | **0%**    | `/autofix` is a Colin tool, not the autonomous mechanism this component scopes. |
| **S1** | **Detect→draft→verify→PR for `coordinator_await_timeout`. No auto-merge ever.** | **~46%**  | Conditional on acceptance A-J all green.       |
| S2     | Broaden detector + drafter coverage to 3 action types; GitHub Actions failed-deploy webhook | ~55%   | Lifts `failure_detector` + `context_gatherer` + `fix_drafter` to ~60% |
| S3     | Sentry SDK integration (failed-deploy + runtime errors as additional triggers) | ~65%      |                                                |
| S4     | Confidence scoring (informational only — does NOT auto-merge)                | ~75%      | Colin redline required to enable auto-anything |
| S5     | Auto-merge for high-confidence narrow patterns (Colin redline gate)          | ~85%      | Behind a separate spec doc                     |

The 100% line is reserved for "self-repair handles >80% of failure events without Colin intervention, and humans only review aggregate health." That requires confidence calibration data that does not exist today. Slice 1's 46% is the responsible cap.

**The 46% slice 1 target is conditional on acceptance A–J all green.** If any single acceptance fails, completion is recomputed against actual landed work, not against the spec target. Mirrors chat_ui §Completion accounting conditional-pin pattern.

---

## Out of scope (slice 1, mostly indefinitely)

- **Auto-merge of any kind.** Slice 4+ may add it for narrow, high-confidence patterns behind a separate Colin-approved spec. Slice 1 forbids it via §Acceptance J.
- **Production deploy from self_repair.** Self_repair opens PRs; deploy_gate handles deploys. There is no path from self_repair to a live deploy in slice 1.
- **Confidence scoring.** Slice 4. Foundation spec's "auto-apply ≥ 8" is acknowledged and deferred.
- **Multi-step fixes.** If draft 1 fails verification, slice 1 escalates to Telegram. No second draft. No "fix the fix." Per CLAUDE.md retry limit (max 2) — but slice 1 caps at 1 to keep cost bounded.
- **Cross-repo fixes.** Self_repair targets only `loeppkyc/lepios`.
- **LLM model selection optimization.** AD6 picks Sonnet; no router; no fallback to Opus on confusion.
- **Sentry SDK integration.** Slice 3.
- **GitHub Actions webhook receiver.** Slice 2.
- **Self-repair on self_repair's own code.** Hard exclusion in slice 1: if the failure event's `agent_id='self_repair'` or the `relevantFiles` includes `lib/harness/self-repair/**`, abort with `status='escalated'`. Recursion prevention; see §Risks R6.
- **Per-tool timeout configuration.** Slice 1 ships single 30s/3min defaults (drafter LLM 30s; npm test 3min). Per-action overrides land slice 3+.
- **PR auto-close after N days unreviewed.** Slice 1 surfaces aged PRs in morning_digest (acceptance I); doesn't act on them.
- **PR labeling, milestone assignment, code-owner notification.** Polish; slice 4+.
- **Cost dashboard.** Slice 1 records `drafter_*_tokens` columns; aggregation lives in morning_digest only.

---

## Open questions — flag, do not guess

**Q1 from earlier draft is resolved in-spec** — slice 1 watchlist seed is `coordinator_await_timeout` (see §AD4 + §M2 hardcoded mapping). Remaining open questions retain their original numbering for stable cross-reference:

2. **Sentry SDK integration — slice 3 or earlier?** Foundation spec assumed Sentry. It's not live. Slice 3 adds it — but if Colin wants Sentry sooner (BBV runs Stripe LIVE; production errors there matter more), it could move to slice 1.5 (a half-slice between detector-broadening and Sentry). **Q: prioritize Sentry?** Recommendation: defer to slice 3. Slice 1's `agent_events` poller is the "minimum viable trigger" — adding Sentry to slice 1 doubles the surface area.

3. **PR-open SLA.** What happens when self_repair PRs sit unreviewed? Options: (a) just surface in morning_digest (slice 1 default), (b) auto-close after N days, (c) auto-bump priority each day (escalating Telegram), (d) auto-merge after N days if tests still pass (NOT acceptable per AD2). **Q: choose (a), (b), (c), or some combo?** Recommendation: (a) only in slice 1; revisit at slice 3.

4. **False-positive auto-suspend.** If 3 consecutive self_repair PRs are closed-without-merge by Colin (signal: bad fixes), self_repair auto-suspends until Colin re-enables. **Q: ship in slice 1 or slice 2?** Recommendation: slice 1 — cheap to add, prevents alarm fatigue from noisy fix attempts. Add as acceptance K if Colin agrees.

5. **GitHub PR author identity.** PR opens via `httpRequest` using `GITHUB_TOKEN` (likely a PAT). The PR author shows as the PAT's owner (Colin) — not as a "self_repair bot." **Q: acceptable, or do we want a dedicated bot account / GitHub App?** Recommendation: acceptable for slice 1. Colin-as-author makes review path obvious; bot account adds operational overhead. Revisit if PR volume > 10/week.

6. **Cost ceiling.** Sonnet at $3/Mtoken × ~15k tokens per attempt × 3 attempts/day = ~$0.14/day. Trivial. But if slice 2 broadens detector and the cap goes to 20/day, that's ~$1/day, still OK. **Q: hard cost ceiling, or trust the per-day attempt cap to limit spend implicitly?** Recommendation: trust the attempt cap; revisit if monthly Anthropic spend > $50 attributable to self_repair.

7. **Daily cap location.** Resolved in §AD7 — `harness_config.SELF_REPAIR_DAILY_CAP=3`, editable without redeploy.

---

## Dependencies

### Hard prerequisites — none merged today

| Component                    | What self_repair needs                                                                  | Live status (verified 2026-04-28)               |
| ---------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `sandbox` slice 1            | `runInSandbox()` + `cleanupSandbox()` + `sandbox_runs` table + `SandboxRunResult` shape | ⬜ DRAFT (commit a83cdd7)                        |
| `sandbox` slice 2            | `boundary_check_wired` (security `checkSandboxAction()` integrated)                     | ⬜ Not in DRAFT scope yet                        |
| `security_layer` slice 1     | `agent_actions` table + `lib/security/audit.ts`                                         | ✅ live                                          |
| `security_layer` slice 2     | `capability_registry` + `agent_capabilities` + new agent_id `self_repair`               | ✅ live (registry exists; chat_ui-pattern grants land in 0050) |
| `security_layer` slice 3     | `requireCapability()` middleware in log_only mode                                       | ⬜ in priority queue                              |
| `security_layer` slice 4     | `secrets.get(name, agentId)` so self_repair reads `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` cleanly | ⬜ — slice 1 falls back to `process.env` per arms_legs S2 AD5 |
| `arms_legs` S2 (Phase B + C) | `httpRequest({capability:'net.outbound.anthropic'})` + `httpRequest({capability:'net.outbound.github'})` + `telegram()` | ⬜ DRAFT (commit 078578f) |

**Operational consequence:** spec lands now; build slot opens once sandbox slice 1+2 land + security 1+2+3 land + arms_legs S2 lands. Per foundation spec §Priority, that's after items #1 (security_layer), #2 (digital_twin), #3 (sandbox), #4 (arms_legs), #5 (telegram_outbound), #6 (specialized_agents) — so #7 is the right slot. Sequential.

### Soft dependencies

| Component                         | What it adds                                                          | Defer to                              |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Sentry SDK                        | Runtime errors as trigger (foundation spec's original primary trigger) | Slice 3                               |
| GitHub Actions webhook receiver   | Failed-deploy as trigger                                              | Slice 2                               |
| `chat_ui` slice 4+                | Tool surface for "show me the self_repair queue" / "pause self_repair" | After chat_ui slice 4                 |
| `f18_surfacing`                   | Morning-digest line (acceptance I)                                    | Same PR as slice 1                    |

### Downstream consumers

None directly. Self_repair is a leaf component. Indirect:

| Consumer        | What self_repair gives them                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `morning_digest` | "Self-repair (24h): N attempts, M PRs opened, K verify-failed" digest line  |
| Colin's ops day | Failures get fixes drafted before Colin reads the alert                     |
| Future scout    | Same `self_repair_watchlist` pattern is reusable for "watch for this signal in agent_events and react" |

---

## Risks called out for redline

- **R1.** Worst case: self_repair opens a PR that subtly breaks production after merge. Mitigation: human PR review (AD2), sandbox tests (M4), every diff visible. Residual risk: human review fatigue. Slice 1 mitigates partially via §Open Q4 false-positive auto-suspend; revisit if PR-merge-rate <50% after 4 weeks.
- **R2.** LLM hallucinates a fix that compiles + tests pass + is wrong logic. Mitigation: PR template explicitly flags "sandbox tests passing ≠ production-correct" (M5 template); PR author = Colin (Open Q5) so the review queue is unambiguous. Residual: high. Accepted because slice 1 never auto-merges.
- **R3.** Trigger volume / retry storm. Single transient `coordinator_await_timeout` event firing 5 times in 1 minute → 5 self_repair attempts (one per event). Mitigation: detector advisory lock per `action_type` (AD7) + daily cap (Open Q7 / §AD7). Slice 1's 1-action-type seed limits blast radius further.
- **R4.** Cost runaway (Claude Sonnet API). Mitigation: per-day attempt cap (3 in slice 1). Worst-case slice 1 cost: ~$0.14/day. Acceptable.
- **R5.** Sandbox verification false-positive. `npm test` passes in worktree but fails in production (env diff, missing migration, race condition not exercised by tests). Mitigation: PR review is the second gate. Sandbox `warnings` array surfaced in PR body so reviewer sees gaps. Slice 3+ can add deploy-preview verification as a third gate.
- **R6.** Recursion safety — self_repair's own code throws. Mitigation: hard-exclude `lib/harness/self-repair/**` from `relevantFiles` (Out of scope item) AND hard-exclude failure events with `agent_id='self_repair'`. Asserted by `tests/self-repair/no-self-target.test.ts`. If the recursion check itself has a bug → next-most-recent commit reverts.
- **R7.** Capability creep. Slice N adds `shell.run` so self_repair can run more verification commands; slice N+1 adds `db.migrate` so self_repair can fix migrations; eventually self_repair has root. Mitigation: every new capability requires a separate slice spec + Colin redline. AD2 ("never auto-merge") is the load-bearing principle that makes capability creep recoverable.
- **R8.** PR open spam if cap is too generous. At cap=10/day and a noisy `coordinator_await_timeout`, Colin's GitHub inbox gets 10 PRs/day to triage. Mitigation: slice 1 ships cap=3; raise only after measured low false-positive rate.
- **R9.** Drafter LLM exfiltration. Self_repair sends source code to Anthropic. This is the same risk as `scripts/ai-review.mjs` (already accepted). No new risk; documented for completeness.
- **R10.** GitHub PAT scope. The PAT must have `repo` scope to open PRs. If the PAT is compromised, self_repair becomes a vector. Mitigation: token rotation policy (security spec deferred); fine-grained PAT scoped to this repo only.

---

## Working agreement reminders

- Specs first, code second.
- No padding. Slice 1 lands at 46%. Honest. The remaining 54% is broader detector + Sentry + GitHub Actions + confidence scoring + (eventually, with redline) auto-merge for narrow patterns.
- Acceptance tests written before building (§Slice 1 acceptance criteria, above).
- Doc-as-source: this file is authoritative once approved; `lib/harness/self-repair/*.ts` and migration 0050 follow it.
- Read existing files before drafting anything new — done; foundation spec §self_repair, sandbox spec, security spec, arms_legs S2 spec, `/autofix` slash command, and `agent_events` failure-pattern audit (5 distinct types, 26 events) all consulted inline.
- **AD2 is the most important line in this doc.** Self_repair never auto-merges. If you find yourself thinking "but what if the test passes…" — re-read AD2.
- **This window is SCOPE ONLY. No code, no commits beyond this spec doc.**
