# SANDBOX_LAYER_SPEC

**Status:** DRAFT 1 (2026-04-28) — for review. Not yet approved. No migration written.
**Source of truth (when approved):** This doc.
**Authority (when approved):** Migration `0046_sandbox_layer_schema.sql` will be written from this doc.
**Parent spec:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) — `sandbox` is harness component #10 (T3, weight 7, currently 0%, target 60% per foundation spec §Priority).
**Sibling specs:** [`SECURITY_LAYER_SPEC.md`](SECURITY_LAYER_SPEC.md) (defines the boundary contract this spec consumes) · [`MEMORY_LAYER_SPEC.md`](MEMORY_LAYER_SPEC.md) (same doc style).

---

## At a glance

| Field                       | Proposed                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Component count change      | **0** (no new harness rows; sub-decomposes `sandbox` for re-scoring)                                                      |
| New tables                  | **1** — `sandbox_runs` (one row per `runInSandbox()` invocation, append-only)                                             |
| New endpoints               | **0** in slice 1 — `runInSandbox()` is in-process. Optional `POST /api/harness/sandbox-run` is slice 3+.                  |
| New libraries               | **2** — `lib/harness/sandbox/{runtime,fs-diff}.ts`                                                                        |
| Implementation primitive    | **Ephemeral git worktree** (`.claude/worktrees/sandbox-*`) for slice 1 — already in use for subagents. Docker = slice 3+. |
| Migration                   | **0046** — `sandbox_runs` + RLS + AD7-style GRANT lockdown                                                                |
| Honest target for `sandbox` | **0% → 60%** (matches foundation spec §Priority #3)                                                                       |
| Estimated effort            | **~2 days wall-clock** (matches foundation spec)                                                                          |
| Default posture             | **Default deny** outbound net/fs writes; allowlist via `SandboxScope`                                                     |
| Hard prerequisites          | `security_layer` slices 1, 2, 6 (audit table + capability registry + sandbox boundary contract)                           |
| Downstream unblocks         | `self_repair` (#12) and `push_bash_automation` (#13) — both hard-gated on sandbox per foundation spec                     |

---

## The problem

Foundation spec §`sandbox`:

> Isolated execution environment for risky work (untrusted scripts, schema migrations preview, exploratory shell). Lets agents run code that touches files/network/DB without risking the live workspace. Required before `self_repair` or `push_bash_automation` can act unsupervised.

**What's live today (verified 2026-04-28):**

- `.claude/worktrees/agent-a800bf88b82edc2b9/` and `agent-a9ac44c4b0970183e/` — ephemeral worktrees Claude Code already creates for subagent isolation. Full repo checkout per worktree, branch-scoped, GC'd by CC eventually.
- No unified `runInSandbox()` interface. Subagents use worktrees implicitly; nothing measures fs-diff, captures network calls, or enforces a timeout from the harness side.
- Security layer (slice 6) ships the boundary contract types: `SandboxScope`, `SandboxCheckRequest`, `checkSandboxAction()` in `lib/security/sandbox-contract.ts`. **Interface only — no implementation.** This spec is the implementation.

**What's missing (the four gaps):**

1. **Unified runtime** — no `runInSandbox(cmd, opts)` function. Every consumer (future `self_repair`, `push_bash_automation`) would otherwise reinvent the wrapper.
2. **fs-diff capture** — when sandbox finishes, agents need to know what files changed so they can promote a diff into a PR (the `self_repair` flow). No tool today computes "what did this run touch?" cheaply.
3. **Timeout + kill** — runaway scripts must be killable. CC's worktree primitive has no timeout.
4. **Audit trail** — every sandbox run must log to `sandbox_runs` (and `agent_actions` via the security layer) so escapes are detectable.

---

## Architecture decisions (five)

### AD1. Implementation primitive — **ephemeral git worktree for slice 1; revisit for Docker in slice 3**

Three candidates from foundation spec §`sandbox`:

| Primitive             | Pros                                                                         | Cons                                                                                                       | Verdict                                           |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Git worktree          | Already in use (`.claude/worktrees/*`); zero new infra; fs-diff = `git diff` | No process isolation (host shell); no net deny; relies on capability layer for boundaries                  | **Slice 1** — fastest to ship                     |
| Docker container      | Real process + net + fs isolation; mature                                    | Vercel runtime can't run Docker; only works on Colin's local machine + future GPU box; teardown cost ~2-5s | Slice 3+ when local tier is real                  |
| Vercel preview deploy | Real isolation for HTTP-shaped work; already wired                           | Only useful for "deploy this branch and see if it boots"; not for arbitrary shell                          | Already used by `deploy_gate` — out of scope here |

**Slice 1 commits to worktree.** It's not "real" sandboxing — it's a _workspace_ sandbox, not a _process_ sandbox. That's honest: an agent running inside a worktree can still `rm -rf /` the host. The capability layer (security_layer M2) is what stops that; sandbox just gives a clean working directory + diff capture.

The 60% target reflects this: workspace isolation + audit + timeout = a real product surface (good enough for `self_repair` PR drafting), but process-level isolation stays at 40% remaining for slice 3+.

### AD2. fs-diff = `git diff --stat` + `git diff --name-only` + per-file content hashes

Inside a worktree, `git status --porcelain` plus `git diff` already answers "what changed." We capture three artifacts per run:

- `files_changed: string[]` (paths, relative to worktree root)
- `diff_stat: { insertions, deletions, files }` (the `--stat` summary)
- `diff_hash: string` (sha256 of the unified diff text — for dedup + change-detection)

We do NOT store the full diff text in `sandbox_runs` (too large; can balloon). We store the hash + `files_changed`; the diff itself stays in the worktree until GC.

**Implication:** `runInSandbox()` returns these three fields; consumers can fetch the actual diff by re-entering the worktree before GC.

### AD3. Timeout + kill — `child_process.spawn` with `timeoutMs`, hard kill on overrun

Default 60s; max 300s. Runs `cmd` via `child_process.spawn(cmd, { cwd: worktreePath, timeout: opts.timeoutMs })`. On timeout, sends SIGTERM, waits 2s, then SIGKILL. Records `timed_out: true` in the run row.

**Open question (flagged below):** what if `cmd` spawns subprocesses that survive the parent kill? Likely answer: `detached: true` + kill the process group. Confirm before slice 1 (see §Slice 0).

### AD4. Audit log — every run writes to `sandbox_runs` AND emits a `sandbox.run.{started,completed,failed,timeout}` action to `agent_actions`

`sandbox_runs` is the operational table (what happened, what changed, exit code). `agent_actions` (security_layer) is the audit table (who, what capability, was it allowed, was there an escape attempt).

The two are linked by `sandbox_runs.audit_action_id REFERENCES agent_actions(id)`.

Per security spec AD7, `sandbox_runs` is also locked at the GRANT level: append-only for `service_role`; UPDATE/DELETE only via `postgres` (migrations).

### AD5. Sandbox identity — `sandboxId = '{agent_id}:{worktree_dir_name}'`, no separate registry

`SandboxScope` and `checkSandboxAction()` (security_layer M5) take a `sandboxId`. Rather than maintain a separate `sandbox_registry` table, we derive it from the worktree path.

- Pattern: `coordinator:sandbox-2026-04-28-abc123`
- Lifetime: same as the worktree (created on `runInSandbox()` start, retired on cleanup)
- Lookup: regex match against `sandbox_runs.sandbox_id`; no foreign key

**Why no registry table:** sandboxes are ephemeral by design. A registry would be a stale-data magnet and add a write per run for no audit value (we already have the run row).

**Pinning rule:** sandboxId is computed once at run insert and pinned to the row. Worktree rename post-creation does not affect audit lookups; the row's `sandbox_id` is the canonical reference. If a tool later renames `.claude/worktrees/sandbox-foo/` to `.claude/worktrees/sandbox-bar/`, the audit chain still resolves through `sandbox_runs.sandbox_id` — which never changes — and `worktree_path` is treated as a hint, not an identifier.

---

## Components (sub-systems within `sandbox` for re-scoring)

Mirrors the security_layer pattern (§Integration plan blended-completion table). The `sandbox` component row stays at weight 7 in `harness_components`; this internal weighting is for re-score honesty.

| Slug (internal)        | Weight inside sandbox | Today | Target slice 1 | Notes                                                                 |
| ---------------------- | --------------------- | ----- | -------------- | --------------------------------------------------------------------- |
| `runtime_worktree`     | 30%                   | 20%   | 100%           | `runInSandbox()` wrapping CC's worktree primitive + spawn + timeout   |
| `fs_diff_capture`      | 20%                   | 0%    | 100%           | `lib/harness/sandbox/fs-diff.ts` — git-diff-based                     |
| `audit_log`            | 20%                   | 0%    | 100%           | `sandbox_runs` table + `agent_actions` link                           |
| `boundary_check_wired` | 15%                   | 0%    | 100%           | `runInSandbox()` calls `checkSandboxAction()` before each side-effect |
| `process_isolation`    | 15%                   | 0%    | 0%             | Docker/firejail/etc. — slice 3+, kept at 0% for honest 60% landing    |

Math (slice 1 target): 0.30·1.00 + 0.20·1.00 + 0.20·1.00 + 0.15·1.00 + 0.15·0 = 0.30 + 0.20 + 0.20 + 0.15 + 0 = **0.85 = 85%**

…which would overshoot the 60% target. **Honest correction:** slice 1 ships `runtime_worktree` + `fs_diff_capture` + `audit_log` only (65%). `boundary_check_wired` requires security_layer slice 6 to be live first; do it in slice 2 of _this_ spec (lifts to 80%). `process_isolation` stays for slice 3+. **Slice 1 lands at ~50%**, slice 2 lands at ~65%. The 60% target is hit between them.

These slug names DO NOT land as new rows in `harness_components`. They live in this spec for re-score traceability only. The sandbox row stays atomic.

---

## M1. `lib/harness/sandbox/runtime.ts` — `runInSandbox()`

**Interface (locked from foundation spec §`sandbox`):**

```typescript
export interface SandboxRunOptions {
  agentId: string // who is asking
  capability: string // what they think they're doing (passed to checkSandboxAction)
  scope: SandboxScope // from lib/security/sandbox-contract.ts
  timeoutMs?: number // default 60_000, max 300_000
  cwd?: string // optional sub-path within worktree
  env?: Record<string, string> // additional env (merged over a clean baseline)
  reason?: string // free-form; recorded in audit
}

export interface SandboxRunResult {
  sandboxId: string
  worktreePath: string // for caller to inspect before GC
  exitCode: number | null // null if killed
  stdout: string // captured, capped at 256KB
  stderr: string // captured, capped at 256KB
  timedOut: boolean
  durationMs: number
  filesChanged: string[] // relative paths
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string // sha256 of unified diff
  runId: string // sandbox_runs.id
  warnings: string[] // non-fatal contract gaps surfaced to caller (see below)
}

export async function runInSandbox(
  cmd: string | string[],
  opts: SandboxRunOptions
): Promise<SandboxRunResult>
```

**`warnings` semantics:**

`warnings` is the channel for non-fatal contract gaps the runtime cannot honor in the current slice. It does NOT block the run; it tells the caller "the scope you asked for is partially advisory." Slice-1 known warnings:

- `'net_isolation_not_enforced'` — emitted whenever `scope.net` is non-empty (any `allowedHosts` or `deniedHosts` declared). The worktree primitive cannot block outbound HTTP; the warning makes the gap visible to callers (especially `self_repair`) so they can decide whether to proceed. See §Open question 2.
- `'process_isolation_not_enforced'` — emitted on every run in slice 1 (worktree-only; no Docker). Constant signal until slice 3 lands.
- `'fs_isolation_advisory'` — emitted whenever `scope.fs.deniedPaths` is non-empty. The worktree restricts fs writes to the worktree subtree but cannot enforce a fine-grained deny-list within it.

Callers MUST be allowed to assert `warnings.length === 0` and refuse to act on the result if they need real isolation. Slice 1 acceptance row I locks the contract for `net_isolation_not_enforced`.

**Lifecycle:**

1. Resolve worktree path (create new under `.claude/worktrees/sandbox-{ulid}/`).
2. Compute `sandboxId = '{agentId}:{worktree_dir_name}'`. Pinned to the row at insert per AD5.
3. Insert `sandbox_runs` row, status='running', `started_at=now()`.
4. Call `checkSandboxAction({ agentId, sandboxId, capability, scope })` — if denied, mark row `denied`, throw.
5. Spawn `cmd` with `cwd=worktreePath`, `timeout=opts.timeoutMs`, `detached: true`, clean env merged with `opts.env`.
6. On exit / timeout: capture stdout/stderr (truncate at 256KB), compute fs-diff via M2, populate `warnings` per scope inspection, update row.
7. Return `SandboxRunResult`. Do NOT delete worktree — caller decides (typical: `self_repair` reads diff, opens PR, then calls `cleanupSandbox(runId)`).

**Cleanup:** separate `cleanupSandbox(runId)` removes the worktree, marks row `cleaned_at=now()`. Background GC removes orphans older than 24h.

---

## M2. `lib/harness/sandbox/fs-diff.ts`

```typescript
export async function captureFsDiff(worktreePath: string): Promise<{
  filesChanged: string[]
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string
}>
```

Implementation: shells out (in the worktree) to `git diff --name-only HEAD`, `git diff --stat HEAD`, `git diff HEAD | sha256sum`. Untracked files (`git ls-files --others --exclude-standard`) added to `filesChanged` separately and folded into the hash.

**Edge:** if the sandbox `cmd` ran `git commit` itself, the diff vs HEAD is empty. Handle: also diff against the worktree's _base_ SHA recorded at creation time (`sandbox_runs.base_sha`).

---

## M3. `sandbox_runs` table

```sql
CREATE TABLE public.sandbox_runs (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id        TEXT         NOT NULL,                 -- '{agentId}:{worktree_dir_name}'
  agent_id          TEXT         NOT NULL,
  capability        TEXT         NOT NULL,                 -- what was requested
  scope             JSONB        NOT NULL,                 -- snapshot of SandboxScope at start

  -- Lifecycle
  status            TEXT         NOT NULL CHECK (status IN ('running','completed','failed','denied','timeout','cleaned')),
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  cleaned_at        TIMESTAMPTZ,
  duration_ms       INTEGER,

  -- Worktree
  worktree_path     TEXT         NOT NULL,                 -- absolute path on host (hint, not identifier — see AD5)
  base_sha          TEXT         NOT NULL,                 -- HEAD of worktree at creation
  cmd               TEXT         NOT NULL,
  cwd               TEXT,

  -- Outputs
  exit_code         INTEGER,                               -- null if killed/denied
  timed_out         BOOLEAN      NOT NULL DEFAULT false,
  stdout_truncated  TEXT,                                  -- capped at 256KB
  stderr_truncated  TEXT,
  files_changed     TEXT[]       NOT NULL DEFAULT '{}',
  diff_stat         JSONB,                                 -- {insertions, deletions, files}
  diff_hash         TEXT,                                  -- sha256 of unified diff
  warnings          TEXT[]       NOT NULL DEFAULT '{}',    -- mirror of SandboxRunResult.warnings

  -- Audit link
  audit_action_id   UUID         REFERENCES public.agent_actions(id) ON DELETE NO ACTION,

  -- Free-form
  reason            TEXT
);

CREATE INDEX idx_sandbox_runs_agent_started ON public.sandbox_runs(agent_id, started_at DESC);
CREATE INDEX idx_sandbox_runs_status        ON public.sandbox_runs(status) WHERE status IN ('running','denied','timeout');

ALTER TABLE public.sandbox_runs ENABLE ROW LEVEL SECURITY;
-- RLS: append + select for service_role; AD7 GRANT lockdown blocks UPDATE/DELETE except for postgres.
```

**AD7 carry-over (per security spec):**

```sql
REVOKE UPDATE, DELETE ON public.sandbox_runs FROM service_role, authenticated, anon;
GRANT INSERT, SELECT ON public.sandbox_runs TO service_role;
-- The 'cleaned_at' tracking column is the one exception; allow column-level UPDATE so cleanupSandbox() works.
GRANT UPDATE (cleaned_at, status) ON public.sandbox_runs TO service_role;
```

---

## Slice 0 — Vercel POSIX surface spike (~½ day, blocks Slice 1 acceptance D)

Slice 1 acceptance D (timeout enforcement + process-group kill) is only meaningful if the host runtime supports `spawn(detached: true)` + `process.kill(-pid, signal)`. AD3 assumes this works; Open Question 1 flags Vercel's Node runtime as the unknown. Slice 0 closes that question before any slice 1 code is written.

**Spike scope (5 lines of intent, written here verbatim so a builder can lift them):**

1. Deploy a tiny Vercel preview route `app/api/_spike/proc-group-kill/route.ts` that does: `const child = spawn('sh', ['-c','sleep 30 & sleep 30 & wait'], { detached: true })`.
2. Wait 500ms, then `process.kill(-child.pid!, 'SIGTERM')` and 2s later `'SIGKILL'`.
3. After kill, run `ps -ef | grep sleep` (or equivalent on Vercel's runtime) and capture the output.
4. Return `{ killSucceeded: boolean, residualProcs: string[], runtime: process.versions, posixCallsAvailable: { setpgid: typeof process.kill === 'function' && /* check / } }`.
5. Hit the route from local; record the response in `docs/harness/sandbox-spike-2026-04-28.md` as the spike artifact.

**Pass condition:** `killSucceeded === true` AND `residualProcs` is empty. Means AD3 stands, slice 1 acceptance D is implementable on Vercel.

**Fail condition (either):** kill returns ENOSYS / EPERM, OR residual sleep procs survive. Means AD3 is wrong on Vercel runtime. Two redirect paths:

- **R-A:** sandbox runtime is local-only (Colin's machine + future GPU box). Vercel functions never call `runInSandbox()`. `self_repair` and `push_bash_automation` become local-only too. Document as a constraint; foundation-spec target stays 60% but "Vercel-side sandboxing" moves to permanent out-of-scope.
- **R-B:** introduce a minimum-viable wrapper: `cmd` is wrapped in `timeout(1) <opts.timeoutMs/1000>s sh -c "<cmd>"` so the OS does the killing. Tradeoff: GNU `timeout` may not be on Vercel's image; needs verification in the same spike.

**Decision gate:** Slice 1 cannot start until the spike artifact exists and Colin signs off the chosen path (AD3 stands, R-A, or R-B). Spike output is a single doc + the route file (which gets removed before slice 1 PR opens — it's spike-only).

**Spike acceptance (3 boxes):**

- [ ] Spike route deployed to a Vercel preview; URL recorded.
- [ ] Spike artifact `docs/harness/sandbox-spike-2026-04-28.md` written with: full response JSON, runtime info, decision recommendation (AD3 / R-A / R-B), Colin sign-off line.
- [ ] Spike route removed (or behind `if (process.env.SPIKE_ENABLED !== '1') return 410`) before slice 1 PR opens.

---

## Slice 1 acceptance criteria — smallest E2E path

**Goal:** prove `runInSandbox()` end-to-end on a trivial command, with audit trail and fs-diff. No `self_repair` integration yet; no Docker; no HTTP endpoint.

**Precondition:** Slice 0 complete and signed off.

### A. Schema lands

- [ ] Migration 0046 applies on prod. `list_tables` returns `sandbox_runs`.
- [ ] `SUM(weight_pct) FROM harness_components = 100` (unchanged — no new rows).
- [ ] AD7 GRANT lockdown holds: `INSERT INTO sandbox_runs … FROM service_role` succeeds; `DELETE FROM sandbox_runs` from service_role returns `permission denied`. Asserted in `tests/sandbox/ad7-runtime.test.ts` (mirrors security spec slice 1 pattern).

### B. `runInSandbox()` round-trip on a no-op command

- [ ] `runInSandbox('echo hello', { agentId:'test', capability:'shell.run', scope:{ fs:{allowedPaths:['.']} } })` returns:
  - `exitCode === 0`, `stdout === 'hello\n'`, `timedOut === false`
  - `filesChanged === []`, `diffStat.files === 0`
  - `runId` is a UUID; one row in `sandbox_runs` with `status='completed'`
  - `worktreePath` exists on disk and contains a git checkout

### C. fs-diff captures a real change

- [ ] `runInSandbox('echo modified > test.txt', { ... })` returns:
  - `filesChanged === ['test.txt']`, `diffStat.insertions === 1`, `diffStat.files === 1`
  - `diff_hash` is non-empty and stable across two runs of the same command

### D. Timeout enforcement

- [ ] `runInSandbox('sleep 10', { ..., timeoutMs: 1000 })` returns within ~1.5s:
  - `timedOut === true`, `exitCode === null`, row `status='timeout'`
- [ ] Sub-process group is killed: `pgrep -f 'sleep 10'` returns nothing after timeout.
- [ ] On Vercel runtime: behavior matches whichever path Slice 0 selected (AD3 / R-A / R-B). If R-A, this acceptance is asserted only on local runs and the test is skipped on Vercel with a `it.skipIf(isVercel)` guard.

### E. Capability check fires (with security_layer at slice 6 live)

- [ ] When `checkSandboxAction()` returns `{ allowed: false, reason: 'sandbox_required' }`, `runInSandbox()` throws `SandboxDeniedError`, row `status='denied'`, no command runs, no worktree created (or created and immediately torn down — implementation choice; document which).
- [ ] An `agent_actions` row exists with `action_type='sandbox_check'`, `result='denied'`, linked from `sandbox_runs.audit_action_id`.

### F. Cleanup

- [ ] `cleanupSandbox(runId)` removes `worktreePath` from disk, sets `cleaned_at` and `status='cleaned'`.
- [ ] Background GC sweeper (out of slice 1 scope but tested for existence): cron exists, query for orphans returns expected shape.

### G. F18 surfacing — morning_digest line

- [ ] New digest line: `Sandbox (24h): N runs, M denies, K timeouts, J escapes`.
- [ ] If `escapes > 0` (any `sandbox_escape_detected` action in agent_actions), fire alerts bot.

### H. Rollup honesty

- [ ] After 0046 + slice 1: `harness_components.completion_pct` for `sandbox` updated 0 → 50 (not 60 — slice 2 lifts it the rest of the way; honest landing).
- [ ] morning_digest reflects the bump and notes "slice 1 of 2."

### I. Warnings surface

- [ ] When `scope.net` is non-empty (any value in `allowedHosts` or `deniedHosts`), `result.warnings` includes `'net_isolation_not_enforced'`. Asserted by one unit test in `tests/sandbox/runtime.warnings.test.ts`:

  ```typescript
  it('emits net_isolation_not_enforced when scope.net is non-empty', async () => {
    const r = await runInSandbox('true', {
      agentId: 'test',
      capability: 'shell.run',
      scope: { fs: { allowedPaths: ['.'] }, net: { allowedHosts: ['example.com'] } },
    })
    expect(r.warnings).toContain('net_isolation_not_enforced')
  })
  ```

- [ ] When `scope.net` is undefined or `{}`, `result.warnings` does NOT include `'net_isolation_not_enforced'` (negative case in the same test file).
- [ ] Mirrored to the row: `sandbox_runs.warnings` array contains the same strings as `result.warnings`.

---

## Open questions — flag, do not guess

These need a Colin call (or a redline) before slice 1 starts. Each one is a fork in the spec.

1. **Process-group kill on timeout.** Confirmed approach is `spawn(detached: true)` + `process.kill(-pid, 'SIGTERM')`. Need to verify on Vercel's Node runtime — Vercel functions run with limited POSIX surface. **Closed by Slice 0 spike** (output drives AD3 / R-A / R-B selection).

2. **Network sandboxing.** `SandboxScope.net` is in the contract but the worktree primitive does NOT enforce it — agents can curl anything. **Q: do we ship slice 1 with net deny _not_ enforced (logged-only via security_layer audit), or block slice 1 until we have an HTTP wrapper?** Recommendation: log-only in slice 1; explicit warning in `SandboxRunResult.warnings: ['net_isolation_not_enforced']` (locked by acceptance I).

3. **Worktree base sha vs main HEAD.** When `runInSandbox()` creates a worktree, base sha = current branch HEAD or main HEAD? Affects what `self_repair` sees as "changed" vs what's actually staged on the feature branch. **Q: which is correct for the `self_repair` flow?** Recommendation: caller passes `baseRef?: string`, defaults to current branch HEAD.

4. **Stdout/stderr truncation policy.** 256KB is enough for most cases; some test runs (e.g. `npm test` verbose) blow past it. **Q: do we cap silently or stream the overflow to a file in the worktree and store the path?** Recommendation: cap silently for slice 1; add file-overflow in slice 2.

5. **Concurrent sandbox limit.** Worktrees are cheap but not free (disk + git index time). **Q: cap at N concurrent runs per agent? per host?** Recommendation: soft cap of 4 concurrent per agent in slice 1; hard cap of 16 host-wide. Surface in `agent_capabilities` as a per-agent grant (`sandbox.run.concurrent:4`)?

6. **`process_isolation` slice 3 primitive.** Docker is the obvious answer for local (Colin's machine + future GPU box). **Q: are we OK with sandbox being workspace-isolated only on Vercel forever?** This is a design call, not a slice 1 blocker — but it shapes the long-run honesty of the % score.

7. **GC policy for orphan worktrees.** When a sandbox run row says `status='completed'` but `cleaned_at IS NULL` after 24h, the worktree is orphaned. **Q: hard-delete via cron, or require explicit cleanup with alerts on aging orphans?** Recommendation: cron sweep at 24h; alert if >10 orphans backlog.

---

## Dependencies on other components

### Hard prerequisites (sandbox cannot ship without these)

| Component                | What sandbox needs                                                      | Status today                    | Slice gate              |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------- | ----------------------- |
| `security_layer` slice 1 | `agent_actions` table + `lib/security/audit.ts` insert helper           | ⬜ (in priority queue)          | Sandbox slice 1 blocked |
| `security_layer` slice 2 | `capability_registry` + `agent_capabilities` + `sandbox.run` capability | ⬜                              | Sandbox slice 1 blocked |
| `security_layer` slice 6 | `lib/security/sandbox-contract.ts` types + `checkSandboxAction()`       | ⬜ (typed in security spec §M5) | Sandbox slice 1 blocked |

**Operational consequence:** sandbox spec can be drafted and reviewed now (this doc) but the build slot for sandbox slice 1 must wait for security_layer slices 1, 2, 6 to land. Per foundation spec §Priority, security_layer is #1 in parallel with digital_twin; sandbox is #3 sequential. This ordering holds.

### Soft dependencies (sandbox works without these but they improve the surface)

| Component       | What it adds                                                          | Defer to                   |
| --------------- | --------------------------------------------------------------------- | -------------------------- |
| `arms_legs`     | Calls `runInSandbox()` from a unified action layer rather than ad-hoc | After arms_legs slice 1    |
| `f18_surfacing` | Already shipped — add the new digest line per acceptance G            | Same PR as sandbox slice 1 |

### Downstream consumers (these are blocked on sandbox)

| Component                    | What it needs from sandbox                                     | Foundation spec note                                                              |
| ---------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `self_repair` (#12)          | `runInSandbox()` to verify drafted fix before opening PR       | "Hard-gated on (3) and full security_layer." (3 = sandbox)                        |
| `push_bash_automation` (#13) | `runInSandbox()` for the `auto`-tier shell allowlist execution | "Hard dependency on `sandbox` and `security_layer` before any 'auto' path ships." |

These two components are at 0% in the foundation spec specifically because sandbox is at 0%. Shipping sandbox slice 1+2 unblocks them.

---

## Out of scope (named for the avoidance of doubt)

- **Docker / firejail / nsjail process isolation** — slice 3+, gated on local-execution tier landing (Colin's machine + GPU box). Worktree-only for slice 1 is the honest position.
- **`runInSandbox()` over HTTP** (`POST /api/harness/sandbox-run`) — slice 3+, gated on chat_ui needing it. In-process call only for slice 1.
- **`self_repair` and `push_bash_automation` implementations** — separate spec docs each. Sandbox provides the runtime; they provide the policy.
- **Network firewall enforcement** — `SandboxScope.net` is logged-only in slice 1. Real enforcement requires either an HTTP-wrapping shim in `arms_legs` or OS-level firewalling (slice 3+).
- **Sandbox-specific secrets vault** — secrets follow security_layer's `secrets.get(name, agentId, { sandboxId })` path; sandbox does not introduce a parallel secret store.
- **Cross-machine sandbox (run on GPU box from Vercel)** — gated on the future remote-execution layer; not a v1 concern.
- **CC's worktree GC interplay** — Claude Code may GC its own `.claude/worktrees/agent-*` dirs on its own schedule; our sandbox uses a `sandbox-*` prefix to avoid collision. Document the prefix; no code-level coordination with CC.

---

## Integration plan with `HARNESS_FOUNDATION_SPEC.md`

Two follow-on edits to the foundation spec, applied at the same time as 0046's UPDATE step (acceptance H):

1. Replace the "Files: none. `.claude/worktrees/` shows the worktree primitive…" line in §`sandbox` with a pointer to this doc and the new module paths.
2. Update `sandbox` completion 0 → 50 (slice 1) or 0 → 65 (slice 2). Update T3 total (currently `12.1` post-MEM-spec re-score, plus today's twin → 62% rescore = 10.72; slice 1 lifts it by 7 × 0.50 = 3.5 → 14.22; slice 2 by 7 × 0.65 = 4.55 → 15.27). Update overall rollup accordingly.
3. In §Priority, replace `sandbox (0 → 60%)` with a slice 1 + slice 2 split and link to this doc's §"Slice 1 acceptance criteria."

No other foundation-spec edits.

---

## Risks called out for redline

- **R1.** Worktree creation cost. Each `runInSandbox()` does a fresh `git worktree add`. On a 50MB repo, this is ~500ms-2s. Mitigation: pool of pre-warmed worktrees; only spin a fresh one when pool empty. Not in slice 1; surface as slice 2 follow-on if real.
- **R2.** Worktree GC racing with active runs. CC may decide to GC `.claude/worktrees/sandbox-*` while a run is active. Mitigation: prefix is owned by us, not CC; document; add a `.lock` sentinel file CC respects (verify CC honors this).
- **R3.** Capability check latency on the hot path. `checkSandboxAction()` is a DB call; `runInSandbox()` may be called many times for fast commands. Mitigation: in-process cache of agent_capabilities (security spec R1).
- **R4.** Stdout buffer fills for chatty commands and process hangs. `child_process.spawn` with default options may deadlock when the OS pipe buffer fills. Mitigation: use `{ stdio: ['ignore','pipe','pipe'] }` and stream-consume both pipes; never `await` exit before draining.
- **R5.** Migration 0046 lands before security_layer 0045's `agent_actions` table exists → FK constraint on `audit_action_id` fails. Mitigation: 0046 explicit dependency note; CI lint rule blocks if 0045 not present.
- **R6.** `git diff --stat` parsing is locale-sensitive. Mitigation: invoke with `LANG=C` env override; assert in tests.

---

## Working agreement reminders (per kickoff)

- Specs first, code second.
- No padding. Honest numbers — sandbox lands at 50% in slice 1, 65% in slice 2. Process isolation stays at 0% until Docker tier is real. The `process_isolation` sub-system at 15% weight is what keeps the headline number honest.
- Acceptance tests written before building (§Slice 1 acceptance criteria, above).
- Doc-as-source: this file is authoritative once approved; migration 0046 follows it.
- Read existing files before drafting anything new — done; sources cited inline (foundation spec §`sandbox`, security spec §M5 + AD7).
- **This window is SCOPE ONLY. No migrations, no code, no commits beyond this spec doc.**
