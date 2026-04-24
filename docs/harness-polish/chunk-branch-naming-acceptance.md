# harness-polish chunk=branch-naming — Acceptance Doc

**Status:** awaiting-colin-approval  
**Written by:** coordinator (task 9038e0f7-55c6-46b7-9e09-db1fd3a10411)  
**Written at:** 2026-04-24  
**Sprint:** harness-polish (parallel track)  
**Chunk:** branch-naming  

---

## Scope

**One sentence:** Update `.claude/agents/builder.md` and `.claude/agents/coordinator.md` so that builder creates and pushes to a `harness/task-{task_id}` branch (where `task_id` comes from builder's INITIAL CONTEXT), and calls the deploy-gate trigger after pushing.

**One acceptance criterion:** The next autonomous build task results in a GitHub branch named `harness/task-{uuid}` (not `claude/vibrant-heisenberg-*`), and a `deploy_gate_triggered` row appears in `agent_events` with the correct `meta.branch` and `meta.task_id`.

---

## Out of scope

- Any change to the harness pickup cron, remote invocation component, or deploy gate code — those are already correct per their specs.
- Any change to `ARCHITECTURE.md`, `CLAUDE.md`, or `docs/colin-principles.md`.
- Any schema migration.
- Changing how the coordinator's own task branch is named (coordinator doesn't push code; only builder does).

---

## Problem statement (grounded)

The deploy gate spec (docs/harness-component-6-deploy-gate.md §1 and §9 Q1) explicitly decided: "Harness branches are named `harness/task-{task_id}`." The deploy gate's promotion logic merges `harness/task-{task_id}` into `main` via GitHub Merges API. The post-promotion branch cleanup deletes `harness/task-{task_id}`.

Current builder.md Step 7 says: "Push to the current branch." Claude Code's default session branch is `claude/vibrant-heisenberg-*` (or similar random name). This pattern is NOT a `harness/` branch and so the deploy gate's trigger logic and merge-to-main logic cannot activate automatically. Every autonomous chunk since deploy gate shipped has required a manual merge by Colin (confirmed in task text: "Without this fix, every autonomous chunk requires manual merge like Chunk C did").

---

## Check-Before-Build findings

| File | Current state | Action |
|---|---|---|
| `.claude/agents/builder.md` Step 7 | "Push to the current branch. Never force-push." — no branch creation, no harness naming, no deploy-gate trigger call | **Beef up** |
| `.claude/agents/coordinator.md` Phase 3 | "Hand the acceptance doc to the builder sub-agent." — no branch naming convention documented | **Beef up** (add one sentence) |
| `docs/harness-component-6-deploy-gate.md` §1, §9 Q1 | Branch naming `harness/task-{task_id}` DECIDED — authoritative spec | Reference only |
| `docs/harness-component-3-remote-invocation.md` | Remote invocation live since commit bebac8e; sessions receive `task_id` in INITIAL CONTEXT | Confirms task_id is available |

No prior-art branch-naming logic exists in either agent file. This is a net-new addition in both cases.

---

## Files expected to change

- `.claude/agents/builder.md` — Step 7 (Commit and deploy): add branch creation step, update push instruction, add deploy-gate trigger call
- `.claude/agents/coordinator.md` — Phase 3 (Delegate to builder): add one sentence documenting harness branch naming convention

No other files change. No migrations, no application code, no tests (these are agent instruction docs, not runtime code; the grounding checkpoint replaces tests).

---

## How task_id reaches builder

When Component #3 (remote invocation) spawns a builder Claude Code session via the Routines API, it passes the builder's `task_queue.id` as `task_id` in the session's INITIAL CONTEXT — identical to how coordinator sessions receive their task_id. Builder must parse `task_id` from its INITIAL CONTEXT the same way coordinator.md already does at the top of its invocation pattern.

`run_id` is also in INITIAL CONTEXT (same as coordinator). Both are needed for the deploy-gate trigger payload.

---

## Spec for builder.md changes

Builder.md Step 7 currently reads: "Only if steps 1–6 are clean: git add only files listed… Commit… Push to the current branch. Never force-push. Trigger deploy per CLAUDE.md procedure."

### Required additions to Step 7 (in order)

**Step 7a — Create harness branch (before git add):**

```bash
git checkout -b harness/task-{task_id}
```

Where `task_id` is parsed from INITIAL CONTEXT (same parsing pattern as coordinator.md). If a branch `harness/task-{task_id}` already exists (retry scenario), switch to it: `git checkout harness/task-{task_id}`.

**Step 7b — Commit and push to harness branch (replaces "push to current branch"):**

```bash
git push -u origin harness/task-{task_id}
```

Capture the pushed commit SHA for the trigger payload.

**Step 7c — Call deploy-gate trigger (after push, before writing handoff):**

```bash
curl -s -X POST https://lepios-one.vercel.app/api/harness/deploy-gate/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "task_id": "{task_id}",
    "branch": "harness/task-{task_id}",
    "commit_sha": "{pushed_commit_sha}",
    "run_id": "{run_id}",
    "tests_passed": true
  }'
```

Record the trigger response in the handoff report. If the trigger returns non-2xx, log it in `unknowns` and continue — do not block handoff on trigger failure (the deploy gate has its own failure handling).

**Step 7d — Update handoff with branch name:**

Add `"branch": "harness/task-{task_id}"` to the handoff JSON output (new field alongside existing fields). This lets coordinator verify the naming convention from the handoff report.

### Retry safety

If builder is retried on the same task_id (e.g., after a stale claim recovery), `harness/task-{task_id}` may already exist on the remote. Builder must detect this and push to the existing branch rather than failing with "branch already exists."

---

## Spec for coordinator.md changes

**Phase 3, step 1** — after the current text "Update docs/sprint-state.md with the active chunk id, acceptance doc path, and status = in-build", add:

> _Note: builder will create and push to `harness/task-{builder_task_id}` where builder_task_id is the builder's own task_queue UUID (from the builder task's INITIAL CONTEXT). This branch naming enables the deploy gate to auto-promote and Component #6 attribution to parse the task_id from the branch name without a separate lookup._

This is documentation only — no behavioral change to coordinator's workflow.

---

## Grounding checkpoint

**Physical-world artifact (Principle 14a):** After the changes ship and the next autonomous build task runs, Colin checks GitHub → Branches and confirms a branch named `harness/task-{uuid}` was created. Additionally, in Supabase Studio:

```sql
SELECT meta->>'branch' AS branch, meta->>'task_id' AS task_id, status, occurred_at
FROM agent_events
WHERE task_type = 'deploy_gate_triggered'
ORDER BY occurred_at DESC
LIMIT 3;
```

Expected: at least one row with `meta.branch = 'harness/task-{uuid}'` where the uuid matches the branch name on GitHub. If this passes, the fix is live and the autonomy gap is closed.

**DB fallback (Principle 14b):** If no autonomous build has run yet, Colin can manually invoke builder on a test task and verify the branch appears on GitHub before full autonomous cycle completes.

---

## Kill signals

- Branch naming does NOT change and sessions continue pushing to `claude/vibrant-heisenberg-*` → the acceptance doc's instruction was too vague or builder.md's Step 7 wasn't reached due to a prior step failing. Diagnose from the handoff report.
- Deploy-gate trigger call fails consistently → `CRON_SECRET` is not available in the builder session environment. This requires a separate harness fix (env var exposure), not a retry of this chunk.

---

## Escalation / cache-match status

**Cache-match: not applicable.** 

Phase 0 check: `last_reviewed_by_colin_at: 2026-04-22` in auto-proceed-log, which is the same date as harness-e2e sprint close. Ambiguous whether review post-dates the close. Conservatively: cache-match disabled. This acceptance doc escalates to Colin for explicit approval before builder executes.

Additionally: harness-polish sprint has no ratified plan in `sprint-state.md` or `ARCHITECTURE.md §7`. This is a parallel-track sprint (analogous to harness-e2e) seeded manually by Colin (task.source = 'manual'), which coordinator treats as implicit sprint authorization for this specific chunk. However, explicit Colin approval of this acceptance doc is still required before builder runs.

---

## Open questions

1. **Retry safety on push:** If `harness/task-{task_id}` already exists (task was retried after stale claim), should builder force-push the new work, or only push if no new commits conflict? Recommend: builder does `git push -u origin harness/task-{task_id}` normally — if the branch has diverged (meaning a prior builder invocation already pushed), this will fail and appear in `unknowns` for coordinator triage. Do not auto-force-push.

2. **Branch created at Step 7 vs earlier:** Currently spec has builder creating the harness branch at Step 7 (after all code is written). This means earlier code work happens on whatever branch the session started on. Is it preferable to create the harness branch at the very start of the session (before Step 1), so all work is in `harness/task-{task_id}` from the beginning? Recommend: start at Step 7 for minimal diff to builder.md — the session branch is a local detail until push, so timing doesn't affect the pushed result.

These are builder implementation questions; builder may resolve them autonomously unless Colin has a preference.

---

## Action for Colin

1. Review this acceptance doc.
2. If approved: create a new `task_queue` row for the builder with `task = "Apply harness-polish chunk-branch-naming changes per docs/harness-polish/chunk-branch-naming-acceptance.md"`, `metadata = {"sprint_id": "harness-polish", "chunk_id": "branch-naming", "acceptance_doc": "docs/harness-polish/chunk-branch-naming-acceptance.md", "prior_task_id": "9038e0f7-55c6-46b7-9e09-db1fd3a10411"}`, `priority = 2`.
3. If changes needed: insert a new coordinator task with updated instructions and `metadata.prior_task_id = "9038e0f7-55c6-46b7-9e09-db1fd3a10411"`.

---

## Cached-principle decisions (none)

Cache-match was conservatively disabled for this sprint. No decisions were cached. All decisions in this doc escalate to Colin for ratification.
