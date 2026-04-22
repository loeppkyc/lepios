# Autonomous Harness — Component #6: Deploy Gate

## Current Session State (2026-04-22, session 3)

- Deploy gate v0 COMPLETE as of 2026-04-22 ~07:20 MT
- All 8 chunks (A–H) shipped and verified end-to-end
- Three migration paths verified: abort, promote, promote+rollback
- Safety guards verified: main_moved_on, double-tap, tests_passed=false, timeout defaults (10-min KEEP post-promote, 30-min ABORT migrations)
- Bugs caught + fixed during verify: fire-and-forget webhook edit (eb4c78c), deleteBranch missing on migration promote (d1c279d)
- Telegram webhook entry/early-return logging added (fb71133)
- Token rotation reminder: July 22 2026 — rotate VERCEL_TOKEN + GITHUB_TOKEN together
- GITHUB_TOKEN in Vercel HAS write access (Contents + refs delete) — confirmed across all paths

**Harness tracker (end of this session):**

| Component | Score | Notes |
| --- | --- | --- |
| Ollama | 15×10 = 1.5 | |
| Telegram thumbs | 25×85 = 21.25 | Verified E2E on tasks 48ee30db and 90f952dc |
| Coordinator | 25×35 = 8.75 | |
| Deploy gate | 15×100 = 15.0 | v0 COMPLETE — all 8 chunks shipped + E2E verified |
| Task pickup | 15×80 = 12.0 | |
| Attribution | 5×0 = 0 | |
| **Total** | **~58.5%** | |

**Next session targets:** Coordinator/Builder routing (main unlock for actual autonomy), task seeding workflow, Ollama wiring.

---

**Status:** Design — decisions recorded, v0 build plan ready for chunk selection
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
  "branch": "harness/task-<task_id>",
  "commit_sha": "abc1234",
  "run_id": "<uuid>"
}
```

This is explicit and synchronous with the task execution flow. Claude Code knows when it has pushed; no external event detection needed.

**Branch naming convention (decided — see §9 Q1):** Harness branches are named `harness/task-{task_id}`. The task_id is embedded in the branch name so Component #7 (attribution) can parse it without a separate lookup table. Human (Colin) branches continue to push directly to `main`.

**Why not task_queue `completed` event?**
Task completion is downstream of the push. The gate should run before completion is confirmed — completion is the gate's *output*, not its trigger. Completion is written to task_queue only after the gate either promotes (success) or gives up (failure).

---

## 2. Preview Deploy

**How we get the preview URL programmatically:**

**v0: Gate Runner Cron polls Vercel API**

The trigger endpoint records the gate state to `agent_events` and returns immediately (does not block). A gate runner cron (every 30s) polls Vercel API for pending gates:

```
GET https://api.vercel.com/v13/deployments
  ?projectId=<VERCEL_PROJECT_ID>
  &meta-githubCommitSha=<commit_sha>
  &limit=1
Authorization: Bearer <VERCEL_TOKEN>
```

Poll until `readyState === 'READY'` (up to 10 minutes, polling every 30s via cron). Extract `url` and `id` from response. Write `deploy_gate_preview_ready` to `agent_events`.

This is consistent with the existing harness cron pattern (task-pickup) and avoids long-running serverless invocations.

**v1: Vercel deployment webhook (event-driven)**
Configure a Vercel project webhook to `POST` to `https://lepios-one.vercel.app/api/harness/deploy-gate/webhook` on the `deployment.ready` event. Webhook payload includes `deployment.url`, `deployment.meta.githubCommitRef`, and `deployment.meta.githubCommitSha`. More reliable than polling but requires Vercel dashboard configuration. Upgrade path once cron polling is validated.

**New env vars needed:**
- `VERCEL_TOKEN` — personal access token for Vercel API calls
- `VERCEL_PROJECT_ID` — lepios project ID (already in Vercel dashboard, needs exposure to runtime)

---

## 3. Gate Checks

Checks run in order. First failure blocks promotion.

### 3.1 Build success (pre-condition, not a check)
If the Vercel preview build failed, there is no `readyState === 'READY'` response and no preview URL. The gate cron detects build failure and alerts Telegram. No promotion.

### 3.2 Tests pass
**Problem:** `npm test` can't run inside a serverless function.

**v0: Claude Code claims pass.** Claude Code runs `npm test` locally before calling the trigger endpoint. If tests fail, it does not push and does not call the trigger. The trigger payload includes `"tests_passed": true` and the gate logs it as `deploy_gate_tests_claimed`. The gate trusts the claim — it does not re-run tests. This matches the current harness pattern.

**v1 upgrade:** GitHub Actions CI runs on push. Gate queries GitHub Checks API for the commit SHA and waits for CI green. Requires `GITHUB_TOKEN` and a CI workflow (currently not in place).

### 3.3 Smoke test
Hit a known endpoint on the preview URL and assert 200:

```
GET https://<preview-url>/api/health
```

The `/api/health` route already exists. Assert `res.ok && body.ok === true`. Write `deploy_gate_smoke_preview` with `status_code` and `response_ms`.

This catches: cold start crashes, missing env vars in preview, Supabase connection failures.

**Preview env vars:** Vercel preview deployments use the `Preview` environment variable set. `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, etc. are currently scoped to Preview — confirmed via `vercel env ls`.

### 3.4 Schema check + two-tier promotion (decided — see §9 Q4)

**Detection:** Query the GitHub API for files changed in the commit diff. If any file matches `supabase/migrations/**` → migration path. Otherwise → auto-promote path.

**Migration path (human gate):**
Gate does NOT auto-promote. Posts Telegram message with the full migration SQL rendered inline:

```
⚠️ Migration detected — review required
Branch: harness/task-abc123
File: supabase/migrations/0015_add_index.sql

-- migration SQL here --

👍 Promote to production   👎 Abort
```

Colin reviews on phone, taps 👍 to promote or 👎 to abort. Gate holds until tap or timeout (§6).

**Non-migration path (auto-promote):**
Smoke passes + no migrations → promote automatically. Post-promotion Telegram notification sent with a 👎 rollback button in case something was missed (§6).

---

## 4. Promotion

**Decided: merge harness branch into main via GitHub API. Vercel auto-deploys main to production.**

**Rejected: Vercel alias-promote** (swap deployment alias without merging). Reason: leaves `main` behind production. Any subsequent push to `main` — by Colin or another harness task — would overwrite the promoted deployment. Attribution and git history diverge from what's actually running in prod. Not safe as a long-term pattern.

**Promotion sequence:**
1. Gate calls GitHub Merges API to merge the harness branch into `main`:
   ```
   POST https://api.github.com/repos/loeppkyc/lepios/merges
   Authorization: Bearer <GITHUB_TOKEN>
   {
     "base": "main",
     "head": "harness/task-{task_id}",
     "commit_message": "harness: merge task {task_id} [deploy-gate auto-merge]"
   }
   ```
2. The merge triggers Vercel's git integration → Vercel builds and deploys `main` to production automatically (identical path to Colin's manual pushes — no special Vercel config needed).
3. Gate polls Vercel API until the resulting production deployment reaches `READY`, then writes `deploy_gate_promoted` to `agent_events`.
4. Gate deletes the harness branch via GitHub API (see §10 Chunk E — branch cleanup).

**Commit message convention:** Embedding `task {task_id}` in the merge commit message lets Component #7 (attribution) trace the deployment back to the originating task even after the branch is deleted. Belt-and-suspenders: the branch name also encodes the task_id, but the commit message survives branch deletion.

**New env vars needed:**
- `GITHUB_TOKEN` — personal access token with `repo` scope (merge + branch delete)
- `GITHUB_REPO` — `loeppkyc/lepios`

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
   Find the most recent `readyState === 'READY'` deployment that is NOT the current one.

2. Promote that deployment:
   ```
   POST https://api.vercel.com/v10/projects/<projectId>/promote/<previousDeploymentId>
   ```

Rolls back the production alias in seconds. No git revert, no rebuild.

**Migration rollback:** Supabase has no rollback transaction. If a migration was applied before promotion and a rollback is triggered, the schema change persists. Gate alerts Colin separately — schema rollback is always manual.

---

## 6. Human Override

**Post-promotion Telegram message (non-migration path):**

```
✅ Promoted to production
Branch: harness/task-abc123 | Commit: abc1234
Smoke: pass | Tests: claimed | Build: pass

👎 Roll back
```

Single 👎 button — keep is the default. Timeout = **10 minutes** → **KEEP**. Rationale: smoke passed, optimistic default. Colin can rollback manually any time.

**Migration gate Telegram message (migration path, pre-promotion):**

```
⚠️ Migration detected — review required
Branch: harness/task-abc123
File: 0015_add_index.sql

<sql rendered inline>

👍 Promote   👎 Abort
```

Timeout = **30 minutes** → **ABORT** (conservative — don't promote without explicit approval). Alert Telegram if timed out.

**Callback prefix:** `dg:` (new prefix added to existing webhook route handler alongside existing `tf:` prefix). Examples: `dg:keep:<gate_event_id>`, `dg:rb:<gate_event_id>`, `dg:promote:<gate_event_id>`, `dg:abort:<gate_event_id>`.

**Timeout enforcement:** Vercel cron (`/api/cron/deploy-gate-timeout`, every 5 minutes) checks `agent_events` for `deploy_gate_override_sent` rows older than the timeout threshold with no corresponding resolution row. Writes resolution event and takes default action.

---

## 7. Failure Modes

| Scenario | Behavior |
|---|---|
| Trigger called but preview build fails | Gate cron detects no `READY` state after 10 min → Telegram alert, `deploy_gate_failed`, task stays claimed |
| Smoke test fails on preview | Block promotion, Telegram alert with preview URL for manual inspection |
| Migration detected | Hold for human tap (§3.4) — this is not a failure, it's a gate |
| Migration gate times out (30 min) | Abort, Telegram alert: "Migration gate expired — no action taken" |
| Post-promotion Telegram timeout (10 min) | Default keep, write `deploy_gate_override_timeout` |
| Vercel API down | Polling timeout → gate fails → Telegram alert. Do not promote. |
| GitHub merge fails (conflict or API error) | Telegram alert, write `deploy_gate_failed`. Branch not deleted. Previous production stays active. |
| Post-promotion smoke fails | Auto-rollback (don't wait for human). Telegram alert separately. |
| Gate handler itself crashes | Top-level `try/catch` → `deploy_gate_failed` + Telegram alert. Never silently drop. |
| 👎 rollback tap but rollback API fails | Log `deploy_gate_rollback_failed`, Telegram with manual rollback instructions. |
| Tests claimed passed but were skipped | Gate cannot detect in v0. Mitigation: Claude Code must run full `npm test`. |

---

## 8. agent_events Schema

All gate events use `domain: 'orchestrator'`, `actor: 'deploy_gate'`. The `meta` field carries step context.

| task_type | status values | output_summary pattern | key meta fields |
|---|---|---|---|
| `deploy_gate_triggered` | `success` | `gate triggered for commit abc1234` | `task_id`, `branch`, `commit_sha`, `run_id` |
| `deploy_gate_preview_ready` | `success` \| `error` | `preview ready at <url>` or `timeout waiting for preview` | `preview_url`, `deployment_id`, `elapsed_ms` |
| `deploy_gate_tests_claimed` | `success` | `tests claimed pass by Claude Code` | `claimed_by: 'claude_code'`, `commit_sha` |
| `deploy_gate_smoke_preview` | `success` \| `error` | `smoke pass on <url>` or `smoke fail: <status>` | `preview_url`, `status_code`, `response_ms` |
| `deploy_gate_schema_check` | `success` \| `warning` | `no migrations` or `migration detected: <file>` | `migration_files`, `path` |
| `deploy_gate_promoted` | `success` \| `error` | `promoted <deployment_id> to production` | `deployment_id`, `previous_deployment_id` |
| `deploy_gate_smoke_production` | `success` \| `error` | `post-promotion smoke pass` or `fail` | `status_code`, `response_ms` |
| `deploy_gate_override_sent` | `success` | `Telegram override message sent` | `message_id`, `chat_id`, `timeout_at`, `gate_type` |
| `deploy_gate_override_kept` | `success` | `human confirmed keep at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_rolled_back` | `success` | `human requested rollback at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_promoted` | `success` | `human approved migration promotion at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_aborted` | `success` | `human aborted migration at HH:MM` | `telegram_user_id`, `latency_ms` |
| `deploy_gate_override_timeout` | `warning` | `gate expired — defaulting to <keep\|abort>` | `timeout_minutes`, `default_action` |
| `deploy_gate_promotion_skipped` | `success` | `auto-promote disabled (DEPLOY_GATE_AUTO_PROMOTE=0)` | `branch`, `commit_sha`, `reason` |
| `deploy_gate_rolled_back` | `success` \| `error` | `rolled back to <deployment_id>` | `from_deployment_id`, `to_deployment_id` |
| `deploy_gate_failed` | `error` | `gate failed: <reason>` | `error`, `stage_failed_at` |

---

## 9. Open Questions

**Q1 — Branch strategy: DECIDED**
Harness pushes to `harness/task-{task_id}` branches. The task_id is embedded in the branch name so Component #7 (attribution) can parse branch → task without a separate mapping table. Claude Code needs a small helper to create the branch, push, and call the trigger — no existing wrapper exists. Humans (Colin) continue pushing directly to `main` for hands-on work; the gate only activates on `harness/` branches.

**Q2 — Who runs tests?**
v0 puts test responsibility on Claude Code (claims pass, gate trusts it). Is that acceptable? If a Claude Code session runs a subset of tests to save time, the gate has no way to know. Consider: add `test_output_hash` or vitest result JSON to the trigger payload so the gate can at least verify a test run happened.

**Q3 — CI vs gate-owned tests**
Is there a `.github/workflows/` CI pipeline? If yes, the gate can poll GitHub Checks API and wait for the CI run to complete — more reliable than trusting Claude Code's claim. Not currently in place, but worth confirming before building the v1 test path.

**Q4 — Supabase schema check: DECIDED (two-tier)**
Diff touches `supabase/migrations/**` → gate holds for human Telegram review (SQL rendered inline, 👍 promote / 👎 abort, 30-min timeout defaults to abort). Diff does not touch migrations → auto-promote on green smoke, post-promotion Telegram with 👎 rollback button.

**v1 future work — migration classification (do not build now):**
Classify migrations as additive vs destructive and auto-promote additive:
- Additive (safe to auto-promote): `CREATE TABLE`, `ADD COLUMN` (nullable), `CREATE INDEX CONCURRENTLY`, `CREATE POLICY`, `CREATE FUNCTION`, `CREATE TYPE`
- Destructive (always gate): `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN` (type change, adding NOT NULL on existing rows), `TRUNCATE`, `DROP POLICY`, `RENAME COLUMN`, `RENAME TABLE`, `ALTER TABLE ... DROP DEFAULT` on a required column, any `UPDATE` or `DELETE` in migration body
- Parse migration SQL AST or use regex patterns against the above lists. Block on any destructive pattern. Auto-promote if all statements are on the additive list. Alert on unrecognized statements (conservative default = gate).

**Q5 — Timeout default: KEEP vs ROLLBACK (partially resolved)**
Post-promotion override: KEEP (10 min). Migration gate: ABORT (30 min). Rationale: post-promotion has already passed smoke, low risk of silent wrongness. Migration gate is pre-promotion — conservative default is correct.

**Q6 — Gate scope: all tasks or tagged tasks?**
The trigger endpoint is explicit (Claude Code decides when to call it). But should there be a `deploy: true` flag in task_queue metadata to declare intent at task-definition time rather than execution time? Deferred — Claude Code will call the trigger only when it has pushed deployable code.

**Q7 — Vercel webhook auth**
Vercel sends an `x-vercel-signature` HMAC header on deployment webhooks. The v1 webhook handler must verify this. v0 (polling) bypasses the issue — the cron calls Vercel API directly, no inbound webhook.

**Q8 — What happens to the task during gate execution?**
Task `status = 'claimed'` during gate run. Gate may take minutes (polling for preview). Stale claim recovery (component #5) must not reclaim the task while the gate is running. Check `reclaimStale()` timeout threshold and confirm it's > max gate duration.

**Q9 — Merge to main after promotion**
Harness branch gets promoted to production but never merged to main. Main lags behind deployed code. Acceptable for v0. For v1, gate can merge via GitHub API after promotion. Deferred.

---

## 10. v0 Build Plan

Each chunk is independently shippable and verifiable before the next is built. Ordered so each one produces something visible.

---

### Chunk A — Trigger Endpoint
**Goal:** Claude Code can signal "I pushed a harness branch" and the event is durably logged.

**Files:**
- `app/api/harness/deploy-gate/trigger/route.ts` (new)
- `tests/api/deploy-gate-trigger.test.ts` (new)

**Verify standalone:**
```bash
curl -X POST https://lepios-one.vercel.app/api/harness/deploy-gate/trigger \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"task_id":"test-uuid","branch":"harness/task-test","commit_sha":"abc1234","run_id":"run-1","tests_passed":true}'
```
Query: `SELECT * FROM agent_events WHERE task_type = 'deploy_gate_triggered' ORDER BY occurred_at DESC LIMIT 1`
Expected: row with `status=success`, `meta.branch='harness/task-test'`, `meta.commit_sha='abc1234'`.

**Unblocks:** Chunk B (gate runner needs trigger rows to find pending gates).
**Effort:** S

---

### Chunk B — Preview URL Discovery
**Goal:** After a trigger row exists, a cron polls Vercel API until the preview build is READY and records the URL.

**Files:**
- `app/api/cron/deploy-gate-runner/route.ts` (new — the gate cron)
- `lib/harness/deploy-gate.ts` (new — shared Vercel API helpers)
- `vercel.json` (add cron entry, every 30s or 1min)
- `tests/harness/deploy-gate.test.ts` (new)

**Verify standalone:**
Push a real commit to a `harness/task-*` branch. Wait for Vercel preview build. Call the cron manually. Query:
`SELECT * FROM agent_events WHERE task_type IN ('deploy_gate_preview_ready', 'deploy_gate_failed') ORDER BY occurred_at DESC LIMIT 3`
Expected: `deploy_gate_preview_ready` row with `meta.preview_url` set. Click the URL — preview loads.

**Unblocks:** Chunk C needs the preview URL to run smoke.
**Effort:** M (Vercel API auth, polling state management via agent_events)

---

### Chunk C — Smoke Check on Preview
**Goal:** After preview is ready, gate hits `/api/health` on the preview URL and records pass/fail.

**Pre-requisite sub-task: ~~create `/api/health` route~~ — already exists.**
`app/api/health/route.ts` exists and returns `{ ok: true, db: 'reachable', timestamp }` after a live Supabase ping. More thorough than the minimal version planned here. No action needed.

**Files:**
- `lib/harness/deploy-gate.ts` (extend — `runSmokeCheck()`)
- Extend `deploy-gate-runner/route.ts` to invoke smoke after preview ready

**Verify standalone:**
After a successful preview (from Chunk B), trigger the cron manually. Query:
`SELECT * FROM agent_events WHERE task_type = 'deploy_gate_smoke_preview' ORDER BY occurred_at DESC LIMIT 1`
Expected: `status=success`, `meta.status_code=200`, `meta.response_ms` present.
To test failure: point smoke at a known-bad URL and confirm `status=error` is logged.

**Unblocks:** Chunk D and E both depend on smoke result.
**Effort:** S

---

### Chunk D — Migration Detection
**Goal:** After smoke passes, gate checks whether the commit diff touches `supabase/migrations/**` and records the result.

**Files:**
- `lib/harness/deploy-gate.ts` (extend — `detectMigrations()` using GitHub API diff endpoint)
- Extend `deploy-gate-runner/route.ts` with migration check step

**Verify standalone:**
Push a commit with a new migration file. Trigger cron. Query:
`SELECT * FROM agent_events WHERE task_type = 'deploy_gate_schema_check' ORDER BY occurred_at DESC LIMIT 1`
Expected: `status=warning`, `meta.migration_files` contains the filename.
Push a commit with no migrations → `status=success`, `meta.migration_files=[]`.

**Unblocks:** Chunk E (auto-promote path) and Chunk H (migration gate path) branch here.
**Effort:** S (GitHub API diff is a single GET — needs `GITHUB_TOKEN` env var)

---

### Chunk E — Merge to Main + Branch Cleanup (non-migration path)
**Goal:** Smoke passes + no migrations → harness branch merges into main, Vercel auto-deploys, branch is deleted. First end-to-end working path.

**Promotion mechanism (decided — see §4):** Merge to main via GitHub API. Not Vercel alias-promote.

**Kill switch:** `DEPLOY_GATE_AUTO_PROMOTE` env var (default `1`). When set to `0`, gate runs all checks (A–D) but skips the merge and branch deletion. Logs `deploy_gate_promotion_skipped` with `reason: 'DEPLOY_GATE_AUTO_PROMOTE=0'` and sends Telegram alert so Colin can promote manually. Use this to put the gate in observer mode without reverting code.

**Branch cleanup:** After a successful merge, gate deletes the `harness/task-{task_id}` branch via GitHub API:
```
DELETE https://api.github.com/repos/loeppkyc/lepios/git/refs/heads/harness/task-{task_id}
Authorization: Bearer <GITHUB_TOKEN>
```
Attribution safety: task_id is captured into the merge commit message (`harness: merge task {task_id} [deploy-gate auto-merge]`) before branch deletion. Component #7 can parse the commit message from git log; does not rely on the branch existing.

**Files:**
- `lib/harness/deploy-gate.ts` (extend — `mergeToMain()`, `deleteBranch()`, `checkKillSwitch()`)
- Extend `deploy-gate-runner/route.ts` with merge + cleanup step

**Verify standalone:**
1. Set `DEPLOY_GATE_AUTO_PROMOTE=0`. Push a code-only commit to `harness/task-*`. Run A–D. Trigger cron → confirm `deploy_gate_promotion_skipped` logged, branch still exists, main unchanged.
2. Set `DEPLOY_GATE_AUTO_PROMOTE=1`. Push a code-only commit. Run A–D. Trigger cron → confirm `deploy_gate_promoted` logged, `main` has the merge commit (check `git log origin/main`), Vercel dashboard shows new production deploy, branch deleted on GitHub.

**Unblocks:** Chunk F (Telegram notification after promotion).
**Effort:** S–M (two GitHub API calls + kill switch logic; Vercel deploy is triggered automatically by the merge)

---

### Chunk F — Post-Promotion Telegram + Rollback Button
**Goal:** After auto-promote, Colin gets a Telegram message with a 👎 rollback button. Tapping it rolls back.

**Files:**
- `lib/harness/telegram-buttons.ts` (extend — new `dg:` callback prefix for `buildGateCallbackData()`)
- `app/api/telegram/webhook/route.ts` (extend — handle `dg:` prefix in POST handler)
- `lib/harness/deploy-gate.ts` (extend — `rollbackDeployment()`, `sendGateNotification()`)
- `tests/api/telegram-webhook.test.ts` (extend — new `dg:` handler tests)

**Verify standalone:**
After a Chunk E auto-promote, Telegram message arrives with 👎 button. Tap it. Verify Vercel shows previous deployment active. Query `agent_events` for `deploy_gate_rolled_back` row.

**Unblocks:** Chunk H reuses the same `dg:` button infrastructure for migration gate 👍/👎.
**Effort:** M (reuses component #2 infrastructure; main work is rollback logic and new callback prefix)

---

### Chunk G — Timeout Cron (post-promotion override)
**Goal:** If Colin doesn't tap 👎 within 10 minutes, gate resolves as KEEP. Prevents stuck override rows.

**Files:**
- `app/api/cron/deploy-gate-timeout/route.ts` (new)
- `vercel.json` (add cron entry, every 5 minutes)
- `tests/api/deploy-gate-timeout.test.ts` (new)

**Verify standalone:**
Trigger a promotion (Chunk E) and do NOT tap the Telegram button. Wait 10+ minutes. Trigger timeout cron manually. Query:
`SELECT * FROM agent_events WHERE task_type = 'deploy_gate_override_timeout' ORDER BY occurred_at DESC LIMIT 1`
Expected: `status=warning`, `meta.default_action='keep'`.

**Unblocks:** Chunk H needs the same timeout cron for migration gates (30-min ABORT path).
**Effort:** S

---

### Chunk H — Migration Gate (Telegram with SQL inline)
**Goal:** When a migration is detected (Chunk D), gate holds promotion and sends a Telegram message with the full SQL rendered inline. Colin taps 👍 to promote or 👎 to abort.

**Files:**
- `lib/harness/deploy-gate.ts` (extend — `fetchMigrationSQL()` via GitHub raw content API, `sendMigrationGateMessage()`)
- `app/api/telegram/webhook/route.ts` (extend — `dg:promote:` and `dg:abort:` handlers)
- Extend timeout cron (Chunk G) to handle migration gate 30-min ABORT default

**Verify standalone:**
Push a commit with a new migration file. Wait for Chunk B–D to run. Telegram message arrives with migration SQL inline and 👍/👎 buttons. Tap 👍 → verify production is promoted. Tap 👎 → verify no promotion, `deploy_gate_override_aborted` logged. Let it time out → verify `deploy_gate_override_timeout` with `default_action='abort'`.

**Unblocks:** This is the last core chunk. Gate is now fully operational.
**Effort:** M (GitHub raw content fetch, message formatting for SQL, two new callback handlers)

---

### Summary

| Chunk | Goal | Effort | Produces |
|---|---|---|---|
| A | Trigger endpoint | S | Audit trail in agent_events |
| B | Preview URL discovery | M | Clickable preview URL in agent_events |
| C | Smoke check | S | First gate pass/fail signal |
| D | Migration detection | S | Two-tier branch point |
| E | Merge to main + branch cleanup | S–M | **First end-to-end promotion** |
| F | Telegram + rollback | M | Human oversight loop live |
| G | Timeout cron | S | Override rows resolve automatically |
| H | Migration gate | M | Full two-tier gate operational |

A → B → C → D → E is the critical path. Ship E and the gate produces real value. F–H add the human oversight and migration safety layers.

---

## 11. Implementation Order (superseded by §10)

The earlier ordered list is superseded by the chunk plan in §10. Preserved here for reference only.

1. Branch workflow → trigger endpoint → preview discovery → smoke → promote → Telegram → rollback → timeout → migration gate

---

## 12. What This Does NOT Do

- Run Claude Code autonomously (Claude Code still requires a human to approve task execution)
- Make deployment decisions based on Telegram thumbs from component #2 (those are signal quality data, not control signals)
- Replace Colin's judgment on migrations (schema changes always require human tap to promote)
- Guarantee correctness of the deployed code beyond what smoke tests cover
- Automatically merge harness branches to main (Colin decides, post-promotion)
