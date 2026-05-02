# Acceptance Doc — Self-Repair (harness:self_repair)

Component: harness:self_repair · Track: T1-C (Agentic Capabilities) · Weight: 6 · Current: 0%
Date: 2026-05-01
Author: Coordinator (draft for Colin review)
Branch: TBD (create `harness/self-repair-slice-1` from main before builder picks up)

**Builder gate — hard prerequisites (all must be live in production before writing any code):**

1. Sandbox slice 1 built and deployed — `runInSandbox()` + `cleanupSandbox()` + `sandbox_runs` table live; all sandbox acceptance criteria A–M green.
2. Sandbox slice 2 built and deployed — `boundary_check_wired` (security_layer `checkSandboxAction()` integrated); sandbox at ≥50% per its rollup bump.
3. Security_layer slices 1+2+3 applied — `agent_actions` table (migration 0045), `capability_registry` + `agent_capabilities` seeded, `requireCapability()` middleware live in log_only mode.
4. arms_legs S2 Phase B+C shipped — `httpRequest({capability:'net.outbound.anthropic'})`, `httpRequest({capability:'net.outbound.github'})`, and `telegram()` callable from harness code.
5. `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` available at runtime — either via `process.env` (acceptable for slice 1) or via security_layer slice 4 `secrets.get()` (preferred; falls back to process.env per arms_legs S2 AD5 if slice 4 not yet live).

**Scope of this acceptance doc:** Slice 1 only. Closes the autonomy gap for **one** failure action type (`coordinator_await_timeout`) end-to-end: detect → gather context → draft fix → verify in sandbox → open PR → notify. No auto-merge, ever. Slice 1 targets honest **46%** completion of the `self_repair` component, not 50% — the remaining 54% is broader detector coverage, Sentry integration, GitHub Actions webhook, confidence scoring, and (far later, behind a Colin-approved redline) auto-merge for narrow patterns.

---

## Purpose

Close the autonomy loop. Without self_repair, every harness failure that reaches `agent_events` as a failure row stops the loop and waits for Colin to notice, diagnose, and intervene. With it, the harness detects a known failure pattern, drafts a candidate fix, verifies it inside a sandbox worktree, and opens a PR — all before Colin opens his laptop.

The autonomous loop goal is "walk away while the harness works." That phrase is currently aspirational — sandbox (weight 7) provides the safe execution boundary, and self_repair (weight 6) is the decision layer that acts on what the sandbox observes. Without self_repair, sandbox provides isolation but no recovery. Together they form the self-healing kernel.

Slice 1's contribution is narrow but real: one action type (`coordinator_await_timeout`) goes from "Colin pause" to "PR in Colin's inbox within 10 minutes." Every subsequent slice broadens the watchlist.

---

## Context — Why This Ranks #N in T1-C

| Dependency chain                                   | Points unlocked                                |
| -------------------------------------------------- | ---------------------------------------------- |
| security_layer → sandbox → self_repair             | self_repair: 6 pts at slice 1 (3.6 pts direct) |
| self_repair ships → push_bash_automation unblocked | 3 pts downstream                               |

`push_bash_automation` (weight 3) gates on self_repair being live because auto-tier shell commands need a safe retry path — running a bash command, finding it failed, re-trying with corrected args requires the same detect-draft-verify loop self_repair provides. Without self_repair's retry policy layer, push_bash_automation degrades to "run once, escalate on failure," which is not meaningfully different from today.

The `/autofix` slash command exists (at `~/.claude/commands/autofix.md`) and works well as a Colin-triggered tool. It operates on the live workspace, has no sandbox, and has no PR gate. It is a companion tool, not this component — `/autofix` requires Colin to initiate; self_repair initiates autonomously.

This spec translates `docs/harness/SELF_REPAIR_SPEC.md` (Draft 1, 2026-04-28) into the builder contract format. All seven architecture decisions (AD1–AD7) in that spec are pre-resolved and carried forward here verbatim. Q1–Q4 resolved 2026-05-01.

---

## Requirements Boundary

**MUST:**

- Detect failure events autonomously from `agent_events` — no Colin trigger required.
- Classify failures via the watchlist registry — only opted-in action types are acted on.
- Draft a candidate fix using Claude Sonnet and produce a git-apply-able unified diff.
- Verify the fix by applying it inside a `runInSandbox()` worktree and running `npm test`.
- Open a GitHub PR with the diff + sandbox verification result — never apply the diff to main directly.
- Notify Colin via Telegram on PR open AND on verification failure.
- Write an audit row per attempt — `self_repair_runs` row linked to the triggering `agent_events` row and the `sandbox_runs` row.
- Enforce a daily cap (default 3 attempts) to bound cost and alert-fatigue risk in slice 1.
- Surface circuit state from `lib/ollama/circuit.ts` before calling Anthropic — defer the draft if the circuit is OPEN.
- Exclude itself from the watchlist — failure events with `agent_id='self_repair'` are never acted on.
- Respect CLAUDE.md retry limit: max 1 draft attempt per event in slice 1. No "fix the fix."

**MUST NOT:**

- Auto-merge any PR. Ever. (AD2 — enforced by lint rule as acceptance criterion J.)
- Auto-deploy. PRs go through the existing deploy_gate. No production state changes from self_repair.
- Apply diffs to the live workspace. All execution is inside `runInSandbox()` worktrees.
- Target its own code. `lib/harness/self-repair/**` paths in `relevantFiles` trigger immediate escalation.
- Run without the watchlist — wildcard listeners on `*_failed` produce false-positive PRs and erode trust.
- Introduce a new endpoint other than `POST /api/harness/self-repair-tick` in slice 1.

---

## Architecture

### Failure Classification

Every failure that self_repair observes falls into one of four classes. The class determines the policy.

| Class           | Definition                                                                                    | Slice 1 policy                                                                                       | Examples                                                               |
| --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Recoverable** | Single transient event; same command would likely succeed on re-run with no code change.      | NOT a self_repair target. Retry handled by the originating cron or coordinator. Watchlist exclusion. | DNS blip, rate-limit 429, single `notification_failed`                 |
| **Retryable**   | Repeating or structural failure. A code change is plausible. LLM can draft a candidate patch. | Slice 1 target: detect → draft → verify → PR. One attempt.                                           | `coordinator_await_timeout`, missing handler, too-tight constant       |
| **Abandonable** | Infrastructure or environment failure. No code change will fix it.                            | `sandbox.infrastructure_failure` event + `task_queue.status='failed'` + re-queue signal. No PR.      | Worktree creation fails, ENOSPC, OOM kill, `runInSandbox()` throws     |
| **Escalate**    | High-severity or unclassifiable. Requires Colin's decision before any action is taken.        | Telegram alert immediately. `self_repair_runs.status='escalated'`. No PR, no retry.                  | Migration file in diffStat, circuit OPEN >30 min, self-targeting event |

### State Machine

One `self_repair_runs` row tracks the lifecycle of each attempt, flipping through these states:

```
[cron tick]
  │
  ▼
detectNextFailure()
  ├─ null ────────────────────────────────────────── 200 no-op
  └─ DetectedFailure
       │
       ▼
  check daily cap
  ├─ exceeded ─────────────── cap_exceeded event + telegram → done
  └─ ok
       │
       ▼
  gatherContext()          status: running
  │  failure class = Abandonable? ──────────── escalate + task failed
  │  failure class = Escalate?    ──────────── escalate + telegram
  │  circuit OPEN?                ──────────── defer: circuit_open_defer event → done
       │
       ▼
  draftFix(ctx)            status: context_gathered
  ├─ LLM error / invalid JSON / git apply --check fails ──── status: draft_failed → escalate
  └─ DraftedFix
       │
       ▼
  verifyDraft(draft, ctx)  status: drafted
  ├─ sandbox throws ──────────────────────────────────────── Abandonable → escalate
  ├─ migration file in diffStat ──────────────────────────── Escalate (safety override)
  ├─ exitCode !== 0 ──────────────────────────────────────── status: verify_failed → escalate
  ├─ timeout ─────────────────────────────────────────────── status: verify_timeout → escalate
  └─ exitCode === 0             status: verify_passed
       │
       ▼
  openPR()                 status: verifying → verify_passed
  ├─ httpRequest fails ──────────────────────────────────── status: pr_open_failed → telegram
  └─ PR created            status: pr_opened
       │
       ▼
  telegram notify Colin (prUrl)
  cleanupSandbox(sandboxRunId)
  releaseDetectorLock(actionType)
  200 ok
```

No auto-merge at any state. PR remains open until Colin reviews and merges (or closes).

### Failure Mode Catalog

| Failure mode                                       | Class       | Policy                                                                                                                                                                                                            |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder cmd exits non-zero inside sandbox          | Retryable   | `verifyDraft()` captures exit code. `verify_failed` → telegram escalate. No auto-retry. Colin reviews via the `self_repair_runs` row.                                                                             |
| Worktree creation fails (`git worktree add` error) | Abandonable | `runInSandbox()` throws `sandbox.infrastructure_failure`. Mark `task_queue.status='failed'`. Re-queue signal via `agent_events`.                                                                                  |
| `npm test` fails after patch applied               | Retryable   | `verify_failed` → telegram escalate. Slice 1: no second draft attempt (CLAUDE.md retry limit). PR NOT opened.                                                                                                     |
| Lint / typecheck failure only (no test failure)    | Retryable   | Same as test failure — `verify_failed`. Auto-fix via Prettier is Out of scope slice 1 (see §Out of scope). Always escalate.                                                                                       |
| Migration file detected in `diffStat`              | Escalate    | Safety override regardless of test result. `status='escalated'`. Never auto-apply a migration. Telegram alert with `diffStat.files`.                                                                              |
| Tunnel / network failure (e.g. CF Access)          | Recoverable | Check `getCircuitState()` from `lib/ollama/circuit.ts` before Anthropic call. Circuit OPEN → log `circuit_open_defer`, return 200 without consuming the event. Retried on next 5-min tick when circuit HALF_OPEN. |
| Anthropic API error (non-circuit)                  | Abandonable | `draft_failed` + telegram escalate. Log `drafter_*_tokens = 0`.                                                                                                                                                   |
| Out of disk (ENOSPC)                               | Abandonable | `runInSandbox()` throws. Telegram alert with `error: ENOSPC`. No retry. `status='escalated'`.                                                                                                                     |
| Out of memory (OOM kill)                           | Abandonable | `runInSandbox()` returns `exitCode=null, timedOut=false` with stderr containing OOM marker. Treated as Abandonable. No retry.                                                                                     |
| self_repair targets its own code                   | Escalate    | Hard exclusion: `agent_id='self_repair'` in event row OR `lib/harness/self-repair/**` in `relevantFiles`. `status='escalated'`.                                                                                   |
| Daily cap exceeded                                 | —           | `cap_exceeded` event + telegram. No `self_repair_runs` row created for the denied attempt.                                                                                                                        |
| `self_repair-tick` cron itself throws              | —           | Vercel catches and returns 500. Next tick retries cleanly (no state held in process). Advisory lock expires with the connection.                                                                                  |

---

## Input Data Sources — Grounded

Verified against `supabase/migrations/` on main as of 2026-05-01.

| Table / interface       | Migration / source                           | Status                                     | Role                                                                     |
| ----------------------- | -------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `agent_events`          | 0005                                         | Applied                                    | Failure detection source; F18 sibling events; circuit state derivation   |
| `harness_config`        | 0012                                         | Applied                                    | `SELF_REPAIR_ENABLED`, `SELF_REPAIR_DAILY_CAP`; read at cron tick start  |
| `sandbox_runs`          | 0046/next-available (sandbox acceptance doc) | **PENDING** (sandbox builder not started)  | FK target for `self_repair_runs.sandbox_run_id`; worktree lifecycle      |
| `agent_actions`         | 0045 (security_layer)                        | **PENDING** (security_layer pre-migration) | Cap_check audit rows per step                                            |
| `agent_capabilities`    | security_layer slice 2                       | **PENDING**                                | 7 capability grants for `self_repair` agent_id; seeded in migration 0065 |
| `self_repair_runs`      | **0065** (this component)                    | Not yet written                            | One row per attempt; lifecycle, drafter outputs, sandbox FK, PR info     |
| `self_repair_watchlist` | **0065** (this component)                    | Not yet written                            | Opt-in registry; slice 1 seed: `coordinator_await_timeout`               |
| `harness_components`    | 0043                                         | Applied                                    | Contains `self_repair` row at 0%; UPDATE to 46 after slice 1 ships       |
| `lib/ollama/circuit.ts` | `getCircuitState()` — no migration           | Applied                                    | Network failure detection; consulted before every Anthropic API call     |

**Migration slot 0065:** the SELF_REPAIR_SPEC.md claimed slot 0050, but `0050_enable_rls_gmail_window_sessions.sql` is already applied on main. Confirmed next-available slot = 0065 (after 0062+0063 claimed by reconciliation engine, 0064 reserved for anomaly_runs v2). Builder must confirm no open PR claims 0065 before starting.

---

## Schema Proposal — Migration 0065

```sql
-- 0065_self_repair_schema.sql
-- Depends on 0045 (agent_actions) + sandbox migration (sandbox_runs must exist)

-- Table 1: one row per self_repair attempt
CREATE TABLE public.self_repair_runs (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Detection
  trigger_event_id          UUID         NOT NULL,       -- agent_events.id
  action_type               TEXT         NOT NULL,       -- mirror of agent_events.action

  -- Lifecycle
  status                    TEXT         NOT NULL CHECK (status IN (
                              'running',
                              'context_gathered', 'draft_failed', 'drafted',
                              'verifying', 'verify_failed', 'verify_timeout', 'verify_passed',
                              'pr_opened', 'pr_open_failed',
                              'escalated', 'cap_exceeded'
                            )),
  detected_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Drafter outputs
  drafter_prompt_tokens     INTEGER,
  drafter_completion_tokens INTEGER,
  drafter_summary           TEXT,
  drafter_rationale         TEXT,

  -- Sandbox verifier
  sandbox_run_id            UUID         REFERENCES public.sandbox_runs(id) ON DELETE NO ACTION,
  verify_exit_code          INTEGER,
  verify_duration_ms        INTEGER,
  warnings                  TEXT[]       NOT NULL DEFAULT '{}',  -- from sandbox

  -- PR
  pr_number                 INTEGER,
  pr_url                    TEXT,
  branch_name               TEXT,                               -- 'self-repair/<runId>'

  -- Failure / escalation
  failure_reason            TEXT,

  -- Cleanup
  cleaned_at                TIMESTAMPTZ
);

CREATE INDEX idx_sr_runs_status   ON public.self_repair_runs (status, detected_at DESC);
CREATE INDEX idx_sr_runs_action   ON public.self_repair_runs (action_type, detected_at DESC);
CREATE INDEX idx_sr_runs_trigger  ON public.self_repair_runs (trigger_event_id);

ALTER TABLE public.self_repair_runs ENABLE ROW LEVEL SECURITY;

-- AD7 GRANT lockdown (security_layer pattern): append-only + column-level UPDATE
REVOKE UPDATE, DELETE ON public.self_repair_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.self_repair_runs TO service_role;
GRANT UPDATE (status, status_at, drafter_prompt_tokens, drafter_completion_tokens,
              drafter_summary, drafter_rationale, sandbox_run_id, verify_exit_code,
              verify_duration_ms, warnings, pr_number, pr_url, branch_name,
              failure_reason, cleaned_at) ON public.self_repair_runs TO service_role;

-- Table 2: opt-in watchlist — explicit registry of failure action types to act on
CREATE TABLE public.self_repair_watchlist (
  action_type   TEXT         PRIMARY KEY,
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  notes         TEXT,
  added_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  added_by      TEXT         NOT NULL DEFAULT 'colin'
);

ALTER TABLE public.self_repair_watchlist ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.self_repair_watchlist TO service_role;
-- Watchlist rows are managed by Colin or coordinator via SQL; no agent INSERT

-- Slice 1 seed (exactly ONE row)
INSERT INTO public.self_repair_watchlist (action_type, enabled, notes, added_by)
VALUES (
  'coordinator_await_timeout',
  true,
  'Slice 1 seed: code-fixable signal. 2 historical events. Selected over drain_trigger_failed (higher volume but transient infrastructure). Fix target: missing handler or too-tight await constant.',
  'colin'
);

-- Capability grants for self_repair agent_id (security_layer slice 2 must be live)
INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('self_repair', 'tool.self_repair.read.agent_events', 'log_only', 'colin', 'self_repair slice 1 — failure detection'),
  ('self_repair', 'tool.self_repair.draft_fix',         'log_only', 'colin', 'self_repair slice 1 — LLM call to draft a patch'),
  ('self_repair', 'tool.self_repair.open_pr',           'log_only', 'colin', 'self_repair slice 1 — open GitHub PR'),
  ('self_repair', 'net.outbound.anthropic',             'log_only', 'colin', 'self_repair — Sonnet API for fix drafter'),
  ('self_repair', 'net.outbound.github',                'log_only', 'colin', 'self_repair — PR open via arms_legs httpRequest'),
  ('self_repair', 'net.outbound.telegram',              'log_only', 'colin', 'self_repair — notify on PR open / verify failure'),
  ('self_repair', 'sandbox.run',                        'log_only', 'colin', 'self_repair — runInSandbox for fix verification');

-- harness_config seeds (default-deny posture)
INSERT INTO public.harness_config (key, value) VALUES
  ('SELF_REPAIR_ENABLED',   'false'),  -- flip to true during slice 1 acceptance window
  ('SELF_REPAIR_DAILY_CAP', '3')
ON CONFLICT (key) DO NOTHING;

-- Rollup bump: after slice 1 ships
UPDATE public.harness_components
SET    completion_pct = 46,
       notes = 'Slice 1 shipped: detect→draft→verify→PR for coordinator_await_timeout. Slice 2 broadens to 3 action types.'
WHERE  id = 'self_repair';
```

**Rollback:** `DROP TABLE IF EXISTS self_repair_runs, self_repair_watchlist CASCADE; DELETE FROM agent_capabilities WHERE agent_id='self_repair'; DELETE FROM harness_config WHERE key IN ('SELF_REPAIR_ENABLED','SELF_REPAIR_DAILY_CAP'); UPDATE harness_components SET completion_pct=0 WHERE id='self_repair';`

---

## Interface Specification

### Five modules — `lib/harness/self-repair/`

**`detector.ts`** — polls `agent_events` for watchlisted failures; one active attempt per action_type via Postgres advisory lock:

```typescript
export interface DetectedFailure {
  eventId: string
  actionType: string
  occurredAt: string
  context: Record<string, unknown>
  agentId: string | null
}

export async function detectNextFailure(): Promise<DetectedFailure | null>
export async function releaseDetectorLock(actionType: string): Promise<void>
```

**`context.ts`** — gathers failure context (recent commits, relevant files, related events). Slice 1 has a hardcoded file-hint map for `coordinator_await_timeout`:

```typescript
export interface FailureContext {
  failure: DetectedFailure
  recentCommits: { sha: string; subject: string; files: string[] }[]
  relevantFiles: { path: string; content: string }[] // capped at 8KB each
  relatedEvents: { occurred_at: string; action: string; context: unknown }[]
}

const ACTION_TYPE_FILE_HINTS: Record<string, string[]> = {
  coordinator_await_timeout: [
    'lib/harness/invoke-coordinator.ts',
    'lib/orchestrator/await-result.ts',
    'app/api/harness/invoke-coordinator/route.ts',
  ],
}

export async function gatherContext(failure: DetectedFailure): Promise<FailureContext>
```

Total context payload capped at 32KB.

**`drafter.ts`** — one Claude Sonnet call (temperature 0); returns `unifiedDiff`, `summary`, `rationale`. No retry on failure:

```typescript
export interface DraftedFix {
  unifiedDiff: string // git-apply-able
  summary: string // ~3 sentences for PR body
  rationale: string // why this fix; appears in PR body and audit
  promptTokens: number
  completionTokens: number
}

export async function draftFix(ctx: FailureContext): Promise<DraftedFix>
```

If the LLM returns invalid JSON or an unapplyable diff: `status='draft_failed'` + telegram escalate. No retry.

**`verifier.ts`** — applies draft inside `runInSandbox()`, runs `npm test` (3-min timeout), mirrors sandbox warnings. References sandbox acceptance criteria AC-3 (no-op round-trip) and AC-5 (failure does not affect main workspace):

```typescript
export interface VerifyResult {
  passed: boolean
  exitCode: number | null
  stdout: string // capped 64KB
  stderr: string
  durationMs: number
  sandboxRunId: string // sandbox_runs.id
  worktreePath: string
  warnings: string[] // from SandboxRunResult.warnings
}

export async function verifyDraft(draft: DraftedFix, ctx: FailureContext): Promise<VerifyResult>
```

Safety override inside `verifyDraft()`: if `SandboxRunResult.filesChanged` contains any path matching `supabase/migrations/**`, immediately mark `status='escalated'` and telegram. Never open a migration PR from self_repair.

**`pr-opener.ts`** — pushes branch `self-repair/<runId>`, opens PR via `httpRequest({capability:'net.outbound.github'})`, telegrams Colin:

```typescript
export interface PROpenResult {
  prNumber: number
  prUrl: string
  branchName: string // 'self-repair/<runId>'
  sha: string
}

export async function openPR(
  draft: DraftedFix,
  verify: VerifyResult,
  ctx: FailureContext,
  runId: string
): Promise<PROpenResult>
```

PR body template includes: trigger event context, drafted summary, rationale, sandbox verification result (including all warnings from `verify.warnings`), explicit disclaimer ("Sandbox tests passing ≠ production-correct. Human review required."), and full audit trail (`self_repair_runs.id`, `sandbox_runs.id`, token counts).

### Cron endpoint — `app/api/harness/self-repair-tick/route.ts`

```
POST /api/harness/self-repair-tick
```

Cron cadence: every 5 minutes. Dispatches the full M1→M5 pipeline in one request lifecycle:

1. Read `harness_config` for `SELF_REPAIR_ENABLED` (default `false` — flip during acceptance window).
2. Check `getCircuitState()` from `lib/ollama/circuit.ts`. If `OPEN`, log `self_repair.circuit_open_defer` to `agent_events`, return 200 (event is NOT consumed — will be retried next tick when circuit is HALF_OPEN or CLOSED).
3. Check daily cap via `COUNT(*) FROM self_repair_runs WHERE detected_at > now() - interval '24h'`.
4. Call `detectNextFailure()`. If null, return 200 no-op.
5. Dispatch context → draft → verify → PR in sequence. Status column flips at each step.
6. Release detector lock in `finally{}`.

Auth: `requireCronSecret(request)` from `lib/auth/cron-secret.ts` (F22 compliance).

---

## New Files

| File                                              | Purpose                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `lib/harness/self-repair/detector.ts`             | Watchlist-filtered failure detection + Postgres advisory lock                                |
| `lib/harness/self-repair/context.ts`              | Context gathering (recent commits + relevant files + related events)                         |
| `lib/harness/self-repair/drafter.ts`              | Claude Sonnet LLM call → unified diff                                                        |
| `lib/harness/self-repair/verifier.ts`             | Apply diff in `runInSandbox()`, run `npm test`, capture pass/fail                            |
| `lib/harness/self-repair/pr-opener.ts`            | Push branch + open PR via arms_legs httpRequest + telegram notify                            |
| `lib/harness/self-repair/digest.ts`               | `buildSelfRepairDigestLine()` — F18 morning digest line                                      |
| `app/api/harness/self-repair-tick/route.ts`       | POST cron endpoint — orchestrates M1–M5 pipeline                                             |
| `supabase/migrations/0065_self_repair_schema.sql` | `self_repair_runs` + `self_repair_watchlist` + AD7 grants + capability seed + cap config     |
| `tests/self-repair/detector.test.ts`              | Watchlist filter, advisory lock, daily cap                                                   |
| `tests/self-repair/drafter.test.ts`               | Mocked LLM → valid diff; `git apply --check` passes                                          |
| `tests/self-repair/verifier.test.ts`              | Pass and fail verification; migration-file safety override                                   |
| `tests/self-repair/pr-opener.test.ts`             | Mocked GitHub API; PR body template validation                                               |
| `tests/self-repair/no-auto-merge.test.ts`         | Grep-based: `merge\|squash\|rebase` absent from `lib/harness/self-repair/` (except fixtures) |
| `tests/self-repair/no-self-target.test.ts`        | Recursion safety: events with `agent_id='self_repair'` are escalated, not acted on           |
| `tests/security/ad7-self-repair.test.ts`          | AD7 lockdown: INSERT from service_role succeeds; DELETE returns permission denied            |

No new React components. `app/api/harness/self-repair-tick/route.ts` is the only new endpoint.

---

## Acceptance Criteria

Builder must pass all of the following before handoff. Each is deterministic.

**A. Schema, capability, watchlist seed**

1. Migration 0065 applied on prod. `list_tables` returns `self_repair_runs` and `self_repair_watchlist`.
2. `self_repair_watchlist` has exactly 1 row: `action_type='coordinator_await_timeout', enabled=true`.
3. `agent_capabilities` rows exist for all 7 grants listed in migration 0065 for `agent_id='self_repair'`.
4. AD7 lockdown: `INSERT INTO self_repair_runs (...)` from `service_role` succeeds; `DELETE FROM self_repair_runs WHERE id=<uuid>` from `service_role` returns `permission denied`. Asserted in `tests/security/ad7-self-repair.test.ts`.
5. `harness_config` rows `SELF_REPAIR_ENABLED=false` and `SELF_REPAIR_DAILY_CAP=3` exist (or are pre-existing at correct values from prior migration).
6. `SELF_REPAIR_ENABLED` flipped to `true` during the acceptance window; restored to `false` after acceptance passes.

**B. Detector finds watchlisted failure, acquires lock, ignores others**

7. Test seeds an `agent_events` row with `action='coordinator_await_timeout'`. `detectNextFailure()` returns a `DetectedFailure` matching the seed.
8. A second concurrent call returns `null` (advisory lock held by the first call's transaction).
9. After `releaseDetectorLock('coordinator_await_timeout')`, a fresh call returns the same event (assuming no `self_repair_runs` row has consumed it yet).
10. An event with `action='drain_trigger_failed'` (not in watchlist) is ignored.
11. An event with `action='coordinator_await_timeout'` AND `agent_id='self_repair'` is ignored (recursion guard).

**C. Daily cap fires when exceeded**

12. Test seeds 3 `self_repair_runs` rows with `detected_at > now() - interval '24h'`.
13. `POST /api/harness/self-repair-tick` returns 200, writes `self_repair.cap_exceeded` to `agent_events`, sends 1 Telegram message to alerts bot. No new `self_repair_runs` row created.

**D. Circuit-open defers the attempt**

14. Test patches `getCircuitState()` to return `state='OPEN'`. `POST /api/harness/self-repair-tick` returns 200. One `agent_events` row with `action='self_repair.circuit_open_defer'` exists. No `self_repair_runs` row created. The triggering `agent_events` row remains unconsumed — same call on the next tick (circuit CLOSED) proceeds normally.

**E. Drafter produces a valid unified diff (mocked LLM)**

15. Mock Claude Sonnet to return a deterministic `{ unifiedDiff, summary, rationale }`.
16. `draftFix(ctx)` returns a `DraftedFix` with all non-empty fields.
17. `git apply --check` against a clean worktree succeeds for the returned diff.
18. `agent_actions` row exists with `agent_id='self_repair'`, `capability='tool.self_repair.draft_fix'`, `result='allowed'`.
19. LLM returns invalid JSON → `status='draft_failed'`, telegram escalate. No retry. No `verify_*` rows.

**F. Sandbox verifier applies diff, runs tests, reports pass/fail honestly**

20. Test seeds a draft that, when applied, makes a passing test fail. `verifyDraft()` returns `{ passed: false, exitCode: !==0 }`. `status='verify_failed'`.
21. Test seeds a draft that, when applied, leaves all tests passing. `verifyDraft()` returns `{ passed: true, exitCode: 0 }`. `status='verify_passed'`.
22. Sandbox `warnings` (e.g., `process_isolation_not_enforced`) mirrored verbatim in `VerifyResult.warnings` and in `self_repair_runs.warnings`.
23. `sandbox_runs` row exists; `self_repair_runs.sandbox_run_id` references it.
24. **No commit, no push, no diff applied to main workspace.** `git status` returns clean in the live workspace after the run. (Per sandbox acceptance criterion AC-5.)
25. Migration-file safety override: draft that modifies `supabase/migrations/` → `status='escalated'` + telegram. PR NOT opened even if `npm test` passes.

**G. PR opener creates a real PR (mocked GitHub API)**

26. Mock `httpRequest` to record GitHub API calls. Trigger full pipeline.
27. One POST to `/repos/.../git/refs` (branch creation), one POST to `/repos/.../pulls` (PR open).
28. PR body matches the §Interface Specification template (regex match on: trigger context section, drafted summary section, sandbox verification section, "What this PR does NOT do" section, audit trail section).
29. `self_repair_runs` row: `status='pr_opened'`, `pr_number`, `pr_url`, `branch_name='self-repair/<runId>'` all populated.
30. One `agent_events` row with `action='self_repair.pr.opened'`, `context.pr_url` and `context.run_id` populated.
31. One Telegram message sent via `telegram(prUrl, ...)`.
32. `cleanupSandbox(sandboxRunId)` called after PR opens. Worktree path removed from disk.

**H. Production smoke (after deploy)**

33. After deploy: `SELF_REPAIR_ENABLED=true` in `harness_config`. Seed a synthetic `agent_events` row with `action='coordinator_await_timeout'` in production via SQL.
34. Within 10 minutes: a `self_repair_runs` row with `status='pr_opened'` exists. PR is visible at `pr_url`.
35. Telegram message received by builder bot.
36. **PR remains unmerged.** Verified by querying GitHub API — `merged: false, state: 'open'`. Restore `SELF_REPAIR_ENABLED=false` after smoke.

**I. Morning digest line**

37. `buildSelfRepairDigestLine()` with no run in last 24h returns `'Self-repair: no run in last 24h'`.
38. Called after 1 `pr_opened` run returns string containing `'1 attempts'`, `'1 PRs opened'`.
39. Called with 2 `verify_failed` + 1 `cap_exceeded` returns string containing `'2 verify-failed'` and `'1 cap-exceeded'`.
40. If any `self_repair_runs` row has `status='pr_opened'` and `detected_at < now() - interval '7 days'` with no PR merge: digest flags `'1 PR unreviewed >7 days'`.

**J. Hard "no auto-merge" assertion**

41. Grep in CI: pattern `merge|squash|rebase` returns 0 matches in `lib/harness/self-repair/` (outside test fixtures with `// test-only` marker).
42. `tests/self-repair/no-auto-merge.test.ts` asserts this at test time, not just CI. Blocks any future PR that adds `/merge` or auto-merge GitHub API calls from `lib/harness/self-repair/`.

**K. Rollup honesty**

43. After slice 1: `SELECT completion_pct FROM harness_components WHERE id='self_repair'` returns `46`.
44. Morning digest line reflects: `'Self-repair: 0 → 46 (slice 1 — detect→draft→verify→PR for coordinator_await_timeout)'`.

**K2. Auto-suspend on false-positive signal (Q2 resolved 2026-05-01)**

1. Test seeds 3 `self_repair_runs` rows for `action_type='coordinator_await_timeout'`, each with `status='pr_opened'` and a matching GitHub PR row showing `state='closed'` and `merged=false` (simulates Colin closing without merge). `detectNextFailure()` for a 4th event of the same action_type: (a) detects the 3-consecutive-close pattern, (b) executes `UPDATE self_repair_watchlist SET enabled=false WHERE action_type='coordinator_await_timeout'`, (c) logs one `agent_events` row with `action='self_repair.watchlist.auto_suspended'` and `context.action_type='coordinator_await_timeout'`, (d) sends one Telegram alert to alerts bot: "self_repair: coordinator_await_timeout auto-suspended after 3 closed-without-merge PRs. Re-enable via SQL." (e) returns `null` — the 4th event is NOT acted on.
2. After `UPDATE self_repair_watchlist SET enabled=true WHERE action_type='coordinator_await_timeout'` (manual Colin re-enable): `detectNextFailure()` resumes returning events for that action_type normally.
3. The 3-consecutive-close counter resets to 0 after any `pr_opened` run for that action_type where the PR is later merged (i.e., a successful merge breaks the consecutive-close streak).

---

## F18 Surfacing Path

**Morning digest line** — `lib/harness/self-repair/digest.ts`:

```typescript
export async function buildSelfRepairDigestLine(): Promise<string> {
  // Query: self_repair_runs in last 24h
  // Aggregate: attempts, pr_opened count, verify_failed count, cap_exceeded count
  // If none: 'Self-repair: no run in last 24h'
  // If runs: 'Self-repair (24h): N attempts, M PRs opened, K verify-failed, J cap-exceeded'
  // Unreviewed PR flag: any pr_opened row > 7 days old → append '| 1 PR unreviewed >7d'
}
```

Added to `composeMorningDigest` in `lib/orchestrator/digest.ts`. One import, one `await`.

**Benchmark:** 0 verify-failed + 0 cap-exceeded per day = self_repair operating at signal quality. Verify-failed rising = LLM is producing low-quality diffs for this action_type (consider removing from watchlist or broadening `relevantFiles`). PR-open rate with low merge rate = false-positive PRs eroding trust (K2 auto-suspend fires after 3 consecutive closed-without-merge).

**Token cost tracking:** `drafter_prompt_tokens` + `drafter_completion_tokens` columns on `self_repair_runs`. Aggregate daily in digest: `'Drafter cost (24h): ~$X.XX (N attempts × avg Mk tokens)'`. Alerts when daily Anthropic spend attributable to self_repair exceeds `$2.00` (configurable in `harness_config.SELF_REPAIR_COST_ALERT_CAD`).

---

## Dependencies — What Must Be Live Before Builder Starts

| Dependency               | What self_repair needs                                                                    | Status today (2026-05-01)                                                | Builder gate |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| `sandbox` slice 1        | `runInSandbox()` + `cleanupSandbox()` + `sandbox_runs` table + `SandboxRunResult`         | ⬜ Acceptance doc landed (PR #57); builder gated on Slice 0 spike + 0045 | Hard block   |
| `sandbox` slice 2        | `boundary_check_wired` (`checkSandboxAction()` integrated in sandbox)                     | ⬜ Not in any acceptance doc yet                                         | Hard block   |
| `security_layer` slice 1 | `agent_actions` table (migration 0045)                                                    | ⬜ Pre-migration baseline (30%)                                          | Hard block   |
| `security_layer` slice 2 | `capability_registry` + `agent_capabilities` + `self_repair` agent_id                     | ⬜ Pre-migration                                                         | Hard block   |
| `security_layer` slice 3 | `requireCapability()` middleware in log_only mode                                         | ⬜ In priority queue                                                     | Hard block   |
| `arms_legs` S2 Phase B+C | `httpRequest(net.outbound.anthropic)` + `httpRequest(net.outbound.github)` + `telegram()` | ⬜ Draft commit 078578f; not merged                                      | Hard block   |
| `lib/ollama/circuit.ts`  | `getCircuitState()` for network-failure detection                                         | ✅ Live in production                                                    | No gate      |

**Realistic build slot:** self_repair is dependency #7 in the T1-C agentic capabilities chain (security_layer → sandbox → arms_legs → digital_twin → telegram_outbound → specialized_agents → **self_repair**). Spec lands now; build slot opens when the chain above clears.

---

## Out of Scope for Slice 1

| Topic                                                  | Why deferred                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Auto-merge                                             | AD2: never in slice 1. Slice 4+ requires separate Colin-approved redline.                        |
| Confidence scoring                                     | AD5: binary pass/fail is sufficient for slice 1's value. Slice 4+.                               |
| Multiple draft attempts per event                      | CLAUDE.md retry limit (max 2). Slice 1 caps at 1. Second draft is "fix the fix" territory.       |
| Sentry SDK as trigger source                           | Not live in repo (verified 2026-04-28). Slice 3. Slice 1's `agent_events` poller is the MVT.     |
| GitHub Actions failed-deploy webhook                   | Not wired. Slice 2.                                                                              |
| Auto-fix lint / Prettier failures                      | Slice 2 candidate. Slice 1 always escalates lint-only failures. Per-failure-class override.      |
| DB migration conflicts as watchlist entry              | Migration-file safety override already blocks the most dangerous case. Explicit entry: slice 3.  |
| Sentry error → self_repair fix                         | Slice 3.                                                                                         |
| Cross-repo fixes                                       | `loeppkyc/lepios` only.                                                                          |
| Per-action-type LLM model selection                    | Slice 1 ships Sonnet only. Router: slice 3+ if cost data shows Haiku suffices for simpler types. |
| PR auto-close after N days unreviewed                  | Slice 1 surfaces in morning_digest (acceptance I.40). Auto-close deferred per Q1 (digest-only).  |
| Chat-UI surface (`/self-repair status`)                | After chat_ui slice 4.                                                                           |
| Distributed watchlist (multiple coordinators)          | Not needed while single coordinator loop is the pattern.                                         |
| Cost dashboard beyond digest line                      | Token columns exist; aggregate dashboard: slice 3+.                                              |
| Recursion beyond one level (self_repair fixing itself) | Hard exclusion in slice 1 (acceptance B.11 + `no-self-target.test.ts`). Slice N/A.               |

---

## Decisions

### Resolved (carried forward from SELF_REPAIR_SPEC.md, Draft 1, 2026-04-28)

**AD1 — Trigger source: `agent_events`, not Sentry, not GitHub Actions (RESOLVED)**
`agent_events` is live and has 26 historical failure rows across 5 action types. Building against a trigger that doesn't exist forces this spec to also scope Sentry SDK + GitHub Actions receiver — both real but separable. Slice 1 polls `agent_events`. Sentry deferred to slice 3.

**AD2 — NEVER auto-merge in slice 1. Period. (RESOLVED)**
Every drafted fix opens a PR. Colin reviews. Colin merges. Foundation spec's "auto-apply ≥ 8" is acknowledged and explicitly deferred to slice 4+ behind a separate Colin-approved redline. Sandbox tests passing ≠ production-correct. Human PR review is the catch. Pinned by acceptance criterion J.

**AD3 — ALL drafted-fix execution inside `runInSandbox()` (RESOLVED)**
Self_repair never `git apply`s to the live workspace. Drafted patch is written to worktree files. Verification runs via `runInSandbox()`. PR is opened from the worktree diff. Main workspace is untouched until a human merges the PR. `process_isolation_not_enforced` warning from sandbox is surfaced in the PR body — the PR review is the second gate.

**AD4 — Watchlist registry: explicit opt-in per action type. Slice 1 seed: `coordinator_await_timeout` only. (RESOLVED)**
Without a registry, a wildcard listener on `*_failed` would attempt to fix transient infrastructure blips. `drain_trigger_failed` (highest-volume: 16 events) was explicitly excluded in favor of `coordinator_await_timeout` (2 events, code-fixable). Adding a new action type = one `INSERT INTO self_repair_watchlist` row; no code deploy.

**AD5 — No confidence scoring in slice 1 (RESOLVED)**
Binary pass/fail (sandbox tests pass after applying the diff) is the acceptance gate. Confidence-as-a-number is model-of-the-model that doesn't add value when we have deterministic test output. Slice 4+, with a separate redline from Colin.

**AD6 — Claude Sonnet as drafter LLM; `agent_id='self_repair'` (RESOLVED)**
Opus: overkill cost ($15/Mtoken). Haiku: insufficient code quality for unified-diff generation. Sonnet: best cost/quality; already used by `scripts/ai-review.mjs`. Temperature 0 for reproducibility. `agent_id='self_repair'` mirrors `'chat_ui'` pattern from chat_ui spec AD4.

**AD7 — Hard cap: 1 active attempt per action_type; max 3 attempts/day (RESOLVED)**
Postgres advisory lock per `(action_type)` prevents concurrent drafts on the same failure. Daily cap=3 stored in `harness_config.SELF_REPAIR_DAILY_CAP` — editable without redeploy. Cap exceeded: `cap_exceeded` event + telegram alert. No silent swallowing.

**Architecture — detect→draft→verify→PR state machine (RESOLVED)**
Five modules (detector, context, drafter, verifier, pr-opener) in sequential pipeline per cron tick. One `self_repair_runs` row tracks the full lifecycle. All status transitions are explicit column writes. No in-memory-only state.

### Resolved 2026-05-01

**Q1 — Unreviewed PR policy: RESOLVED (digest-only)**
PRs that have been open >7 days are surfaced in morning_digest (acceptance criterion I.40). No auto-close, no escalating Telegram. Revisit at slice 3 if PR volume exceeds 2/week.

**Q2 — False-positive auto-suspend: RESOLVED (ship in slice 1)**
After 3 consecutive self_repair PRs for the same action_type are closed-without-merge by Colin, `self_repair_watchlist.enabled` is set to `false` for that action_type automatically. Telegram alert fires. Re-enable is manual via SQL. Consecutive-close streak resets on any successful merge. See acceptance criterion K2 for the full test spec.

**Q3 — GitHub PR author identity: RESOLVED (Colin's PAT for slice 1)**
Slice 1 uses `GITHUB_TOKEN` (PAT owned by Colin). PR author shows as Colin — makes the review queue unambiguous. Bot account adds operational overhead not warranted at slice 1 volume. Revisit if PR volume > 10/week.

**Q4 — Lint / Prettier failures: RESOLVED (always escalate in slice 1)**
Lint-only failures (Prettier, ESLint, `tsc --noEmit`) → `verify_failed` → telegram escalate. No auto-fix. Prettier auto-fix is a slice 2 watchlist entry (`lint_failed` action type, `npm run format` in sandbox, no LLM needed) — it gets its own acceptance doc when it ships.

---

## 20% Better Over Current Baseline

**Current state:** every harness failure that reaches `agent_events` with a status of `failure` stops the loop and waits for Colin. No autonomous diagnosis, no candidate fix, no PR. Colin's intervention sequence: read Telegram alert → open `agent_events` → diagnose root cause → open relevant file → draft fix → commit → push → wait for CI → merge. Average elapsed time: 20–40 minutes of Colin's active attention.

**With self_repair slice 1 — projected improvements:**

1. **`coordinator_await_timeout` resolves without Colin attention** — estimate: 80% of cases. The remaining 20% are novel timeout sources where the LLM cannot find the relevant file. These escalate to Telegram with context already gathered — Colin's diagnosis time drops even for failures self_repair can't fix.

2. **Colin-pause events per 100 builder runs drops from ~10 to ~2** — historical rate: 26 failure events across ~260 tracked runs (~10%). Slice 1 absorbs the `coordinator_await_timeout` class (2 historical events) plus any new instances. Conservatively: 80% of those events resolved autonomously.

3. **Audit trail from day one** — `self_repair_runs` gives a forensic record of every attempt: what was triggered, what was drafted, what the sandbox said, what PR was opened (or why it wasn't). Before this: no record beyond the raw `agent_events` row.

4. **Watchlist as backlog surface** — every new `*_failed` event type that exceeds 3 occurrences in `agent_events` becomes a candidate for Colin to opt-in. The watchlist converts passive alert-reading into active improvement decisions.

5. **Downstream: push_bash_automation unblocked** — `push_bash_automation` (weight 3) needs a retry policy layer before it's safe. Self_repair's classify-and-act framework provides that layer for the "bash command fails" case. That's the 3 downstream points.

**Concrete metric for "20% Better":** track `self_repair_runs WHERE status='pr_opened' AND (SELECT merged FROM github_pr WHERE number=self_repair_runs.pr_number) = true`. PR-merge rate ≥ 50% after 4 weeks = self_repair is producing useful fixes, not noise. Below 50% = re-evaluate watchlist seed or drafter prompt.
