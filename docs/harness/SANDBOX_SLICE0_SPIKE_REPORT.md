# Sandbox Slice 0 — Spike Report: process.kill(-pgid) on Vercel

**Purpose:** Confirm or rule out AD3 (timeout + process-group kill) before
any Slice 1 sandbox code is written. Result determines which runtime path
Slice 1 uses: AD3 confirmed, R-A (local-only), or R-B (GNU timeout wrapper).

---

## Spike date

Date run: 2026-05-02

---

## Local result (Colin's machine)

**Platform:** win32 (Windows 11 Home 10.0.26200)
**Node version:** v24.14.0

**Result:** `fails` — expected.

`process.kill(-pgid)` is a POSIX process-group signal and is not supported on
Windows native Node. The negative-PID form requires `setpgid` semantics that
Windows does not implement. On Windows, Node throws `ESRCH` (no such process)
rather than `ENOSYS` — it treats the negative PID as an unknown process ID, not
as a process group. This is not an architecture problem: the sandbox layer will
run on Linux (Vercel / future GPU box), not Windows directly.

Note: `bash` was accessible (Git Bash), so spawn succeeded — only the kill step
failed, as expected.

**Script output:**

```json
{
  "localResult": "fails",
  "error": "process.kill(-31840, 'SIGTERM') threw: kill ESRCH",
  "pid": 31840,
  "pgid": 31840,
  "killLatencyMs": 1
}
```

---

## WSL / Git Bash result (if tested)

<!-- Optional: run in WSL terminal and paste output -->

**Result:** _TBD_

---

## Vercel result

**Trigger:** `POST /api/sandbox-spike` with `Authorization: Bearer <CRON_SECRET>`
and env var `SANDBOX_SPIKE_ENABLED=1` set in Vercel project settings.

```bash
curl -s -X POST https://lepios-one.vercel.app/api/sandbox-spike \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

**Response:**

```json
{
  "runtime": "vercel",
  "result": "works",
  "pid": 12,
  "pgid": 12,
  "killLatencyMs": 100,
  "processStillAlive": false
}
```

**Result:** `works` — AD3 confirmed.

---

## Decision

**AD3 confirmed** — `process.kill(-pgid, 'SIGTERM')` works on Vercel's Linux
runtime. Kill latency: 100 ms. Slice 1 acceptance D (timeout enforcement +
process-group kill) is implementable. Proceed to Slice 1.

---

## Colin sign-off

- [x] Local result recorded
- [x] Vercel result recorded
- [x] Decision selected above
- [x] Spike route removed (or `SANDBOX_SPIKE_ENABLED` unset) before Slice 1 PR opens
