# Autonomous Harness — Component #6: Deploy Gate

**Status:** Design — pending Colin review
**Author:** Colin + Claude, 2026-04-21
**Scope:** Automated gate that evaluates a Vercel preview deployment before promoting it to production, with a Telegram human-override window post-promotion
**Sequencing:** After component #2 (Telegram thumbs) is stable. Depends on: component #5 (task pickup), Vercel preview workflow, existing smoke test infrastructure.

---

## 1. Trigger

**What starts the gate?**

Claude Code, after completing a task and pushing a branch, calls a LepiOS API endpoint directly:

```
POST /api/harness/deploy-gate/trigger
Authorization: Bearer <CRON_SECRET>
{
  "task_id": "<uuid>",
  "branch": "feat/sprint-4-chunk-a",
  "commit_sha": "abc1234",
  "run_id": "<uuid>"
}
```

This is explicit and synchronous with the task execution flow. Claude Code knows when it has pushed; no external event detection needed.

**Why not task_queue `completed` event?**
Task completion is downstream of the push. The gate should run before completion is confirmed — completion is the gate's *output*, not its trigger. Completion is written to task_queue only after the gate either promotes (success) or gives up (failure).

**Prerequisite: branch-based workflow**
The current setup pushes directly to `main`, which Vercel auto-deploys to production. The gate requires a change: Claude Code pushes to a feature branch instead. Main stays protected. Gate promotes a preview to production after passing checks.

This is the biggest workflow change implied by the gate. See §9 — Open Questions.

---

## 2. Preview Deploy

**How we get the preview URL programmatically:**

**Recommended: Vercel deployment webhook (event-driven)**

1. Configure a Vercel project webhook (Vercel Dashboard → Settings → Webhooks) to `POST` to `https://lepios-one.vercel.app/api/harness/deploy-gate/webhook` on the `deployment.ready` event.
2. Webhook payload includes `deployment.url` (the preview URL) and `deployment.meta.githubCommitRef` (branch name) and `deployment.meta.githubCommitSha`.
3. The gate webhook handler matches the incoming commit SHA to the pending gate row in `agent_events` (written at trigger time) and kicks off gate checks.

**Fallback: Vercel API polling (in trigger handler)**

If webhook setup is deferred:
```
GET https://api.vercel.com/v13/deployments
  ?projectId=<VERCEL_PROJECT_ID>
  &meta-githubCommitSha=<commit_sha>
  &limit=1
Authorization: Bearer <VERCEL_TOKEN>
```
Poll every 10s, up to 120s. If `readyState === 'READY'`, extract `url`. If timeout → gate fails.

Polling works but ties up a long-running serverless invocation. The webhook approach is cleaner and scales better.

**New env vars needed:**
- `VERCEL_TOKEN` — personal access token for Vercel API calls
- `VERCEL_PROJECT_ID` — lepios project ID (already in Vercel, needs exposure to runtime)

---

## 3. Gate Checks

Checks run in order. First failure blocks promotion.

### 3.1 Build success (pre-condition, not a check)
If the Vercel preview build failed, there is no `deployment.ready` event and no preview URL. The gate never starts. The trigger handler should poll briefly and alert Telegram on build failure.

### 3.2 Tests pass
**Problem:** `npm test` can't run inside a serverless function.

**Options:**
- **A (recommended for now):** Claude Code runs `npm test` locally before calling the trigger endpoint. If tests fail, it does not push and does not call the trigger. The trigger payload includes `"tests_passed": true` and the gate trusts it (logs it, does not re-run). This matches the current harness pattern — Claude Code is the executor.
- **B (future):** GitHub Actions CI runs on push. Gate queries GitHub Checks API for the commit SHA and waits for CI green. Requires `GITHUB_TOKEN` and a CI workflow. Not currently in place.
- **C (rejected):** Run tests in a Vercel function. Too slow (10s+ for vitest), exceeds function timeout.

v0: Option A. Claude Code is responsible for tests; the gate logs the claim.

### 3.3 Smoke test
Hit a known endpoint on the preview URL and assert 200:

```
GET https://<preview-url>/api/health
```

The `/api/health` route already exists. Assert `res.ok && body.ok === true`.

This catches: build succeeded but runtime crashes on cold start, missing env vars in preview, Supabase connection failures in preview environment.

**Preview env vars:** Vercel preview deployments use the `Preview` environment variable set. Confirm `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, etc. are scoped to Preview (they currently are — seen in `vercel env ls`).

### 3.4 Schema check (if migrations changed)
**This is the hard one.**

**The problem:** There is one shared Supabase instance. Migrations applied to production are applied globally. There is no per-branch Supabase database today.

**Options (in order of increasing correctness):**

**A — Skip (v0 default):** Migrations require explicit Colin approval outside the gate. Gate detects if any `supabase/migrations/*.sql` files changed in the commit diff (via GitHub API or git diff), and if so, blocks promotion and sends a Telegram alert: "Migration detected — apply manually before promoting." Colin applies via Supabase MCP, then manually promotes.

**B — Dry-run validation:** Parse the migration SQL for dangerous patterns (DROP TABLE, TRUNCATE, DROP COLUMN, removing NOT NULL constraints). If any detected → block. If clean → allow (but don't apply). Migration still applies manually post-promotion. This catches the most common footguns without needing a second database.

**C — Supabase branching (v1):** Supabase's branching feature provisions a per-branch database. Apply migration to the branch database, run the smoke test against it, verify schema applies cleanly. Requires Supabase Pro plan and `supabase branch create` integration. Correct but operationally heavy.

**Recommendation:** v0 = Option A (block + alert on migration detection). v1 = Option B (dry-run SQL analysis). Option C if the schema complexity grows to justify it.

---

## 4. Promotion

**How preview becomes production:**

Use the Vercel Promote API:

```
POST https://api.vercel.com/v10/projects/<projectId>/promote/<deploymentId>
Authorization: Bearer <VERCEL_TOKEN>
```

This promotes the preview deployment to the production alias (`lepios-one.vercel.app`) without a new build. It is instantaneous and reversible.

**Deployment ID** is obtained from the `deployment.ready` webhook payload or the polling response.

**No merge to main required.** Promotion is an alias swap at the CDN level. The branch commit never needs to land on `main` for deployment purposes. Whether to merge to main after promotion is a separate, lower-urgency step (audit trail / git history). Colin decides.

---

## 5. Rollback

**If post-promotion smoke fails or Colin taps 👎:**

1. Query Vercel API for the previous production deployment:
   ```
   GET https://api.vercel.com/v13/deployments
     ?projectId=<VERCEL_PROJECT_ID>
     &target=production
     &limit=5
   ```
   Find the most recent deployment with `readyState === 'READY'` that is NOT the current one.

2. Promote that deployment:
   ```
   POST https://api.vercel.com/v10/projects/<projectId>/promote/<previousDeploymentId>
   ```

This rolls back the production alias to the previous build in seconds. No git revert, no re-build.

**Code revert (separate concern):** Vercel rollback reverts the running code but not the git branch state. If the branch was merged to main before rollback, a `git revert` commit is still needed for history hygiene. For v0 (no merge-to-main requirement), this is a non-issue — the branch just doesn't get merged.

**Migration rollback:** If a migration was applied as part of the promotion and rollback is triggered, the migration is NOT automatically reversed (Supabase has no rollback transaction). The gate must check: was a migration applied during this deploy? If yes, alert Colin separately — schema rollback is always manual.

---

## 6. Human Override

**Telegram message sent after successful promotion:**

```
✅ Promoted to production
Commit: abc1234 (feat/sprint-4-chunk-a)
Smoke: pass | Tests: claimed pass | Build: pass

👍 Keep  👎 Roll back
```

Buttons use the existing `telegram-buttons.ts` infrastructure with a new callback prefix (e.g., `dg:keep:<gate_event_id>` and `dg:rb:<gate_event_id>`).

**Timeout behavior:**
- Window: **10 minutes** (from promotion timestamp)
- Default on timeout: **KEEP** — optimistic, avoids auto-rollback on missed notifications
- Rationale: promotion already happened, smoke test passed. Defaulting to rollback on silence would cause unnecessary churn. Colin can always rollback manually if he sees something wrong.
- Timeout enforcement: a Vercel cron (`/api/cron/deploy-gate-timeout`) running every 5 minutes checks for overrides older than 10 minutes with no response, logs `deploy_gate_override_timeout`, marks resolved.

**After 👎:**
1. Rollback via Vercel Promote API (§5)
2. Edit Telegram message: "↩️ Rolled back to previous production at HH:MM MT"
3. Write `deploy_gate_override_rolled_back` to `agent_events`
4. Alert if migration was applied (see §5)

**After 👍:**
1. Edit Telegram message: "✅ Kept — confirmed at HH:MM MT"
2. Write `deploy_gate_override_kept` to `agent_events`

---

## 7. Failure Modes

| Scenario | Behavior |
|---|---|
| Gate trigger called but preview build fails | Poll Vercel for up to 2 min; if no `READY` state → send Telegram alert, mark gate failed, task stays claimed |
| Smoke test fails on preview | Block promotion, send Telegram alert with preview URL for manual inspection |
| Migration detected (v0 behavior) | Block promotion, send Telegram alert asking for manual migration + manual promote |
| Vercel API down | Polling/webhook timeout → gate fails → Telegram alert. Do not promote. |
| Vercel Promote API call fails | Send Telegram alert, write `deploy_gate_failed` row. Previous production remains active. |
| Post-promotion smoke fails | Trigger rollback automatically (don't wait for human override). Alert Telegram separately. |
| Gate handler itself crashes (unhandled exception) | `try/catch` at top level → write `deploy_gate_failed` to `agent_events`, send Telegram alert. Never silently drop. |
| Human override webhook receives 👎 but rollback fails | Log `deploy_gate_rollback_failed`, alert Telegram with manual rollback instructions. |
| Timeout cron missed (Vercel cron skipped) | Override row stays `pending` indefinitely — benign (production is fine). Next cron run resolves it. |
| Tests claimed passed but were actually skipped | Gate cannot detect this in v0. Mitigation: Claude Code must run full `npm test`, not a subset. |

---

## 8. agent_events Schema

All gate events use `domain: 'orchestrator'`, `actor: 'deploy_gate'`. The `meta` field carries context for each step.

| task_type | status values | output_summary pattern | key meta fields |
|---|---|---|---|
| `deploy_gate_triggered` | `success` | `gate triggered for commit abc1234` | `task_id`, `branch`, `commit_sha`, `run_id` |
| `deploy_gate_preview_ready` | `success` \| `error` | `preview ready at <url>` or `timeout waiting for preview` | `preview_url`, `deployment_id`, `elapsed_ms` |
| `deploy_gate_tests_claimed` | `success` \| `warning` | `tests claimed pass by Claude Code` | `claimed_by: 'claude_code'`, `commit_sha` |
| `deploy_gate_smoke_preview` | `success` \| `error` | `smoke pass on <url>` or `smoke fail: <status>` | `preview_url`, `status_code`, `response_ms` |
| `deploy_gate_schema_check` | `success` \| `warning` \| `error` | `no migrations` or `migration detected — blocked` | `migration_files`, `dangerous_patterns` |
| `deploy_gate_promoted` | `success` \| `error` | `promoted <deployment_id> to production` | `deployment_id`, `previous_deployment_id` |
| `deploy_gate_smoke_production` | `success` \| `error` | `post-promotion smoke pass` or `fail` | `status_code`, `response_ms` |
| `deploy_gate_override_sent` | `success` | `Telegram override message sent` | `message_id`, `chat_id`, `timeout_at` |
| `deploy_gate_override_kept` | `success` | `human confirmed keep at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_rolled_back` | `success` | `human requested rollback at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_timeout` | `warning` | `no override response in 10min — defaulting to keep` | `timeout_minutes: 10` |
| `deploy_gate_rolled_back` | `success` \| `error` | `rolled back to <deployment_id>` | `from_deployment_id`, `to_deployment_id` |
| `deploy_gate_failed` | `error` | `gate failed: <reason>` | `error`, `stage_failed_at` |

---

## 9. Open Questions

**Q1 — Branch strategy (blocking decision)**
The gate requires Claude Code to push to feature branches, not `main`. This is a meaningful workflow change. Current habit: `git commit && git push origin main`. New habit: `git checkout -b feat/<task-id> && push && call trigger`. How disruptive is this in practice? Does Claude Code need a wrapper script that handles branch creation and cleanup?

**Q2 — Who runs tests?**
v0 puts test responsibility on Claude Code (claims pass, gate trusts it). Is that acceptable? If a Claude Code session runs a subset of tests to save time, the gate has no way to know. Consider: add `test_output_hash` or vitest result JSON to the trigger payload so the gate can at least verify a test run happened.

**Q3 — CI vs gate-owned tests**
Is there a `.github/workflows/` CI pipeline? If yes, the gate can poll GitHub Checks API and wait for the CI run to complete — more reliable than trusting Claude Code's claim. This query didn't surface one, but worth confirming.

**Q4 — Supabase schema check scope**
v0 = block on any migration. Is that too conservative? If Claude Code adds a migration every sprint chunk, blocking every deploy for manual schema apply would be annoying. When does Option B (dry-run SQL analysis) become worth building?

**Q5 — Timeout default: KEEP vs ROLLBACK**
KEEP is proposed above (optimistic). ROLLBACK is safer (conservative). The choice depends on: how often does a promoted build that passed smoke tests later turn out to be wrong? If rarely → KEEP. If the smoke test is thin → ROLLBACK. Consider: start with ROLLBACK, loosen to KEEP once smoke test coverage improves.

**Q6 — Gate scope: all tasks or tagged tasks?**
Does every task completion trigger a deploy gate? Some tasks don't push code (research, planning, Supabase queries). The trigger endpoint is explicit (Claude Code calls it), so Claude Code decides. But should there be a `deploy: true` flag in task_queue metadata to make intent explicit in the task definition rather than at execution time?

**Q7 — Vercel webhook auth**
The Vercel deployment webhook needs a secret header check (similar to `TELEGRAM_WEBHOOK_SECRET`). Vercel sends a `x-vercel-signature` HMAC header. This needs verification in the webhook handler — do not accept unauthenticated build-ready events.

**Q8 — What happens to the task during gate execution?**
Task `status = 'claimed'` during gate run. Gate takes 30–120 seconds. Stale claim recovery (component #5) would reclaim tasks after some timeout. Ensure the gate completes (or fails cleanly) before the stale threshold. Current stale threshold: check `reclaimStale()` logic for the exact window.

**Q9 — Merge to main after promotion**
If Claude Code pushes to a branch and the gate promotes that branch's build, does the branch ever merge to main? Options: (a) gate merges via GitHub API after promotion, (b) Colin merges manually, (c) never — main just lags behind. Git history hygiene vs operational complexity.

---

## 10. Implementation Order (proposed)

1. Branch workflow: update Claude Code's commit pattern to use feature branches for deploy-able tasks
2. `POST /api/harness/deploy-gate/trigger` — records gate state to agent_events, initiates Vercel preview poll
3. Vercel deployment webhook handler — receives `deployment.ready`, stores preview URL, kicks off checks
4. Smoke check against preview URL
5. Vercel Promote API call
6. Post-promotion smoke check
7. Telegram override message (reuse component #2 button infrastructure with `dg:` prefix)
8. Override webhook handler (new callback prefix in existing webhook route)
9. Timeout cron (`/api/cron/deploy-gate-timeout`)
10. Rollback path (Vercel Promote to previous deployment)
11. Schema detection (migration file diff check — block + alert)

Steps 1–6 are the critical path. Steps 7–10 are the human-override loop. Step 11 is schema safety.

---

## 11. What This Does NOT Do

- Run Claude Code autonomously (Claude Code still requires a human to approve task execution)
- Make deployment decisions based on Telegram thumbs from component #2 (those are signal quality data, not control signals)
- Replace Colin's judgment on migrations (schema changes always require manual review and apply)
- Guarantee correctness of the deployed code beyond what smoke tests cover
