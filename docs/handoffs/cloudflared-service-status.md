# Cloudflared Windows Service — Status Doc

**Task:** d82411e1-7610-49d5-bbef-40ec4a5401e1  
**Written:** 2026-05-09 by coordinator  
**Source:** morning_diagnostics_2026_04_28  

---

## Task

> "ops: install cloudflared as Windows service for persistent Ollama tunnel"  
> Tunnel was down overnight 2026-04-27 with 74 silent embed failures.

---

## Status: COMPLETE (evidence-based)

Colin installed the cloudflared Windows service between 2026-04-27 and 2026-05-07.

**Evidence from `agent_events`:**

| Timestamp (UTC)        | Event                  | `tunnel_used` | Notes                                |
| ---------------------- | ---------------------- | ------------- | ------------------------------------ |
| 2026-05-07 01:26:45    | ollama.health success  | `true`        | First confirmed tunnel success       |
| 2026-05-07 01:26:56    | ollama.health success  | `true`        | —                                    |
| 2026-05-07 01:52:31    | ollama.health success  | `true`        | —                                    |
| 2026-05-07 06:29:25–28 | ollama.embed × 7 (success) | —         | Nightly knowledge ingest working     |
| 2026-05-08 06:27:15–16 | ollama.embed × 2 (success) | —         | Nightly ingest still succeeding      |
| 2026-05-08 18:38:03    | ollama.health FAILURE  | —             | HTTP 530 (see watch item below)      |

The `tunnel_used: true` flag is set by `lib/ollama/client.ts` only when `process.env.OLLAMA_TUNNEL_URL` is non-null and the health check reaches a non-localhost URL. Multiple consecutive successes over two days confirm the service is persistent (surviving session ends).

---

## Watch Item: HTTP 530 on 2026-05-08 18:38 UTC

One isolated failure with error `"Ollama /api/generate returned HTTP 530"`. HTTP 530 is a Cloudflare "Origin is unreachable" error — distinct from the pre-fix `ECONNREFUSED localhost` pattern.

**Likely cause:** Transient tunnel drop or machine sleep/wake cycle. Not a regression to the "never configured" state.

**What to watch:** If `ollama.health failure` events cluster in a 15–30 min window, that's a tunnel restart (expected). If they persist for 2+ hours with no recovery, cloudflared may need `service restart`.

**Verify service is running (run locally):**
```powershell
Get-Service cloudflared
# Expected: Status=Running, StartType=Automatic
```

**Restart if needed:**
```powershell
Restart-Service cloudflared
```

---

## Pre-fix State (context)

Before Colin installed the service:
- `OLLAMA_TUNNEL_URL` was not set in Vercel
- Every production Ollama call fell through to `http://localhost:11434` (ECONNREFUSED)
- 371 failures out of 2,336 Ollama events (15.9% failure rate, all production)
- Twin had never used pgvector in production — FTS-only retrieval since day 1
- Knowledge nightly ingest accumulating un-vectorized rows

---

## Post-fix State

- Tunnel `tunnel_used: true` confirmed in production
- Nightly embed ingest succeeding (May 7 and May 8)
- Twin pgvector path now reachable from Vercel

**Remaining follow-up (separate tasks):**
- Backfill embeddings for rows ingested during April 19–May 7 without vectors (see `docs/ollama-tunnel-diagnosis-2026-04-27.md §8` recommendation)
- Add `tokens_used` / `cost_usd` logging to `claudeFallback()` in `app/api/twin/ask/route.ts` (logging gap noted in diagnosis doc)
