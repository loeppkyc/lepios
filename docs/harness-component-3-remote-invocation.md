# Autonomous Harness — Component #3: Remote Invocation

**Status:** Design — ready for Colin review
**Author:** Colin + Claude, 2026-04-23
**Scope:** Programmatic invocation of the coordinator sub-agent from the Vercel task-pickup cron, eliminating the last human step between task-queue claim and coordinator execution
**Rationale:** Component #5 (task pickup) v0 ends with a Telegram message asking Colin to paste one line into Claude Code. That line is the only human step remaining before true unattended operation. Component #3 removes it by having the Vercel pickup cron call the Claude Code remote trigger API directly after claiming a task.
**Sequencing:** After component #5 v0 is stable (3 clean pickup days). Coordinator trigger must exist before pickup cron can call it. Both are in-scope here.
**Sprint 4 unblock:** Sprint 4 Chunks C/D/E are scoped and ready. They will run through the harness unattended once this component ships and one clean end-to-end coordinator run is verified.

---

## 1. Goal

Component #5 v0 claims a task from `task_queue` and sends Colin a Telegram:

```text
✅ Task claimed: <8-char-id>
<first 80 chars of task text>...

To run: paste `Run task <full-uuid>` into Claude Code
```

Colin reads it, opens Claude Code, pastes one line. Coordinator runs.

That paste is the last human step. Component #3 removes it.

**What changes:** After claiming a task, the pickup cron calls `POST /v1/code/triggers/{coordinator_trigger_id}/run` with the `task_id` in the request body. The coordinator agent starts in the remote environment, reads the full task row from Supabase, and executes the coordinator loop. Escalations and grounding checkpoints surface via Telegram. Colin sees the work without having typed anything.

**What stays the same:** Every coordinator rule in `coordinator.md` — escalation gates, non-negotiables, grounding-checkpoint authority — is unchanged. Remote invocation changes _how_ the coordinator starts, not _what_ it does.

**The v0 constraint:** In v0, the remote invocation is fire-and-forget from Vercel's perspective. The pickup cron calls `/run`, gets a `run_id` back, logs it to `agent_events`, and exits. It does not poll the run for completion. Coordinator lifecycle (running, awaiting-grounding, completed) is tracked via `task_queue.status` and `last_heartbeat_at`, same as if Colin had invoked it manually.

---

## 2. Scope

### In scope (v0)

- **Coordinator trigger registration** — one persistent trigger at claude.ai (`POST /v1/code/triggers`). Configuration: lepios repo source, coordinator model and tools, base prompt instructing coordinator to fetch and execute a specific task from `task_queue`.
- **`/api/harness/invoke-coordinator` endpoint** — thin Vercel route that calls the remote trigger `/run` endpoint. Receives `task_id`, calls the API, returns the run ID. Separated from the pickup cron so it can be invoked independently for testing.
- **Pickup cron integration** — modify `app/api/cron/task-pickup/route.ts` to call `invoke-coordinator` after a successful claim, instead of (or in addition to) the v0 Telegram notification.
- **Feature flag: `REMOTE_INVOCATION_ENABLED`** — when absent or falsy, pickup cron behaves exactly like component #5 v0 (Telegram only, no remote trigger call). Fast-disable without deploy.
- **Fallback: Telegram on remote invocation failure** — if the `/run` call fails, pickup cron falls back to the v0 Telegram message so Colin can invoke manually. The task remains claimed; stale recovery applies.
- **`agent_events` row** — written after each `/run` call: `task_type: 'remote_invocation_sent'`, includes `run_id` returned by the API, `task_id`, and `trigger_id`.
- **Coordinator startup behavior** — coordinator reads `task_id` from its initial message, fetches the full row from Supabase, updates `task_queue.status = 'running'`, begins the heartbeat, and proceeds with the coordinator loop.

### Explicitly out of scope

- **Builder trigger** — builder is invoked by coordinator within the same session or as a sub-agent. It does not get a separate remote trigger in v0.
- **Run polling / completion tracking** — the Vercel cron does not poll for coordinator run completion. Coordinator manages its own lifecycle via `task_queue` updates.
- **Multi-task parallelism** — one coordinator run per pickup cycle. Queue is FIFO with one claimed task at a time.
- **Trigger management UI** — triggers are created and updated via the API directly. No dashboard.
- **Automatic task re-submission on coordinator crash** — stale heartbeat recovery (component #5 §6) handles re-queuing. This component does not add additional recovery logic.

---

## 3. The Remote Trigger API

The claude.ai remote trigger API is the invocation mechanism. Based on inspection of existing triggers (`/v1/code/triggers` — 20+ triggers live for the Loeppky Streamlit project), the API is fully operational. Key fields confirmed from live trigger objects:

```json
{
  "id": "trig_01...",
  "name": "Human-readable name",
  "cron_expression": "0 4 * * *",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "env_01CkF4M1HtoFEcDLDqN1KMtT",
      "events": [
        {
          "data": {
            "message": {
              "content": "Initial prompt sent to the agent",
              "role": "user"
            },
            "type": "user",
            "uuid": "unique-event-id"
          }
        }
      ],
      "session_context": {
        "allowed_tools": ["Read", "Glob", "Grep", "Write", "Edit"],
        "model": "claude-sonnet-4-6",
        "sources": [
          {
            "git_repository": {
              "url": "https://github.com/loeppkyc/lepios"
            }
          }
        ]
      }
    }
  }
}
```

**On-demand invocation:** `POST /v1/code/triggers/{trigger_id}/run` fires the trigger immediately, regardless of `cron_expression`. The optional body can pass additional context (see §5 — open question Q2 on whether body content is injected into the initial message).

**Environment:** `env_01CkF4M1HtoFEcDLDqN1KMtT` is the existing environment used by all Loeppky Streamlit triggers. The coordinator trigger will use the same environment unless a lepios-specific environment is needed (see §9 Q3).

**Auth:** The `RemoteTrigger` tool in Claude Code handles auth automatically (OAuth token injected in-process). For Vercel-side calls, a user API token is required — see §4.

---

## 4. Authentication

Two auth boundaries:

### 4.1 Vercel → Claude Code API

The `invoke-coordinator` endpoint in Vercel calls `POST /v1/code/triggers/{id}/run`. This requires a bearer token with permission to invoke Claude Code remote triggers.

**Token:** Store as `CLAUDE_CODE_API_KEY` in Vercel environment. This is a user-scoped OAuth token from claude.ai. It is **not** the Anthropic API key — it is a claude.ai session/access token that can be generated from the account.

**Security note:** This token has broad scope (it can invoke any trigger owned by the account). Treat it with the same care as `CRON_SECRET`. If compromised, an attacker could invoke coordinator triggers at will. Rotate alongside `VERCEL_TOKEN` on the July 22 2026 rotation schedule.

**Request shape:**

```http
POST https://claude.ai/v1/code/triggers/{coordinator_trigger_id}/run
Authorization: Bearer {CLAUDE_CODE_API_KEY}
Content-Type: application/json

{ "task_id": "<uuid>", "run_id": "<pickup-run-id>" }
```

### 4.2 Coordinator → Supabase

Coordinator reads and writes `task_queue` via the Supabase service role client. The service key must be available inside the coordinator trigger's runtime environment.

**Open question (§9 Q4):** Does the claude.ai trigger environment support injecting environment variables per-trigger, or per-run? If yes, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are set at trigger creation time and available to coordinator as `process.env`. If not, coordinator must receive them in its initial prompt (insecure — keys in logs) or they must be baked into the trigger's environment via another mechanism.

### 4.3 Coordinator → GitHub (lepios repo)

Coordinator reads files from the lepios repo. The `sources` config with `git_repository.url` handles this for reading. If coordinator needs to write commits (builder does; coordinator does not in normal operation), a `GITHUB_TOKEN` with write access to `loeppkyc/lepios` is required.

For coordinator-only runs (no commits), public read of the repo is sufficient — or the token used in `sources` handles it. Confirm whether the `git_repository` source in the trigger config uses the same OAuth token as the invocation auth.

---

## 5. Coordinator Trigger Configuration

### 5.1 Base trigger (created once)

```json
{
  "name": "LepiOS Coordinator",
  "enabled": false,
  "cron_expression": null,
  "job_config": {
    "ccr": {
      "environment_id": "env_01CkF4M1HtoFEcDLDqN1KMtT",
      "events": [
        {
          "data": {
            "message": {
              "content": "COORDINATOR RUN — task_id: {{TASK_ID}}\n\nYou are the coordinator sub-agent for LepiOS. Your instructions are in .claude/agents/coordinator.md.\n\n1. Read .claude/agents/coordinator.md\n2. Read docs/sprint-state.md\n3. Query Supabase: SELECT * FROM task_queue WHERE id = '{{TASK_ID}}'\n4. Update task_queue SET status = 'running', last_heartbeat_at = NOW() WHERE id = '{{TASK_ID}}'\n5. Execute the coordinator loop per coordinator.md starting at Phase 2 (the chunk is already defined in the task row's metadata field)\n6. Write last_heartbeat_at every 5 minutes while running\n7. Surface escalations and grounding checkpoints via Telegram (loeppky_trigger_bot)\n8. On completion: UPDATE task_queue SET status = 'completed', completed_at = NOW() WHERE id = '{{TASK_ID}}'\n\nFetch SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment.",
              "role": "user"
            },
            "type": "user",
            "uuid": "coordinator-base-event"
          }
        }
      ],
      "session_context": {
        "allowed_tools": ["Read", "Glob", "Grep", "Write", "Edit"],
        "model": "claude-sonnet-4-6",
        "sources": [
          {
            "git_repository": {
              "url": "https://github.com/loeppkyc/lepios"
            }
          }
        ]
      }
    }
  }
}
```

**Tool scope:** Matches `coordinator.md` — Read, Glob, Grep, Write, Edit. No Bash (coordinator never runs shell commands). No sub-agent invocation in v0 (builder is a future remote trigger).

**`{{TASK_ID}}` placeholder:** Whether this is injected at `/run` call time depends on the API's body-injection behavior (§9 Q2). If not supported, the base event omits the placeholder and coordinator fetches the most recently claimed task from `task_queue WHERE status = 'claimed' ORDER BY claimed_at DESC LIMIT 1`.

### 5.2 Registration

Trigger is created once via `RemoteTrigger` tool (or direct API call from Claude Code session). The resulting `trigger_id` is stored as `COORDINATOR_TRIGGER_ID` in Vercel env and in `docs/secrets-notes.md` (non-secret metadata only — the trigger ID is not a secret).

Trigger starts `enabled: false`. It is invoked on-demand via `/run`, not on a cron schedule. This ensures coordinator only runs when a task is actually claimed, not on a fixed schedule.

---

## 6. Vercel Integration

### 6.1 `/api/harness/invoke-coordinator/route.ts`

New route. Thin wrapper over the remote trigger `/run` call.

**Auth:** Requires `Authorization: Bearer {CRON_SECRET}` — same pattern as all other harness routes. Coordinator trigger is only invocable from within the LepiOS harness.

**Input:**

```typescript
{
  task_id: string
  run_id: string
}
```

**Behavior:**

1. Validate `task_id` and `run_id` are non-empty UUIDs.
2. Call `POST https://claude.ai/v1/code/triggers/{COORDINATOR_TRIGGER_ID}/run` with the task context in the body.
3. On success (HTTP 2xx): return `{ ok: true, trigger_run_id: response.run_id }`.
4. On failure: return `{ ok: false, error: response.error }` with HTTP 200 (the Vercel route itself succeeded; the upstream call failed). Pickup cron handles the fallback.

**No polling.** This route fires and returns. Coordinator lifecycle is tracked via `task_queue`, not via polling the `/run` status.

### 6.2 Pickup cron modification

Modify `app/api/cron/task-pickup/route.ts`. After a successful task claim:

```typescript
if (process.env.REMOTE_INVOCATION_ENABLED) {
  const result = await invokeCoordinator({ task_id: claimed.id, run_id })
  if (result.ok) {
    await writeAgentEvent('remote_invocation_sent', {
      task_id: claimed.id,
      trigger_run_id: result.trigger_run_id,
      trigger_id: COORDINATOR_TRIGGER_ID,
    })
    // Still send Telegram — but now as an FYI, not as an action prompt
    await sendTelegram(
      `🤖 Coordinator invoked for task ${claimed.id.slice(0, 8)}\n${claimed.task.slice(0, 80)}`
    )
    return
  }
  // Fallback: remote invocation failed, send v0 Telegram
  await sendTelegram(v0ManualPickupMessage(claimed))
} else {
  // v0 behavior: Telegram only
  await sendTelegram(v0ManualPickupMessage(claimed))
}
```

**Telegram still fires in v1.** The message changes from "action required" to "FYI — coordinator invoked." Colin gets visibility without having to act.

---

## 7. Coordinator Startup Sequence (remote context)

When coordinator starts via remote trigger:

1. **Clone lepios repo** — handled by `sources` config automatically.
2. **Read coordinator.md** — mandatory per coordinator.md Rule 1.
3. **Fetch task row** — `SELECT * FROM task_queue WHERE id = '<task_id>'`. Confirms task is `claimed` (not `cancelled` or `failed` — could have been stale-recovered between invocation and startup). If not found or wrong status, coordinator writes `error_message` to the row and terminates cleanly.
4. **Update to `running`** — `UPDATE task_queue SET status = 'running', last_heartbeat_at = NOW() WHERE id = '<task_id>'`.
5. **Read sprint-state** — confirms active sprint context matches the task's `metadata.sprint`.
6. **Execute coordinator loop** — starting at Phase 2 (acceptance doc for the chunk named in `task.metadata.chunk`). Phase 1 (sprint intake) has already happened for Sprint 4; chunks C/D/E have existing acceptance docs pending.
7. **Heartbeat every 5 minutes** — `UPDATE task_queue SET last_heartbeat_at = NOW() WHERE id = '<task_id>'`.
8. **Escalation via Telegram** — when coordinator hits an escalation gate, it sends a message to `loeppky_trigger_bot` and updates `task_queue.status = 'awaiting-grounding'`. Coordinator then terminates (cannot wait for human input in an async session). The task remains in `awaiting-grounding`; a new coordinator run is needed when Colin responds.
9. **Completion** — `UPDATE task_queue SET status = 'completed', completed_at = NOW() WHERE id = '<task_id>'`. Telegram: "✅ Coordinator completed task {id} — {summary}".

**Grounding checkpoint handling in remote context:** This is the primary behavioral change from manual invocation. When coordinator reaches a grounding checkpoint, it cannot pause and wait for Colin. Instead it:

- Writes the full grounding checkpoint list to Telegram
- Updates `task_queue.status = 'awaiting-grounding'`, `task_queue.result = { checkpoint: [...] }`
- Terminates the run

Colin responds to the Telegram. A new task is queued (or the existing task is updated with a new `description` containing Colin's response), and the next pickup cycle invokes coordinator again.

This is v0's escalation model. In v1, a two-way Telegram channel (component #2 thumbs + callback routing) could resume the coordinator run without re-queuing.

---

## 8. Failure Modes

| Scenario                                                                           | Behavior                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoke-coordinator` endpoint returns 4xx/5xx                                      | Pickup cron falls back to v0 Telegram ("paste this to run manually"). Task stays `claimed`. Stale recovery applies.                                                                                                                                 |
| Remote trigger fires but coordinator fails to start (repo clone fails, auth error) | Task stays `claimed` with no heartbeat. Stale recovery re-queues after 10 minutes. No Telegram — coordinator never started. This is a silent failure; see §9 Q7 on run status polling.                                                              |
| Coordinator starts but crashes mid-run                                             | Heartbeat stops. Stale recovery re-queues after 10 minutes. On re-queue, next pickup fires a fresh coordinator run (retry 1 of `max_retries`).                                                                                                      |
| Coordinator hits escalation gate                                                   | Sends Telegram, sets `status = 'awaiting-grounding'`, terminates cleanly. Not a failure — expected path. Colin responds, task is re-queued or a new task is inserted.                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY` not in trigger environment                             | Coordinator fails at step 3 (Supabase fetch). Writes a clear error to `task_queue.error_message` (if it can — may fail there too). Silent otherwise. Stale recovery applies.                                                                        |
| `COORDINATOR_TRIGGER_ID` not set in Vercel env                                     | `invoke-coordinator` returns 500. Pickup cron falls back to v0 Telegram. Feature flag `REMOTE_INVOCATION_ENABLED` should be forced false if this var is missing.                                                                                    |
| Remote trigger API unreachable (claude.ai outage)                                  | `invoke-coordinator` catches fetch error, returns `{ ok: false }`. Pickup cron falls back to v0 Telegram.                                                                                                                                           |
| Multiple concurrent pickup cron invocations                                        | Each invocation claims a different task (component #5 `FOR UPDATE SKIP LOCKED`). Each fires its own coordinator run. In practice the queue is designed for single-task throughput; concurrent runs are a misconfiguration risk, not a normal state. |

---

## 9. Open Questions

**Q1 — Token type for Vercel → Claude Code API: UNRESOLVED**
What token type does `POST /v1/code/triggers/{id}/run` require? The existing `RemoteTrigger` tool in Claude Code uses OAuth (injected in-process). For a Vercel function, there is no Claude Code process — just an HTTP call. Is there a machine-to-machine token (API key) available from claude.ai, or does this require a user OAuth refresh-token flow? If only OAuth is supported, Vercel would need to store a refresh token and exchange it for an access token on each invocation. This is non-trivial and may be the hardest problem in this component.

**Q2 — Body injection into initial message: UNRESOLVED**
Does the `/run` body get injected into the trigger's `events[0].message.content` (replacing `{{TASK_ID}}` placeholders), or does it appear as a separate message after the base event, or is it ignored entirely? If the body is not available to the coordinator's initial prompt, coordinator must query `task_queue WHERE status = 'claimed' ORDER BY claimed_at DESC LIMIT 1` and process whatever it finds — workable but less precise than task_id injection.

**Q3 — Environment: reuse Loeppky env or create lepios-specific one: UNRESOLVED**
All existing triggers use `env_01CkF4M1HtoFEcDLDqN1KMtT`. Does this environment have the right compute config for the lepios coordinator (different repo, different secrets)? Or does lepios need its own environment with separate secret injection? The environment may also control which secrets are available to the agent process — critical for SUPABASE_SERVICE_ROLE_KEY availability (Q4).

**Q4 — Secret injection for coordinator runtime: UNRESOLVED**
Coordinator needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to read `task_queue`. These are not in the trigger's `job_config` fields visible from the list endpoint. Three options:

- (a) Secrets are configured at the environment level (`env_01CkF4M1HtoFEcDLDqN1KMtT`) and available to all agents in that env — confirm this with Anthropic docs or by testing.
- (b) Secrets can be passed in the `/run` body — would require the body injection to work (Q2).
- (c) Coordinator reads secrets from a config file committed to the repo — bad practice, non-starter for production secrets.
  Option (a) is the desired path. Must verify before writing any coordinator trigger code.

**Q5 — Coordinator escalation response loop: ARCHITECTURE DECISION NEEDED**
When coordinator hits a grounding checkpoint and terminates with `status = 'awaiting-grounding'`, how does Colin's response re-trigger the coordinator? Two options:

- (a) Colin inserts a new task into `task_queue` with `description` containing his response. Next pickup cycle invokes coordinator with the new task. Coordinator reads the prior task from `metadata.prior_task_id` for context. Simple, preserves queue semantics, but adds latency (next pickup cron = up to 24 hours on the current daily schedule).
- (b) A Telegram callback button (component #2 infrastructure) triggers a new coordinator invocation immediately when Colin taps a response. Fast, but requires component #2 to be wired to `invoke-coordinator` — more complex, adds cross-component dependency.
  Option (a) is correct for v0 (no dependency on component #2 beyond notifications). Option (b) is the v1 target. Document this decision in §10 and in `sprint-state.md`.

**Q6 — Rate limits on remote trigger invocations: UNRESOLVED**
Is there a per-account or per-trigger rate limit on `/run` calls? If the daily pickup cron fires once per day and each coordinator run takes 30–60 minutes, the call cadence is very low. But if coordinator runs fail and stale recovery re-queues multiple times in a day, the rate could be 3–4 invocations/day per task. Confirm no limit that would block this.

**Q7 — Run start confirmation: UNRESOLVED**
The `/run` call returns a `run_id`. Does the API provide a way to confirm the run actually started (vs. queued or failed to start)? If coordinator fails to start (repo clone error, auth failure), the task stays `claimed` indefinitely until stale recovery kicks in. If the API has a status endpoint (`GET /v1/code/runs/{run_id}`), the pickup cron could poll once after 30 seconds to confirm the run is live. This would surface silent start failures faster than the 10-minute stale window.

**Q8 — Coordinator non-negotiables in remote context: CONFIRMED UNCHANGED**
Coordinator's non-negotiables (coordinator.md §Non-negotiables) apply identically in remote invocation. Remote context does not grant coordinator new authority. In particular: it cannot self-approve acceptance docs, cannot execute destructive operations, and cannot mark grounding checkpoints as passed without Colin's physical verification. The only behavioral change is how escalations are surfaced (Telegram vs. inline response) and how the run terminates on escalation (cleanly exits vs. pauses).

---

## 10. v0 Build Plan

Each chunk is independently verifiable. Chunks A–B can be done in Claude Code session (not via harness). Chunks C–E extend the pickup cron and require a Vercel deploy.

---

### Chunk A — Coordinator Trigger Registration

**Goal:** A persistent coordinator trigger exists at claude.ai. Its ID is documented. It can be invoked manually and coordinator runs.

**How:**

1. Use `RemoteTrigger` tool (action: `create`) to create the coordinator trigger with the config in §5.1.
2. Record the returned `trigger_id` in `docs/secrets-notes.md` under "Coordinator Trigger" (non-secret; just a reference).
3. Set `COORDINATOR_TRIGGER_ID={trigger_id}` in Vercel env (non-secret) and in `.env.local`.

**Verify standalone:**

```
RemoteTrigger: { action: "run", trigger_id: "<coordinator_trigger_id>", body: { task_id: "<test-uuid>" } }
→ HTTP 2xx, run_id returned
→ Check task_queue: test task (pre-inserted with status='claimed') should transition to 'running'
→ Coordinator Telegram message arrives confirming startup
```

**Unblocks:** Chunk B (needs the trigger_id).
**Effort:** S (one API call + documentation)

---

### Chunk B — `/api/harness/invoke-coordinator` Route

**Goal:** A Vercel route wraps the remote trigger `/run` call. It can be tested independently of the pickup cron.

**Files:**

- `app/api/harness/invoke-coordinator/route.ts` (new)
- `tests/api/invoke-coordinator.test.ts` (new — mock the remote trigger call)

**Verify standalone:**

```bash
curl -X POST https://lepios-one.vercel.app/api/harness/invoke-coordinator \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"task_id":"<uuid>","run_id":"<uuid>"}'
→ HTTP 200, body.ok = true, body.trigger_run_id present
→ agent_events row: task_type = 'remote_invocation_sent'
```

**Unblocks:** Chunk C (pickup cron calls this route).
**Effort:** S

---

### Chunk C — Pickup Cron Integration + Feature Flag

**Goal:** After claiming a task, pickup cron calls `invoke-coordinator` (when flag enabled). Telegram notification changes from "paste this" to "FYI — invoked."

**Files:**

- `app/api/cron/task-pickup/route.ts` (modify — add invoke-coordinator call after claim)
- `tests/api/task-pickup.test.ts` (extend — test both flag states)

**Verify standalone:**

1. `REMOTE_INVOCATION_ENABLED=0`: claim task, confirm Telegram is v0 "paste this" message. No `remote_invocation_sent` event.
2. `REMOTE_INVOCATION_ENABLED=1`: claim task, confirm `remote_invocation_sent` event written, Telegram is FYI message, coordinator run starts (check task_queue status).
3. `REMOTE_INVOCATION_ENABLED=1` + invoke-coordinator returns `{ ok: false }`: confirm v0 fallback Telegram fires.

**Unblocks:** Chunk D (end-to-end).
**Effort:** S–M

---

### Chunk D — End-to-End Test

**Goal:** Full path verified: task queued → pickup cron fires → task claimed → coordinator invoked → coordinator runs Phase 2 of Sprint 4 Chunk C → coordinator surfaces grounding checkpoint via Telegram → task status = 'awaiting-grounding'.

**Not a code chunk.** This is the grounding verification that proves the wiring is live.

**How:**

1. Insert Sprint 4 Chunk C task into `task_queue` (manual SQL).
2. Invoke pickup cron manually (`GET /api/cron/task-pickup` authorized).
3. Confirm `remote_invocation_sent` event written.
4. Confirm coordinator Telegram arrives: "Coordinator invoked for task …"
5. Wait for coordinator to complete Chunk C work (may take 20–40 minutes).
6. Confirm Telegram escalation or completion message.
7. Confirm `task_queue.status = 'awaiting-grounding'` or `'completed'`.
8. Confirm `last_heartbeat_at` was updated during the run.

**Unblocks:** Sprint 4 Chunk C execution; resume-trigger criteria in `sprint-state.md`.
**Effort:** M (time-bound by coordinator run duration; no new code)

---

### Summary

| Chunk | Goal                       | Effort | Produces                              |
| ----- | -------------------------- | ------ | ------------------------------------- |
| A     | Create coordinator trigger | S      | Trigger ID, manual invoke verified    |
| B     | `invoke-coordinator` route | S      | Testable API wrapper                  |
| C     | Pickup cron integration    | S–M    | **Feature-flagged end-to-end wiring** |
| D     | End-to-end verification    | M      | Sprint 4 resume trigger satisfied     |

Chunk C is the ship-it moment. Once C is live and flag-enabled, the harness can run Sprint 4 Chunks C/D/E without Colin typing.

**Largest unknown before Chunk A:** Q1 (token type) and Q4 (secret injection) must be resolved first. If Vercel cannot call the remote trigger API with a storable token, Chunk B cannot be built, and the design needs to be revised toward a laptop-local approach (Colin's machine runs a lightweight server that receives pickup events from Vercel and invokes Claude Code via CLI).
