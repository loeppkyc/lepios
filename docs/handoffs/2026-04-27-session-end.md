# Handoff — 2026-04-27 Session End

**Written:** 2026-04-27
**Status:** Production healthy. Three deferred items. Safe to stop.

---

## 1 — Production State Right Now

- **Last deployed commit:** `b6d37d0` — `test(task-pickup): add route integration test — rescued from closed PR #9`
- **Vercel:** green on `main`, auto-deploy clean
- **FTS fallback:** live in production for the first time — twin search hits keyword layer when embedding distance exceeds threshold
- **Twin mode:** degraded — Ollama tunnel is down, 8/8 `ollama.generate` calls failed in last 6h; FTS fallback is covering all twin queries
- **Hourly crons:** zero in `vercel.json` — `notifications-drain` reverted to daily (`0 1 * * *`), `task-pickup` daily (`0 0 * * *`); no Vercel Hobby limit exposure

---

## 2 — Three Open Items

### 2a — Task 8cba5a75 stuck in `claimed` status

`invoke_coordinator` errored twice during task pickup. Task never advanced to `in_progress`. Root cause unknown — could be harness_config read failure, coordinator spec mismatch, or upstream error in the orchestration loop.

**To unstick:**

1. Query: `SELECT id, status, task, metadata, claimed_at FROM task_queue WHERE id = '8cba5a75%'` (or search by status)
2. Check `agent_events` for `action='invoke_coordinator_error'` around the claimed_at timestamp
3. If error is diagnosable: fix root cause, reset status to `'queued'`, let night_tick repick
4. If not diagnosable after one look: manually set `status='failed'`, log findings to `agent_events`, move on

### 2b — Ollama tunnel down

8/8 `ollama.generate` failures in the last 6h. FTS fallback is covering twin queries so the product is functional. But night_tick LLM checks are degraded — any quality scoring or synthesis that requires Ollama is silently skipped.

**This is a separate session** — do not attempt to fix inline with other work. Requires checking tunnel config (`OLLAMA_TUNNEL_URL` in `harness_config`), confirming the local Ollama process is running, and verifying the tunnel endpoint is reachable from Vercel.

### 2c — Hourly drain decision deferred

Vercel Hobby plan rejects hourly crons. Two options remain on the table:

- **Option A:** Upgrade to Vercel Pro (~$20/mo) — unblocks hourly `notifications-drain` and any other sub-daily crons
- **Option B:** `task-pickup` self-invokes drain immediately post-run — no plan upgrade needed, but drain only fires when tasks are picked up, not on a fixed schedule

No urgency — daily drain is working, no messages are being lost. Decision is Colin's call.

---

## 3 — What Was Shipped Today

| Commit    | Description                                                              |
| --------- | ------------------------------------------------------------------------ |
| `13bfb44` | `route-health` smoke test module — 25 tests, standalone, not yet wired   |
| `9a4a255` | Deploy smoke tests scope doc                                             |
| `344ca13` | F19→F20 design-system rule renumber across 6 files                       |
| `6e60620` | CLAUDE.md re-ingest — 27 new chunks, 80 total in Twin knowledge store    |
| `5b183a5` | `vercel.json` revert — notifications-drain and task-pickup back to daily |
| `b6d37d0` | Route integration test rescued from closed PR #9                         |

**Key milestone:** FTS fallback is live in production for the first time. Twin is functional in degraded mode without Ollama. Deploy stall was diagnosed (root cause: PR #9 notifications-drain hourly cron rejected by Hobby plan) and unblocked. PR #9 was closed cleanly; the integration test was rescued onto main directly.

---

## 4 — Resume Order

**(a) Unstick task 8cba5a75** — query `task_queue` + `agent_events`, diagnose `invoke_coordinator` error, reset or fail the task. Time estimate: 15–30 min.

**(b) Ollama tunnel** — separate session. Check tunnel config, verify local process, confirm endpoint reachability from Vercel. Do not mix with (a).

**(c) Hourly drain decision** — Colin decides Option A or B, then implement whichever. Low urgency.

---

## 5 — Window States at Stand-Down

- **W1:** Stood down mid-session. `cron-registration` smoke test module not yet built. Resume when deploy stall is confirmed clear and W2 gate condition met.
- **W2:** `route-health` shipped. Awaiting `cron-registration` from W1 before wiring deploy-gate integration. See `docs/handoffs/2026-04-27-w2.md` for full next-steps.
- **W3:** CLAUDE.md re-ingest complete. Manual digest run pending — see `docs/handoffs/2026-04-27-w3.md` for exact queries and endpoint.
