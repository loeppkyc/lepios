# Acceptance Doc — Sandbox (harness:sandbox)

Component: harness:sandbox · Track: T1-C (Agentic Capabilities) · Weight: 7 · Current: 0%
Date: 2026-05-01
Author: Coordinator (draft for Colin review)
Branch: TBD (create `harness/sandbox-slice-1` from main before builder picks up)

**Builder gate — prerequisites status (as of 2026-05-03):**

1. ✅ Migration 0045 (`security_layer_schema`) applied — `agent_actions`, `capability_registry`, `agent_capabilities` all live in production (security_layer 100%).
2. ✅ Slice 0 spike signed off — AD3 confirmed on Vercel (kill latency 100ms, `processStillAlive: false`). See `docs/harness/SANDBOX_SLICE0_SPIKE_REPORT.md`.
3. `lib/security/sandbox-contract.ts` — **NOT shipped yet, but only the `SandboxScope` type is needed for Slice 1**. Builder creates it as a types-only stub (no `checkSandboxAction()` implementation — that is Slice 2). See §Interface Specification below.

All prerequisites for Slice 1 are met. Builder may start immediately.

**Scope of this acceptance doc:** Slice 1 only (workspace isolation + audit trail). Slice 2 (capability enforcement wiring) and Slice 3+ (process isolation / Docker) are out of scope. Slice 1 lands the sandbox at **~50%** completion, not 60%.

---

## Purpose

Give the harness a clean execution boundary so builders can run code mutations without
touching the live workspace if something goes wrong.

Today, every builder task executes directly on the checked-out branch. A mid-run failure
that partially writes files, partially applies a migration, or partially commits leaves
the repo in an unknown state — and Colin has to inspect and clean up before the next task
can start. That is the loop-stop.

This component wraps any shell command in an ephemeral git worktree, captures what
changed (`git diff`), times out runaway commands, and writes an audit row per run. On
success, the caller promotes the diff to a real PR. On failure, the worktree is discarded
with no trace in the live branch.

---

## Context — Why This Ranks #3

`self_repair` (weight 6) cannot run a drafted fix without a safe workspace.
`push_bash_automation` (weight 3) cannot auto-execute shell allowlist commands without
a boundary. Together those are 9 points of downstream capability gated here.

Without sandbox, every harness failure requires Colin to inspect state and resume manually.
The "walk away while the harness works" goal is unreachable without it.

This spec translates `docs/harness/SANDBOX_LAYER_SPEC.md` (Draft 1, 2026-04-28) into the
builder contract format. All five architecture decisions (AD1–AD5) in that spec are
pre-resolved and carried forward here verbatim. The open questions below are the items
that spec intentionally flagged for Colin sign-off.

---

## Requirements Boundary

**MUST:**

- Isolate filesystem changes — the sandbox cmd writes only inside the ephemeral worktree, not the live workspace.
- Capture the diff — return `filesChanged`, `diffStat`, and `diffHash` after every run so callers can promote a real PR without re-running the command.
- Enforce a timeout — hard-kill the process group on overrun; return `timedOut: true`.
- Write an audit row — every invocation produces a `sandbox_runs` row and an `agent_actions` link.
- Allow clean rollback — on any failure, the worktree is discarded; main workspace is unchanged.
- Not require Colin approval per sandbox creation — sandbox creation is autonomous, just like worktree creation today.

**MUST NOT:**

- Slow normal builder work — `runInSandbox()` is called only when the coordinator explicitly delegates a risky step; it is not in the hot path for read-only tasks.
- Introduce a new endpoint in slice 1 — `runInSandbox()` is an in-process library call; the optional HTTP route (`POST /api/harness/sandbox-run`) is slice 3+.
- Claim it blocks the DB — slice 1 is workspace isolation only. DB write isolation is handled by the security_layer capability grants (Q2 below), not by a Supabase branch. This is an honest limitation, surfaced via `warnings`.

---

## Architecture Choice

Three options considered:

| Option                                                              | Description                                                                                                | Verdict                                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** — Git worktree + ephemeral Supabase branch                    | Full isolation: filesystem AND database. Clean and correct.                                                | **Slice 3+** — Supabase branch API is usable but adds 5-15s provisioning latency per run; overkill until self_repair needs to test migrations.         |
| **B** — Git worktree only, DB writes controlled by capability layer | Workspace isolation; DB write isolation is via `security_layer` capability grants (not a physical branch). | **Recommended for slice 1.** Matches `SANDBOX_LAYER_SPEC.md` AD1. Already-agreed primitive; zero new infra; fs-diff via `git diff`.                    |
| **C** — In-memory diff staging with explicit commit gate            | Diffs held in memory; no real workspace isolation.                                                         | **Not suitable.** Cannot sandbox long-running commands, cannot kill them, and cannot represent filesystem changes that the cmd itself does not return. |

**Recommendation: Option B.** Colin must confirm this choice and answer Q2 (DB isolation posture) before builder starts.

---

## Input Data Sources — Grounded

Verified against `supabase/migrations/` on main as of 2026-05-01.

| Table / file         | Migration                 | Status                                             | Role                                                             |
| -------------------- | ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `agent_actions`      | 0045 (security_layer)     | **Applied** (security_layer 100% as of 2026-05-03) | FK target for `sandbox_runs.audit_action_id`; audit log          |
| `agent_events`       | 0005                      | Applied                                            | F18 morning digest query target                                  |
| `harness_components` | 0043                      | Applied                                            | Contains `harness:sandbox` row at 0%; UPDATE after slice 1 ships |
| `sandbox_runs`       | **0067** (this component) | **Not yet written**                                | New table — one row per `runInSandbox()` invocation              |

**Migration dependency constraint:** 0067 must be applied AFTER 0045. Builder must confirm
`SELECT id FROM harness_components WHERE id = 'harness:sandbox'` returns a row AND
`SELECT 1 FROM agent_actions LIMIT 1` succeeds before writing migration 0067.

**Next available migration slot:** 0067. Slots 0046–0066 are all taken; 0100 also exists.
Builder must verify no concurrent PR claims 0067 before writing.

---

## Slice 0 Spike — Required Before Builder Starts

**Purpose:** Verify that Vercel's Node.js runtime supports `spawn(detached: true)` +
`process.kill(-pid, 'SIGTERM')` (the timeout-enforcement primitive in AD3). This is not
known from documentation alone.

**Spike deliverable:**

1. Deploy a temporary route `app/api/_spike/proc-group-kill/route.ts` to a Vercel preview that:
   - Spawns `sh -c 'sleep 30 & sleep 30 & wait'` with `{ detached: true }`
   - Waits 500ms, sends SIGTERM to the process group (`process.kill(-child.pid!, 'SIGTERM')`), waits 2s, sends SIGKILL
   - Returns `{ killSucceeded, residualProcs, nodeVersion }` as JSON
2. Hit the route and record the result in `docs/harness/sandbox-spike-2026-05-01.md`.
3. Remove the spike route before slice 1 PR opens.

**Pass condition:** `killSucceeded === true` AND `residualProcs` is empty → AD3 stands; proceed with slice 1.

**Fail condition:** If kill fails or residual procs survive, two redirect paths (Colin picks):

- **R-A:** Sandbox is local-only (Colin's machine + GPU box). Vercel functions never call `runInSandbox()`. `self_repair` and `push_bash_automation` become local-tier only.
- **R-B:** Wrap cmd with `timeout -s SIGTERM <N>s sh -c "<cmd>"` (OS does the killing). Requires GNU `timeout` on Vercel's image — verify in the same spike.

**Q3 below asks Colin to confirm which path to take if the spike fails.**

---

## Schema Proposal — Migration 0046

```sql
-- 0067_sandbox_layer_schema.sql
-- Depends on 0045 (agent_actions table must exist before this runs)

CREATE TABLE public.sandbox_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id       TEXT        NOT NULL,  -- '{agentId}:{worktree_dir_name}' — computed once, pinned (AD5)
  agent_id         TEXT        NOT NULL,
  capability       TEXT        NOT NULL,  -- what was requested (e.g. 'shell.run')
  scope            JSONB       NOT NULL,  -- snapshot of SandboxScope at start

  -- Lifecycle
  status           TEXT        NOT NULL
    CHECK (status IN ('running','completed','failed','denied','timeout','cleaned')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  cleaned_at       TIMESTAMPTZ,
  duration_ms      INTEGER,

  -- Worktree
  worktree_path    TEXT        NOT NULL,  -- absolute path on host; hint, not identifier (AD5)
  base_sha         TEXT        NOT NULL,  -- HEAD at worktree creation — diff base
  cmd              TEXT        NOT NULL,
  cwd              TEXT,

  -- Outputs
  exit_code        INTEGER,              -- null if killed / denied
  timed_out        BOOLEAN     NOT NULL DEFAULT false,
  stdout_truncated TEXT,                 -- capped at 256 KB
  stderr_truncated TEXT,
  files_changed    TEXT[]      NOT NULL DEFAULT '{}',
  diff_stat        JSONB,                -- { insertions, deletions, files }
  diff_hash        TEXT,                 -- sha256 of unified diff
  warnings         TEXT[]      NOT NULL DEFAULT '{}',  -- surfaced to caller (e.g. 'net_isolation_not_enforced')

  -- Audit
  audit_action_id  UUID        REFERENCES public.agent_actions(id) ON DELETE NO ACTION,
  reason           TEXT
);

CREATE INDEX idx_sandbox_runs_agent_started ON public.sandbox_runs (agent_id, started_at DESC);
CREATE INDEX idx_sandbox_runs_status ON public.sandbox_runs (status)
  WHERE status IN ('running', 'denied', 'timeout');

ALTER TABLE public.sandbox_runs ENABLE ROW LEVEL SECURITY;

-- AD7 GRANT lockdown (matches security_layer pattern): append-only for service_role
REVOKE UPDATE, DELETE ON public.sandbox_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.sandbox_runs TO service_role;
-- Exception: cleanupSandbox() needs to mark cleaned_at and status
GRANT UPDATE (cleaned_at, status) ON public.sandbox_runs TO service_role;

-- Rollup bump: after slice 1 ships, update harness_components
UPDATE public.harness_components
SET    completion_pct = 50,  -- honest: slice 1 only; slice 2 lifts to 65
       notes = 'Slice 1 shipped: worktree runtime + fs-diff + audit. Slice 2 pending: boundary_check_wired.'
WHERE  id = 'harness:sandbox';
```

**Rollback:** `DROP TABLE IF EXISTS public.sandbox_runs CASCADE; UPDATE harness_components SET completion_pct = 0 WHERE id = 'harness:sandbox';`

---

## Interface Specification

### `lib/harness/sandbox/runtime.ts`

```typescript
import type { SandboxScope } from '@/lib/security/sandbox-contract'

export interface SandboxRunOptions {
  agentId: string // who is asking — matches harness_components slug
  capability: string // what they're doing — passed to checkSandboxAction (slice 2)
  scope: SandboxScope // from lib/security/sandbox-contract.ts
  timeoutMs?: number // default 60_000; max 300_000
  cwd?: string // optional sub-path within worktree
  env?: Record<string, string> // merged over clean baseline env
  reason?: string // free-form; written to sandbox_runs.reason
}

export interface SandboxRunResult {
  sandboxId: string
  worktreePath: string // for caller to inspect diff before cleanup
  exitCode: number | null // null if killed
  stdout: string // capped at 256 KB
  stderr: string
  timedOut: boolean
  durationMs: number
  filesChanged: string[] // relative paths touched by cmd
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string // sha256 of unified diff — stable for identical commands
  runId: string // sandbox_runs.id
  warnings: string[] // non-fatal isolation gaps (see §Warnings)
}

export async function runInSandbox(
  cmd: string | string[],
  opts: SandboxRunOptions
): Promise<SandboxRunResult>

export async function cleanupSandbox(runId: string): Promise<void>
// Removes worktreePath from disk, sets status='cleaned', cleaned_at=now()
```

**Lifecycle inside `runInSandbox()`:**

1. Create ephemeral worktree at `.claude/worktrees/sandbox-{ulid}/` (prefix `sandbox-` avoids collision with Claude Code's own `agent-*` worktrees).
2. Compute `sandboxId = '{agentId}:{worktree_dir_name}'`. Pin to run row — never changes after insert (AD5).
3. Insert `sandbox_runs` row with `status='running'`, `base_sha = HEAD`.
4. **Slice 1:** skip `checkSandboxAction()` call (security_layer slice 6 not yet wired). **Slice 2:** call `checkSandboxAction()`; if denied, mark row `status='denied'`, throw `SandboxDeniedError`.
5. Spawn `cmd` with `{ cwd: worktreePath, timeout: opts.timeoutMs, detached: true }` + clean env merged with `opts.env`.
6. On exit or timeout: capture stdout/stderr (truncate at 256 KB), call `captureFsDiff(worktreePath, base_sha)`, populate `warnings`.
7. Update `sandbox_runs` row. Return `SandboxRunResult`. Do NOT delete worktree — caller reads diff, then calls `cleanupSandbox(runId)`.

**Warnings surfaced in slice 1:**

| Warning string                     | Emitted when                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `'net_isolation_not_enforced'`     | `scope.net` is non-empty (worktree cannot block outbound HTTP)                               |
| `'process_isolation_not_enforced'` | Every run in slice 1 (no Docker)                                                             |
| `'fs_isolation_advisory'`          | `scope.fs.deniedPaths` is non-empty (worktree can't enforce fine-grained deny within itself) |

Callers may assert `warnings.length === 0` and refuse to promote the result if they require real isolation.

### `lib/harness/sandbox/fs-diff.ts`

```typescript
export async function captureFsDiff(
  worktreePath: string,
  baseSha: string
): Promise<{
  filesChanged: string[]
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string
}>
```

Implementation: shells out with `LANG=C` override (locale-safe) to:

- `git diff --name-only {baseSha} HEAD` — tracked changes
- `git ls-files --others --exclude-standard` — untracked (new) files
- `git diff --stat {baseSha} HEAD` — summary
- `git diff {baseSha} HEAD | sha256sum` — content hash

Edge: if `cmd` ran `git commit`, diff is empty vs HEAD but non-empty vs `baseSha`. `baseSha` ensures the diff captures all changes the cmd made, including staged commits.

---

## New Files

| File                                                | Purpose                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `lib/security/sandbox-contract.ts`                  | Types-only stub: `SandboxScope` type (Slice 1 only — no `checkSandboxAction()` impl; that is Slice 2) |
| `lib/harness/sandbox/runtime.ts`                    | `runInSandbox()` + `cleanupSandbox()` — worktree lifecycle + spawn + timeout                          |
| `lib/harness/sandbox/fs-diff.ts`                    | `captureFsDiff()` — git-diff-based filesystem change capture                                          |
| `lib/harness/sandbox/digest.ts`                     | `buildSandboxDigestLine()` — F18 morning digest line                                                  |
| `supabase/migrations/0067_sandbox_layer_schema.sql` | `sandbox_runs` table + RLS + AD7 GRANT lockdown + rollup bump                                         |
| `tests/sandbox/runtime.test.ts`                     | Unit tests: round-trip, fs-diff, timeout, warnings                                                    |
| `tests/sandbox/ad7-runtime.test.ts`                 | Grant enforcement: INSERT succeeds, DELETE from service_role fails                                    |

No new React components. No new API route in slice 1 (in-process library only).

---

## Acceptance Criteria

Builder must pass all of the following before handoff. Each is deterministic.

1. **Migration 0046 applied:** `SELECT id FROM sandbox_runs LIMIT 1` returns without error on the production Supabase instance. `list_migrations` shows `0046_sandbox_layer_schema` present.

2. **AD7 GRANT lockdown holds:** `INSERT INTO sandbox_runs (sandbox_id, agent_id, capability, scope, status, worktree_path, base_sha, cmd) VALUES (...)` from `service_role` succeeds. `DELETE FROM sandbox_runs WHERE id = $id` from `service_role` returns `permission denied`. Asserted in `tests/sandbox/ad7-runtime.test.ts`.

3. **No-op round-trip:**
   `runInSandbox('echo hello', { agentId: 'test', capability: 'shell.run', scope: { fs: { allowedPaths: ['.'] } } })`
   returns `{ exitCode: 0, stdout: 'hello\n', timedOut: false, filesChanged: [], diffStat: { files: 0 }, runId: <uuid> }`.
   One `sandbox_runs` row with `status = 'completed'` exists. `worktreePath` exists on disk and is a git checkout.

4. **fs-diff captures a real change:**
   `runInSandbox('echo modified > sandbox_test.txt', { ... })` returns
   `{ filesChanged: ['sandbox_test.txt'], diffStat: { insertions: 1, files: 1 }, diffHash: <non-empty string> }`.
   Running the same command twice produces the same `diffHash`.

5. **Intentional failure inside sandbox does not affect main:**
   `runInSandbox('rm -rf .git && echo done', { ... })` completes (exitCode 0 inside the worktree).
   After the run: the live workspace's `.git/` is intact. `git status` in the live workspace shows no changes. The `sandbox_runs` row shows `status = 'completed'` and `files_changed` contains entries from the worktree only — not paths in the live workspace.

6. **Timeout enforcement:**
   `runInSandbox('sleep 10', { ..., timeoutMs: 1000 })` returns within ~2s.
   Result: `{ timedOut: true, exitCode: null }`. Row `status = 'timeout'`.
   After return: `pgrep -f 'sleep 10'` in the host shell returns no results (process group killed).
   _If Slice 0 selected R-A (local-only):_ this test is marked `it.skipIf(isVercel)` and asserted only on local runs.

7. **Cleanup:**
   `cleanupSandbox(runId)` removes the worktree directory from disk. After cleanup, `worktreePath` does not exist on disk. `SELECT cleaned_at, status FROM sandbox_runs WHERE id = $runId` returns a non-null `cleaned_at` and `status = 'cleaned'`.

8. **Orphan GC query exists:**
   A query exists (in a cron or util) that selects `sandbox_runs WHERE status IN ('running','completed') AND started_at < now() - interval '24 hours' AND cleaned_at IS NULL`. The query is tested for correct shape; the GC sweep itself is slice 2.

9. **`net_isolation_not_enforced` warning surfaces:**
   `runInSandbox('true', { ..., scope: { fs: { allowedPaths: ['.'] }, net: { allowedHosts: ['example.com'] } } })` returns `warnings` array containing `'net_isolation_not_enforced'`.
   With `scope.net` absent or `{}`: `warnings` does NOT contain `'net_isolation_not_enforced'`.
   `sandbox_runs.warnings` column mirrors `result.warnings` exactly.

10. **`process_isolation_not_enforced` warning surfaces on every run:**
    Every call to `runInSandbox()` in slice 1 includes `'process_isolation_not_enforced'` in `result.warnings` and in the DB row.

11. **Audit row written:**
    After any successful `runInSandbox()` call where security*layer 0045 is live: one `agent_actions` row with `action_type = 'sandbox_check'` exists, and `sandbox_runs.audit_action_id` references it.
    \_If security_layer 0045 is not yet applied:* `audit_action_id` is NULL; test is skipped with a comment noting the gate.

12. **Morning digest line:**
    `buildSandboxDigestLine()` called when no run in last 24h returns `'Sandbox: no run in last 24h'`.
    Called after a run with 0 warnings returns `'Sandbox (24h): 1 runs, 0 denies, 0 timeouts'`.
    Called after a timed-out run returns a string containing `'1 timeouts'`.

13. **Rollup bump correct:**
    `SELECT completion_pct FROM harness_components WHERE id = 'harness:sandbox'` returns `50` after migration 0046 applies. Not 60 — honest: slice 2 lifts it the rest of the way.

---

## F18 Surfacing Path

**Morning digest line** — `lib/harness/sandbox/digest.ts`:

```typescript
export async function buildSandboxDigestLine(): Promise<string> {
  // Query: sandbox_runs in last 24h
  // Aggregate: total runs, denied count, timeout count, escape count
  // If none: 'Sandbox: no run in last 24h'
  // If runs: 'Sandbox (24h): N runs, M denies, K timeouts'
  // If escapes > 0 (sandbox_escape_detected in agent_actions): append '⚠ escape detected'
}
```

Added to `composeMorningDigest` in `lib/orchestrator/digest.ts`. One import, one `await`.

**Escape detection:** If any `agent_actions` row with `action_type = 'sandbox_escape_detected'` appears in the trailing 24h, fire `loeppky_alerts_bot` immediately (not deferred to morning). This is a separate alert path, not part of the digest summary.

**Benchmark:** 0 denies and 0 timeouts per day = sandbox is working without friction. Timeout counts rising = commands are too slow for the current limit; raise the ceiling or investigate the command. Escape count > 0 = immediate investigation required.

---

## Dependencies — What Must Be Live Before Builder Starts

| Dependency               | What sandbox needs                                                          | Status today                         | Builder gate                                                                   |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `security_layer` slice 1 | `agent_actions` table (migration 0045)                                      | ✅ **Applied** (security_layer 100%) | Met                                                                            |
| `security_layer` slice 2 | `capability_registry` + `agent_capabilities` seeded                         | ✅ **Applied** (security_layer 100%) | Met; audit_action_id will be non-NULL for Slice 1 runs                         |
| `security_layer` slice 6 | `lib/security/sandbox-contract.ts` — `SandboxScope`, `checkSandboxAction()` | Types-only stub created in this PR   | Hard block for slice 2 `boundary_check_wired`; slice 1 creates types-only stub |
| Slice 0 spike            | Vercel POSIX kill surface confirmed                                         | ✅ **Signed off** (AD3, 2026-05-02)  | Met                                                                            |

**Slice 1 can start immediately.** All prerequisites met. Slice 2 (`boundary_check_wired`) waits for `checkSandboxAction()` implementation (security_layer slice 6 — deferred).

---

## Out of Scope for v1 (Slice 1)

| Topic                                           | Why deferred                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| DB write isolation (Supabase branch)            | Option A — provisioning latency + cost; blocked on Q2 decision                         |
| Process isolation (Docker / firejail)           | Slice 3+ — requires local-execution tier on Colin's machine / GPU box                  |
| HTTP endpoint (`POST /api/harness/sandbox-run`) | Slice 3+ — in-process call only for slice 1                                            |
| Pre-warmed worktree pool                        | Slice 2 follow-on if creation latency (~500ms–2s) is measured as a bottleneck          |
| Network firewall enforcement                    | Slice 3+ — `SandboxScope.net` is log-only; worktree cannot block outbound HTTP         |
| GC cron for orphan worktrees                    | Slice 2 — query exists in slice 1 (acceptance 8); the sweep itself follows             |
| `self_repair` integration                       | Separate acceptance doc; sandbox provides the runtime; self_repair provides the policy |
| `push_bash_automation` integration              | Same — gated on sandbox slice 1+2 shipping                                             |
| Cross-machine sandbox (Vercel → GPU box)        | Future remote-execution layer; not a v1 concern                                        |

---

## Decisions

### Resolved (carried forward from SANDBOX_LAYER_SPEC.md, Draft 1, 2026-04-28)

**AD1 — Implementation primitive: git worktree for slice 1, Docker for slice 3+: RESOLVED**
Worktree is already in use for subagents (`.claude/worktrees/agent-*`). Zero new infra. `sandbox-*`
prefix avoids collision with Claude Code's own GC. Docker deferred until local-execution tier
is real.

**AD2 — fs-diff via `git diff --stat` + `--name-only` + sha256: RESOLVED**
Captures tracked + untracked changes. Diffs against `base_sha` (not HEAD) so `git commit` calls
inside the cmd don't hide changes. `LANG=C` override prevents locale-sensitive output parsing.

**AD3 — Timeout via `child_process.spawn(detached: true)` + `process.kill(-pid, 'SIGTERM')`: RESOLVED PENDING SPIKE**
60s default, 300s max. Hard kill on overrun. Spike 0 must confirm this works on Vercel's POSIX
surface before any slice 1 code is written.

**AD4 — Audit trail: `sandbox_runs` row + `agent_actions` link per run: RESOLVED**
`sandbox_runs` is the operational record. `agent_actions` (security_layer AD7) is the
security audit. Linked via `sandbox_runs.audit_action_id`.

**AD5 — Sandbox identity = `'{agentId}:{worktree_dir_name}'`, no registry: RESOLVED**
Computed once, pinned to row. Worktree renames post-creation don't break audit lookups.

**Architecture option B (worktree-only): RESOLVED PENDING Q2**
Option B selected. Supabase branch (option A) deferred to slice 3+. In-memory diff (option C)
unsuitable for arbitrary code execution. Colin must confirm Q2 (DB isolation posture within B).

### Resolved 2026-05-01

**Q1 — Slice 0 spike result: GATE**
Cannot resolve until the spike runs. Builder's first task on this branch is to execute the
Slice 0 spike (deploy the proc-group-kill route to a Vercel preview, record the result in
`docs/harness/sandbox-spike-2026-05-01.md`). The spike result determines which path applies:
AD3 (SIGTERM works), R-A (local-only sandbox), or R-B (GNU timeout wrapper). Builder posts
the result as a comment on this PR and proceeds with the chosen path. This doc auto-resolves
on spike completion — no further Colin input required unless the spike produces an unexpected
fourth outcome.

Builder cannot write any `child_process.spawn` logic until the spike artifact exists and the
path is selected.

**Q2 — DB write isolation: RESOLVED Q2-A (2026-05-01)**
Sandbox v1 = workspace isolation only. DB write isolation is security_layer's responsibility
via capability grants (AD7). `runInSandbox()` makes no attempt to limit what the cmd does to
Supabase — the capability layer enforces that boundary. The `process_isolation_not_enforced`
warning surfaces the gap honestly to every caller.

Builder hardcodes `'process_isolation_not_enforced'` in `warnings` on every slice 1 run (see
acceptance criterion 10). No dry-run flag injection; no Supabase branch provisioning.

**Q3 — Vercel spike fail path: RESOLVED — resolved-by-Q1 (2026-05-01)**
If the spike selects R-A, acceptance criterion 6 (timeout enforcement) is guarded with
`it.skipIf(isVercel)`. If the spike selects R-B, the spawn wrapper uses GNU `timeout` instead
of `process.kill(-pid)`. Both paths are self-contained in the spike result doc. No further
decision needed.

**Q4 — Sandbox infrastructure crash handling: RESOLVED (2026-05-01)**
If `runInSandbox()` itself throws (worktree creation fails, DB insert fails, etc.):

- Set `task_queue.status = 'failed'` for the claiming task.
- Insert one `agent_events` row: `action = 'sandbox.infrastructure_failure'`, `status = 'error'`, `meta.run_id` = the UUID that was generated (or null if the row was never inserted), `meta.error` = the thrown message.
- Surface `run_id` in `output_summary` so the coordinator can correlate.

This gives the coordinator a clean re-queue signal. The task is not left in `'claimed'` (would stall the loop) and is not silently swallowed.

---

## 20% Better Over Current Baseline

Current state: zero isolation. Builder tasks write directly to the live workspace. A mid-run
failure requires Colin to run `git status`, manually revert partial changes, and restart the
task. Average Colin-pause per failed harness task: ~10-20 minutes of inspection + cleanup.

With sandbox slice 1:

1. **Failed runs leave no trace** — discarding the worktree is the entire cleanup. Colin-pause
   on harness failure drops from ~15 minutes to ~30 seconds (read the failure log, re-queue).

2. **`self_repair` becomes buildable** — without sandbox, self_repair cannot safely trial a
   patch. With slice 1, it can run the patch in a worktree, read the diff, and open a PR only
   on a clean exit. This unlocks 6 points of downstream harness capability.

3. **`push_bash_automation` becomes buildable** — auto-tier shell commands move from
   "requires Colin approval" to "runs in sandbox, promotes diff on exit-0." Unlocks 3 more
   points.

4. **Audit trail per run** — every sandbox invocation is traceable. Before this: no record of
   what harness commands ran or what they changed. After: `sandbox_runs` + `agent_actions` give
   a complete forensic trail for any autonomous build session.

5. **Timeout enforcement** — runaway commands can't stall the harness loop indefinitely. The
   loop picks up the next task on timeout without Colin's intervention.

Concrete metric: track `sandbox_runs COUNT(*) WHERE status IN ('completed','failed') / 24h`.
A run that exits with `status='failed'` but `files_changed = []` is a zero-impact failure —
the harness self-recovered with no Colin-pause. That ratio is the 20% Better signal.
