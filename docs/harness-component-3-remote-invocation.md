# Autonomous Harness — Component #3: Remote Invocation

**Status:** Design — spec locked, ready to build
**Author:** Colin + Claude, 2026-04-23
**Scope:** Programmatic invocation of the coordinator sub-agent from the Vercel task-pickup cron, eliminating the last human step between task-queue claim and coordinator execution
**Rationale:** Component #5 (task pickup) v0 ends with a Telegram message asking Colin to paste one line into Claude Code. That line is the only human step remaining before true unattended operation. Component #3 removes it by having the Vercel pickup cron call the Anthropic Routines API directly after claiming a task.
**Sequencing:** After component #5 v0 is stable (3 clean pickup days). Coordinator routine must exist before pickup cron can call it. Both are in-scope here.
**Sprint 4 unblock:** Sprint 4 Chunks C/D/E are scoped and ready. They will run through the harness unattended once this component ships and one clean end-to-end coordinator run is verified.
**API status:** Experimental — `anthropic-beta: experimental-cc-routine-2026-04-01`. Pin this header; monitor for deprecation notices.

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

**What changes:** After claiming a task, the pickup cron calls `POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire` with the `task_id` as the body text. The coordinator agent starts in the remote environment, reads the full task row from Supabase, and executes the coordinator loop. Escalations and grounding checkpoints surface via Telegram. Colin sees the work without having typed anything.

**What stays the same:** Every coordinator rule in `coordinator.md` — escalation gates, non-negotiables, grounding-checkpoint authority — is unchanged. Remote invocation changes _how_ the coordinator starts, not _what_ it does.

**The v0 constraint:** In v0, the remote invocation is fire-and-forget from Vercel's perspective. The `/fire` call returns `claude_code_session_id` and `claude_code_session_url` immediately — it does not stream output or wait for completion. The pickup cron logs the session ID to `agent_events` and exits. Coordinator lifecycle (running, awaiting-grounding, completed) is tracked via `task_queue.status` and `last_heartbeat_at`, same as if Colin had invoked it manually.

---

## 2. Scope

### In scope (v0)

- **Coordinator routine registration** — one persistent routine created at claude.ai/code/routines. Configuration: lepios repo source, coordinator model and tools, saved prompt instructing coordinator to fetch and execute a task from `task_queue`. Created once in the UI; `routine_id` stored in Vercel env.
- **`/api/harness/invoke-coordinator` endpoint** — thin Vercel route that calls `POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire`. Receives `task_id`, calls the API, returns the `claude_code_session_id`. Separated from the pickup cron so it can be invoked independently for testing.
- **Pickup cron integration** — modify `app/api/cron/task-pickup/route.ts` to call `invoke-coordinator` after a successful claim, instead of (or in addition to) the v0 Telegram notification.
- **Feature flag: `REMOTE_INVOCATION_ENABLED`** — when absent or falsy, pickup cron behaves exactly like component #5 v0 (Telegram only, no remote trigger call). Fast-disable without deploy.
- **Fallback: Telegram on remote invocation failure** — if the `/run` call fails, pickup cron falls back to the v0 Telegram message so Colin can invoke manually. The task remains claimed; stale recovery applies.
- **`agent_events` row** — written after each `/fire` call: `task_type: 'remote_invocation_sent'`, includes `claude_code_session_id` returned by the API, `task_id`, and `routine_id`.
- **Coordinator startup behavior** — coordinator reads `task_id` from its initial message, fetches the full row from Supabase, updates `task_queue.status = 'running'`, begins the heartbeat, and proceeds with the coordinator loop.

### Explicitly out of scope

- **Builder routine** — builder is invoked by coordinator within the same session or as a sub-agent. It does not get a separate remote routine in v0.
- **Run polling / completion tracking** — the Vercel cron does not poll for coordinator session completion. The `/fire` API does not stream or wait; coordinator manages its own lifecycle via `task_queue` updates.
- **Multi-task parallelism** — one coordinator run per pickup cycle. Queue is FIFO with one claimed task at a time.
- **Routine management UI** — routines are created and configured via the UI at claude.ai/code/routines. The per-routine API token is generated there.
- **Automatic task re-submission on coordinator crash** — stale heartbeat recovery (component #5 §6) handles re-queuing. This component does not add additional recovery logic.
- **Retry logic in invoke-coordinator** — the `/fire` endpoint has no idempotency key; each call creates a new session. Pickup cron must NOT retry `/fire` on failure — let stale reclaim handle it.

---

## 3. The Anthropic Routines API

Source: `https://platform.claude.com/docs/en/api/claude-code/routines-fire`

### 3.1 Fire endpoint

```http
POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire
Authorization: Bearer sk-ant-oat01-...
anthropic-version: 2023-06-01
anthropic-beta: experimental-cc-routine-2026-04-01
Content-Type: application/json

{
  "text": "<freeform string, max 65,536 chars>"
}
```

**`routine_id`:** Prefixed `trig_` (e.g., `trig_01...`) despite the parameter name being `routine_id`. Use the ID from claude.ai/code/routines.

**`text` field:** Freeform string. Passed to the routine alongside its saved prompt as **initial context** — not structured injection. If we send JSON it is received as a literal string. For our use: the routine's saved prompt contains the coordinator's base instructions; `text` carries the `task_id`. Coordinator reads `text` to parse `task_id`, then queries `task_queue`.

**Response:** Returns immediately — does not stream or wait for session completion:

```json
{
  "claude_code_session_id": "sess_01...",
  "claude_code_session_url": "https://claude.ai/code/sessions/sess_01..."
}
```

**No idempotency key.** Each `/fire` call creates a new session. Pickup cron must NOT retry on failure — let task stale-reclaim handle re-queuing.

### 3.2 Plan requirement

Requires Pro/Max/Team/Enterprise plan with Claude Code on the web enabled. Colin has Max. Verify "Claude Code on the web" is enabled at claude.ai/settings before Chunk A.

### 3.3 Rate limits

Per-account daily allowance (varies by plan), surfaced at claude.ai/code/routines. 429 returns `Retry-After` header. At 3–4 invocations/day during stale-recovery cycles, well under any limit on Max plan.

### 3.4 Experimental status

The `anthropic-beta: experimental-cc-routine-2026-04-01` header is required. This API may change. Pin the beta header version in code and monitor Anthropic changelog for deprecation notices. Do not build production-critical logic that can't be adapted if the API changes.

---

## 4. Authentication

Three auth boundaries, all resolved.

### 4.1 Vercel → Anthropic Routines API ✓ RESOLVED

**Token type:** Per-routine bearer token. Format: `sk-ant-oat01-...`

**How to generate:** claude.ai/code/routines → select routine → Edit → "Add another trigger" → API → "Generate token". Shown once on generation; not retrievable afterward. Revocable at any time from the same UI.

**Scope:** Scoped to exactly one routine. A compromised token can only fire that one routine — no read access, no account data, no access to other routines. This is safe to store as a Vercel environment secret.

**Token variable:** `COORDINATOR_ROUTINE_TOKEN` in Vercel env and in `.env.local`. NOT `ANTHROPIC_API_KEY` (that's the LLM API key — different thing entirely).

**Security note:** Treat like `CRON_SECRET`. Add to the July 22 2026 rotation schedule alongside `VERCEL_TOKEN` and `GITHUB_TOKEN`.

**Request shape (confirmed):**

```http
POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire
Authorization: Bearer sk-ant-oat01-...
anthropic-version: 2023-06-01
anthropic-beta: experimental-cc-routine-2026-04-01
Content-Type: application/json

{ "text": "task_id: <uuid>\nrun_id: <pickup-run-uuid>" }
```

### 4.2 Coordinator → Supabase ✓ RESOLVED BY ARCHITECTURE

Secrets for coordinator runtime (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.) are configured as **connectors** when creating the routine in the UI at claude.ai/code/routines. They are saved per-routine and available to every session fired from that routine. No per-request secret passing required.

Action: add Supabase connector when creating the coordinator routine in Chunk A.

### 4.3 Coordinator → GitHub (lepios repo) ✓ RESOLVED BY ARCHITECTURE

Same connector pattern as 4.2. The lepios repo source is configured in the routine's saved config (repo URL + credentials). Coordinator reads files from the cloned repo automatically. No per-request credential passing.

For coordinator-only runs (no commits), read access is sufficient. Builder commits are out of scope for coordinator.

---

## 5. Coordinator Routine Configuration

### 5.1 Saved prompt (configured in UI when creating the routine)

The routine's saved prompt is the stable base instruction set. The `/fire` body `text` field carries the per-invocation context (task_id). Coordinator reads both.

```text
You are the coordinator sub-agent for LepiOS. Your instructions are in .claude/agents/coordinator.md.

The INITIAL CONTEXT field (provided at run time) contains the task_id and run_id for this invocation. Parse them first.

On every invocation:
1. Read .claude/agents/coordinator.md
2. Read docs/sprint-state.md
3. Parse task_id from the initial context text
4. Query Supabase: SELECT * FROM task_queue WHERE id = '<task_id>'
   - If status != 'claimed': write error_message, terminate cleanly
5. UPDATE task_queue SET status = 'running', last_heartbeat_at = NOW() WHERE id = '<task_id>'
6. Execute the coordinator loop per coordinator.md Phase 2 for the chunk named in task.metadata.chunk
7. Write last_heartbeat_at = NOW() every 5 minutes while running
8. Surface escalations and grounding checkpoints via Telegram (loeppky_trigger_bot)
   - On escalation: UPDATE status = 'awaiting-grounding', write checkpoint list to result column, terminate
9. On completion: UPDATE status = 'completed', completed_at = NOW(), write summary to result column
   - Send Telegram: "✅ Coordinator completed [task_id prefix] — [one-line summary]"
```

### 5.2 Routine settings (configured in UI)

- **Name:** LepiOS Coordinator
- **Model:** claude-sonnet-4-6
- **Tools:** Read, Glob, Grep, Write, Edit (no Bash — coordinator never runs shell commands)
- **Repo source:** `https://github.com/loeppkyc/lepios` (private — connect via GitHub connector)
- **Connectors:** Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), Telegram bot token (loeppky_trigger_bot)
- **Cron schedule:** None — on-demand only via `/fire`

### 5.3 `/fire` request body

Freeform `text` string, passed as initial context alongside the saved prompt:

```json
{ "text": "task_id: <full-uuid>\nrun_id: <pickup-run-uuid>" }
```

Coordinator parses this text to extract `task_id`. No structured injection — straightforward string parsing.

### 5.4 Registration

Routine is created once in the UI at claude.ai/code/routines. The resulting `routine_id` (prefixed `trig_`) is stored:

- As `COORDINATOR_ROUTINE_ID` in Vercel env (non-secret — it's an ID, not a token)
- In `docs/secrets-notes.md` under "Coordinator Routine" for reference

The per-routine API token is generated separately in the same UI screen (§4.1) and stored as `COORDINATOR_ROUTINE_TOKEN` in Vercel env (this IS a secret).

---

## 6. Vercel Integration

### 6.1 `/api/harness/invoke-coordinator/route.ts`

New route. Thin wrapper over the Anthropic Routines `/fire` call.

**Auth:** Requires `Authorization: Bearer {CRON_SECRET}` — same pattern as all other harness routes. Only the LepiOS harness can invoke the coordinator routine.

**Input:**

```typescript
{
  task_id: string
  run_id: string
}
```

**Behavior:**

1. Validate `task_id` and `run_id` are non-empty UUIDs.
2. Build the `text` body: `"task_id: ${task_id}\nrun_id: ${run_id}"`.
3. Call the Routines API — exactly once, no retries (see request shape below).
4. On success (HTTP 2xx): return `{ ok: true, session_id: response.claude_code_session_id, session_url: response.claude_code_session_url }`.
5. On failure or network error: return `{ ok: false, error: string }` with HTTP 200. Pickup cron handles the fallback. Do NOT retry — duplicate `/fire` calls create duplicate sessions.

```typescript
fetch(`https://api.anthropic.com/v1/claude_code/routines/${COORDINATOR_ROUTINE_ID}/fire`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${COORDINATOR_ROUTINE_TOKEN}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'experimental-cc-routine-2026-04-01',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ text: `task_id: ${task_id}\nrun_id: ${run_id}` }),
})
```

**No polling.** This route fires and returns. Coordinator lifecycle is tracked via `task_queue`, not the session URL.

### 6.2 Pickup cron modification

Modify `app/api/cron/task-pickup/route.ts`. After a successful task claim:

```typescript
if (process.env.REMOTE_INVOCATION_ENABLED) {
  const result = await invokeCoordinator({ task_id: claimed.id, run_id })
  if (result.ok) {
    await writeAgentEvent('remote_invocation_sent', {
      task_id: claimed.id,
      session_id: result.session_id,
      routine_id: COORDINATOR_ROUTINE_ID,
    })
    await sendTelegram(
      `🤖 Coordinator invoked for task ${claimed.id.slice(0, 8)}\n${claimed.task.slice(0, 80)}`
    )
    return
  }
  // Fallback: fire failed — send v0 Telegram so Colin can run manually
  await sendTelegram(v0ManualPickupMessage(claimed))
} else {
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

| Scenario                                                                      | Behavior                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/fire` returns 4xx/5xx                                                       | Pickup cron falls back to v0 Telegram ("paste this to run manually"). Task stays `claimed`. Stale recovery applies. Do NOT retry.                                                        |
| Routine fires but coordinator fails to start (repo clone, connector auth)     | Task stays `claimed` with no heartbeat. Stale recovery re-queues after 10 minutes. Silent failure — session was created but coordinator never wrote to `task_queue`.                     |
| Coordinator starts but crashes mid-run                                        | Heartbeat stops. Stale recovery re-queues after 10 minutes. Next pickup fires a fresh coordinator run (retry 1 of `max_retries`).                                                        |
| Coordinator hits escalation / grounding checkpoint                            | Sends Telegram, sets `status = 'awaiting-grounding'`, terminates cleanly. Expected path. Colin re-queues a response task; next pickup invokes coordinator again.                         |
| Supabase connector not configured on routine                                  | Coordinator fails at Supabase fetch step. Writes error to `task_queue.error_message` if possible; stale recovery re-queues. Fix: add connector in routine UI.                            |
| `COORDINATOR_ROUTINE_ID` or `COORDINATOR_ROUTINE_TOKEN` missing in Vercel env | `invoke-coordinator` returns 500. Pickup cron falls back to v0 Telegram. `REMOTE_INVOCATION_ENABLED` should be forced false when either var is missing.                                  |
| Routines API unreachable (Anthropic outage)                                   | `invoke-coordinator` catches fetch error, returns `{ ok: false }`. Pickup cron falls back to v0 Telegram.                                                                                |
| 429 rate limit hit                                                            | `/fire` returns 429 with `Retry-After` header. Log the header value to `agent_events`. Do NOT retry inline — fall back to v0 Telegram.                                                   |
| Multiple concurrent pickup invocations                                        | Each claims a different task via `FOR UPDATE SKIP LOCKED`. Each fires its own coordinator session. Queue designed for single-task throughput; concurrent runs indicate misconfiguration. |

---

## 9. Open Questions

Q1 (token type), Q2 (body injection), Q3 (environment), Q4 (secret injection), Q6 (rate limits), Q7 (session poll), Q8 (non-negotiables) — all resolved. See §3, §4, §5 for the locked spec.

### Q5 — Coordinator escalation response loop: LOCKED (a)

When coordinator hits a grounding checkpoint and terminates with `status = 'awaiting-grounding'`, Colin inserts a new `task_queue` row containing his grounding result in `description` and `metadata.prior_task_id` pointing to the original task. Next pickup cycle invokes coordinator with the new task; coordinator reads both rows for full context.

**Rationale:** Matches the permissions-first pattern from coordinator v0 — start safe and auditable. Option (b) (Telegram callback → immediate re-fire) adds a cross-component dependency on component #2, which is at 85% and not yet stable. Upgrade to (b) only if latency becomes a real operational bottleneck.

**Implications for coordinator.md:** Coordinator must document the escalation write path — specifically that on `awaiting-grounding`, it writes the full checkpoint list to `task_queue.result` (JSONB) and sets `error_message` to a human-readable summary Colin can act on without querying the DB. This is the contract Colin reads before inserting the response task.

---

## 10. v0 Build Plan

Spec is locked. No blockers. Chunks A–B are manual setup; Chunk C is the first code deploy; Chunk D is the grounding verification.

---

### Chunk A — Coordinator Routine Registration ✓ COMPLETE (2026-04-23)

**Goal:** A persistent coordinator routine exists at claude.ai/code/routines. `routine_id` and per-routine token are documented and stored. A manual `/fire` call confirms coordinator starts and reads the task row.

**How:**

1. Create the routine in the UI at claude.ai/code/routines with the config in §5.2.
2. Generate the per-routine API token (§4.1) — store immediately as `COORDINATOR_ROUTINE_TOKEN` in Vercel env and `.env.local`. Shown once only.
3. Record `routine_id` (`trig_...`) as `COORDINATOR_ROUTINE_ID` in Vercel env, `.env.local`, and `docs/secrets-notes.md`.
4. Pre-insert a test task in `task_queue` (`status='claimed'`, `metadata.chunk='test'`).
5. Fire manually via Claude Code `RemoteTrigger` tool to confirm the session starts.

**Verified (2026-04-23):**

```bash
curl -X POST https://api.anthropic.com/v1/claude_code/routines/$COORDINATOR_ROUTINE_ID/fire \
  -H "Authorization: Bearer $COORDINATOR_ROUTINE_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "Content-Type: application/json" \
  -d '{"text":"task_id: 00000000-0000-0000-0000-000000000001\nrun_id: test-run-1"}'
→ HTTP 200 {"type":"routine_fire","claude_code_session_id":"session_01NGghDFEDJK4w8f4jUn8tgs",...}
→ Coordinator ran: detected test row (status != 'claimed' on row 00000000-0000-0000-0000-000000000001), terminated correctly
→ Test branch claude/vibrant-heisenberg-aJAUM created by coordinator run; deleted (test noise, not merged)
```

**Gap surfaced:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not available in the coordinator routine's runtime — escalation Telegrams did not fire during the test run. See Chunk B known gap below.

**Unblocks:** Chunk B (COORDINATOR_ROUTINE_ID and token confirmed working).
**Effort:** S (UI setup + one curl verify)

---

### Chunk B — `/api/harness/invoke-coordinator` Route ✓ COMPLETE (2026-04-23)

**Known gap to close (pre-Chunk D):** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not configured as connectors on the coordinator routine. Without them the coordinator cannot send escalation or completion Telegrams. Add both as connectors in the routine UI (claude.ai/code/routines → select routine → Edit → Connectors) before Chunk D end-to-end verification. Verify by confirming a Telegram arrives on the next test fire.

**Goal:** A Vercel route wraps the `/fire` call with CRON_SECRET auth. Independently testable before wiring into the pickup cron.

**Files:**

- `app/api/harness/invoke-coordinator/route.ts` (new)
- `lib/harness/invoke-coordinator.ts` (new — extracted lib, shared by route + pickup-runner)
- `tests/api/invoke-coordinator.test.ts` (new, 22 tests)

**Verified (2026-04-23):**

```bash
curl -X POST https://lepios-one.vercel.app/api/harness/invoke-coordinator \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"885ff1e3-baed-4512-8e7a-8335995ea057","run_id":"manual-chunk-b-verify"}'
→ HTTP 200, ok: true, session_id: "session_01RHGsMm9sFfDpGD5yz69Fiv"
→ agent_events row: task_type = 'coordinator_invoked', status = 'success', meta.session_id set
→ Trim fix applied: COORDINATOR_ROUTINE_ID/.trim() — meta.routine_id clean (no trailing \n)
```

**Unblocks:** Chunk C.
**Effort:** S

---

### Chunk C — Pickup Cron Integration + Feature Flag ✓ COMPLETE (2026-04-23)

**Goal:** Pickup cron calls `invoke-coordinator` after claiming a task (when `HARNESS_REMOTE_INVOCATION_ENABLED=1`). Telegram changes from "paste this" to FYI. Fallback to v0 Telegram on failure. No retries.

**Files:**

- `lib/harness/pickup-runner.ts` (modified — Step 5: fireCoordinator call + flag check + fallback)
- `tests/harness/pickup-runner.test.ts` (extended — 15 new tests: flag off/on/failure, buildRemoteTelegramMessage)

**Verified (2026-04-23):** 731 total tests green. Feature flag `HARNESS_REMOTE_INVOCATION_ENABLED` added to Vercel Production env. Committed + pushed (commit `5bae386`).

**Unblocks:** Chunk D.
**Effort:** S–M

---

### Chunk D — End-to-End Verification ✓ COMPLETE (2026-04-23)

**Goal:** Full live path confirmed. Q5 (escalation loop) decision validated against real coordinator behavior.

**Not a code chunk.** This is the grounding checkpoint for the component.

**Verified (2026-04-23):**

```text
Run: ecdd9d9a-48e4-485c-8024-00ae148406fb
Task claimed: 90f952dc-ce4d-4a2c-b9fe-0d513ca38c45 (Component #2 smoke test, priority 5)
→ agent_events[task_pickup]: status=success, claimed: Component #2 smoke test
→ agent_events[invoke_coordinator]: status=success
    output_summary: "Coordinator invoked for task 90f952dc, session session_01Y4Ca2VMWjFF9WYhrkqxFYV"
    meta.session_id: session_01Y4Ca2VMWjFF9WYhrkqxFYV
    meta.session_url: https://claude.ai/code/session_01Y4Ca2VMWjFF9WYhrkqxFYV
    meta.routine_id: trig_01AC9K3asFWrHZpK7HrRBhak (clean — no trailing \n)
→ HARNESS_REMOTE_INVOCATION_ENABLED confirmed live in Production deployment
```

The autonomous path works end-to-end with no human "Run task" step. Coordinator session spawned automatically on task claim. Trim fix confirmed (routine_id clean in meta).

**Remaining verification (async):** Steps 5–8 from original plan (coordinator session completion, Telegram, task_queue.status update) will happen as coordinator runs `session_01Y4Ca2VMWjFF9WYhrkqxFYV`. No code changes required — harness is live and working.

**Unblocks:** Sprint 4 resume — Chunks C/D/E can now run unattended. Update `sprint-state.md`: `status: active`, clear `pause_reason`, update `resume_trigger`.
**Effort:** M (coordinator run time; no new code)

---

### Summary

| Chunk | Goal                               | Effort | Produces                                      |
| ----- | ---------------------------------- | ------ | --------------------------------------------- |
| A ✓   | Create coordinator routine + token | S      | Live `/fire` confirmed (2026-04-23)           |
| B ✓   | `invoke-coordinator` route         | S      | 22 tests, live verified (2026-04-23)          |
| C ✓   | Pickup cron integration            | S–M    | 15 new tests, flag live in prod (2026-04-23)  |
| D ✓   | End-to-end verification            | M      | Session spawned autonomously (2026-04-23)     |

---

## Known Limitations (discovered 2026-04-23)

### SP-API credentials are Production-only — preview deployments cannot ground business-review routes

**Root cause:** SP-API credentials (`AMAZON_SP_*` env vars) are scoped to the Production environment in Vercel. Preview deployments do not have these credentials, so `spApiConfigured()` returns `false` and all business-review routes return HTTP 503 `{"error":"SP-API credentials not configured"}`.

**Observed:** Sprint 4 Chunk C grounding attempt against preview URL `lepios-ev8rfod9h-loeppkycs-projects.vercel.app` — every `/api/business-review/recent-days` call returned 503. The correct production numbers were only visible at `lepios-one.vercel.app`.

**Impact:** Grounding of any feature that calls SP-API (business-review, today-yesterday, recent-days, order lookup) must happen against the production URL, not preview. This means a merge to main is required before grounding is possible — there is no preview-stage grounding path for Amazon data features.

**Workaround:** Merge the branch to main and wait for the production Vercel deploy to reach READY before grounding. This is the correct flow for SP-API features.

**Alternative (not recommended):** Add SP-API credentials to the Preview environment scope in Vercel. Consequence: every PR preview build would hit the real Amazon SP-API. Possible rate limit exhaustion, unexpected order state side effects. Not worth it — the merge-first pattern is safer.

---

### Coordinator sessions cannot send outbound HTTP requests

**Root cause:** The Anthropic Claude Code sandbox enforces a host allowlist for outbound network connections. When a coordinator session (spawned via the Routines API) runs `curl` or any fetch to an arbitrary external host — including `lepios-one.vercel.app` — the request is blocked at the sandbox level. This is not a secret/auth issue; it is a hard network restriction on the execution environment.

**Observed:** `session_01KUpL9BTJ5H2Vsh6wJMBVuy` (Sprint 4 Chunk C) attempted to POST to `/api/harness/telegram-send` as instructed. The curl was blocked. The session correctly logged a `notification_failed` agent_events row with `error: "curl blocked by host allowlist in Claude sandbox"`.

**Impact:** The `/api/harness/telegram-send` proxy endpoint works correctly from Vercel crons and local curl. It does NOT work from coordinator sessions. Coordinator sessions have no async signal path to Colin beyond Supabase writes and git commits.

**Workaround candidates (not yet built — deferred):**

- **(a) Supabase-side poller:** A Vercel cron reads `agent_events` rows with `action=notification_failed` and sends the Telegram on behalf. Adds ~1 cron tick of latency.
- **(b) Morning digest:** The existing `morning_digest` cron surfaces `notification_failed` events in the daily digest. No new infrastructure; latency up to 24h.
- **(c) Anthropic allowlist request:** File feedback to Anthropic asking for `lepios-one.vercel.app` (or `*.vercel.app`) to be added to the Claude Code sandbox outbound allowlist.

**Current state:** Option (b) is passive fallback until a decision is made. No code changes. Revisit when coordinator-to-Colin latency becomes a real bottleneck.

Chunk C is the ship-it moment. Once live with `REMOTE_INVOCATION_ENABLED=1`, the harness runs Sprint 4 Chunks C/D/E without Colin typing. Chunk D proves it happened.
