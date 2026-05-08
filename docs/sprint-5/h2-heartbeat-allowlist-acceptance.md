# H2 — Coordinator Heartbeat: Status Filter Fix + Cloud Fallback

**Hardening ID:** H2  
**Source:** postmortem_915d1fee (`docs/autonomous-loop-postmortem-2026-04-27.md`)  
**Task ID:** 646424f9-a032-4669-a9e2-77ee10b976f6  
**Written by:** coordinator (2026-05-08)  
**Weight:** 1  

---

## Scope

Fix coordinator heartbeats so they land reliably during active sessions. Two bugs found during coordinator study (task 646424f9):

**Part A — Route status filter (builder fix, ~5 min):**  
`app/api/harness/task-heartbeat/route.ts` line 40 filters `.eq('status', 'claimed')`. The coordinator updates task status to `running` at startup (per coordinator.md step 5), so every subsequent heartbeat returns `{ok: false, error: "task not found or not claimed"}`. Fix: accept `claimed | running`.

**Part B — Cloud sandbox network fallback (coordinator.md update, Colin approval required):**  
The cloud coordinator sandbox blocks outbound HTTP to `lepios-one.vercel.app` at the infrastructure level. The `.claude/settings.json` allowlist (`"Bash(curl https://lepios-one.vercel.app/*)"`, network `allowedDomains`) applies to local CLI sessions but not to cloud runtime. Even after Part A ships, cloud coordinators will still get "Host not in allowlist" on every heartbeat curl. Fix: coordinator.md Non-negotiable #6 needs a Supabase MCP fallback — direct `execute_sql` UPDATE on `task_queue.last_heartbeat_at` — as the primary heartbeat path in cloud mode.

**Acceptance criterion:** A coordinator session running in cloud mode shows ≥3 `task_queue.last_heartbeat_at` bumps within a 15-minute run window, with matching `agent_events` rows (`action='task_heartbeat', status='success'`).

---

## Out of Scope

- H1 (drain 403 — separate task, acceptance doc exists)
- H3 (pickup ordering — already shipped)
- Changing the cloud sandbox infrastructure network policy (not under our control; the MCP fallback works around it)
- Adding a new heartbeat route for MCP (unnecessary — direct SQL UPDATE is sufficient)

---

## Check-Before-Build Findings

| Item | Finding |
|------|---------|
| Heartbeat route | `app/api/harness/task-heartbeat/route.ts` — exists, status filter bug at line 40 |
| Settings allowlist | `.claude/settings.json` has `"Bash(curl https://lepios-one.vercel.app/*)"` and `allowedDomains: ["lepios-one.vercel.app"]` — correct for local, ineffective in cloud |
| Existing tests | `tests/harness/task-pickup-100.test.ts` has happy-path test for `claimed` status, 0-rows test, auth tests — no test for `running` status |
| Coordinator.md | Non-negotiable #6 uses bash curl only — no Supabase MCP fallback |
| Prior H2 doc | None — this is the first acceptance doc for H2 |

---

## Files Expected to Change

**Part A (builder):**
- `app/api/harness/task-heartbeat/route.ts` — line 40: `.eq('status', 'claimed')` → `.in('status', ['claimed', 'running'])`
- `tests/harness/task-pickup-100.test.ts` — add test: heartbeat succeeds for task with `status='running'`

**Part B (Colin sign-off on coordinator.md edit, then coordinator.md update):**
- `.claude/agents/coordinator.md` — Non-negotiable #6: add Supabase MCP heartbeat as primary path in cloud mode, HTTP curl as local fallback. See proposed protocol below.

---

## Part A — Route Fix (Builder Implementation)

Exact change to `route.ts`:

```diff
- .eq('status', 'claimed')
+ .in('status', ['claimed', 'running'])
```

Exact test to add to `task-pickup-100.test.ts` (in the `task-heartbeat route — happy path` describe block):

```ts
it('succeeds for task with status running (coordinator active session)', async () => {
  const { POST } = await import('@/app/api/harness/task-heartbeat/route')
  const updateSelectChain = makeUpdateSelectChain([{ id: TASK_UUID }])

  mockFrom.mockImplementation((table: string) => {
    if (table === 'task_queue') return updateSelectChain
    if (table === 'agent_events') return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    return makeInsertBuilder()
  })

  const request = new Request('https://lepios-one.vercel.app/api/harness/task-heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' },
    body: JSON.stringify({ task_id: TASK_UUID, run_id: 'run-running-test' }),
  })

  const response = await POST(request)
  const body = await response.json()
  expect(body.ok).toBe(true)
})
```

---

## Part B — Coordinator.md Protocol Update (Proposed — Colin Approval Required)

Replace Non-negotiable #6's heartbeat bash block with a two-path protocol:

**Primary path (cloud mode — Supabase MCP, always works):**
```sql
-- Heartbeat via MCP (use at every 3-min checkpoint):
UPDATE task_queue SET last_heartbeat_at = NOW() WHERE id = '<task_id>';
-- Then log to agent_events:
INSERT INTO agent_events (domain, action, actor, status, meta, occurred_at)
VALUES ('orchestrator', 'task_heartbeat', 'coordinator', 'success',
        '{"task_id": "<task_id>", "run_id": "<run_id>", "path": "mcp"}'::jsonb, NOW());
```

**Secondary path (local dev only — HTTP curl, works when sandbox allows):**
```bash
_CS=$(cat /tmp/coordinator-secret 2>/dev/null || echo "")
curl -s -X POST https://lepios-one.vercel.app/api/harness/task-heartbeat \
  -H "Authorization: Bearer ${_CS}" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\": \"<task_id>\", \"run_id\": \"<run_id>\"}"
unset _CS
```

**Protocol:** use MCP path always; use HTTP curl additionally if CRON_SECRET is available in `/tmp/coordinator-secret`. MCP path is the reliable one; HTTP is best-effort confirmation.

**Open question for Colin:** Should the HTTP path be removed entirely (simpler, one path), or kept as belt-and-suspenders for local sessions where the HTTP route adds agent_events logging? Recommendation: MCP only — the route's agent_events insert is redundant when the coordinator does it directly.

---

## External Deps Tested

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/harness/task-heartbeat` (local) | Not tested — no local server running | Verified route code at `app/api/harness/task-heartbeat/route.ts` |
| `POST /api/harness/task-heartbeat` (production) | `Host not in allowlist` from cloud sandbox | Confirmed infrastructure gap |
| Supabase MCP `execute_sql` | ✓ Working in this session | Used for task status updates successfully |

---

## Grounding Checkpoint

Colin verifies after deploy:

1. **Route fix:** `curl -s -X POST https://lepios-one.vercel.app/api/harness/task-heartbeat -H "Authorization: Bearer {CRON_SECRET}" -H "Content-Type: application/json" -d '{"task_id": "<any-running-task-id>"}'` → returns `{ok: true}` (currently returns `{ok: false, error: "task not found or not claimed"}`)
2. **Test coverage:** `npm test -- --testPathPattern=task-pickup-100` passes with new 'running' test case
3. **Cloud MCP heartbeat:** `SELECT last_heartbeat_at FROM task_queue WHERE id = '646424f9-a032-4669-a9e2-77ee10b976f6'` — verify it's been bumped every ~3 min during this coordinator session (coordinator manually does MCP heartbeats in the current session per this doc's protocol, pending coordinator.md update)

---

## Kill Signals

- If the route fix introduces regression on the existing 'task not found or not claimed' test → revert, re-examine filter logic
- If coordinator.md protocol update is rejected by Colin → Part A still ships standalone; heartbeats will work for local sessions but cloud sessions will continue using MCP-only (which works now)

---

## Cached-Principle Decisions

None. META-C not applied — no existing principle matches this fix pattern. Escalating to Colin per META-C condition (a) failure: trigger doesn't match any cached principle exactly.

---

## Open Questions

1. **coordinator.md update scope:** Should the HTTP heartbeat path be removed entirely in favor of MCP-only, or kept as a parallel path? (Recommendation: MCP-only — simpler, more reliable in all environments.)
2. **Task status 'claimed' vs 'running':** The original coordinator.md step 5 says to UPDATE status to 'running'. Should heartbeats also accept `awaiting-grounding`? (Recommendation: no — coordinator stops working when awaiting-grounding, no heartbeats needed.)

---

## Numeric Field Definitions

N/A — no SP-API financial data.
