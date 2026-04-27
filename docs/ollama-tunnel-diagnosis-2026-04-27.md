# Ollama Tunnel Diagnosis — 2026-04-27

## TL;DR

The tunnel was never configured. `OLLAMA_TUNNEL_URL` is not set in Vercel production. Every Ollama call from production falls through to `http://localhost:11434`, which doesn't exist in a Vercel serverless function. Ollama itself is healthy on the local machine. This is a missing env-var problem, not a tunnel hardware problem.

---

## 1 — Failure Evidence

**Query window:** last 12h from `agent_events` (UTC).

| Time (UTC)       | Action                        | Status  | Detail                                                              |
| ---------------- | ----------------------------- | ------- | ------------------------------------------------------------------- |
| 2026-04-26 19:03 | `ollama.config_warning`       | warning | "OLLAMA_TUNNEL_URL not set; using localhost fallback in production" |
| 2026-04-26 19:03 | `ollama.generate`             | failure | "Ollama unreachable" — 329ms                                        |
| 2026-04-26 19:03 | `ollama.embed`                | failure | "Ollama unreachable" — 34ms                                         |
| 2026-04-26 13:39 | `ollama.circuit_probe_failed` | failure | state=HALF_OPEN, reason=server_unreachable                          |
| 2026-04-26 13:39 | `ollama.health`               | failure | —                                                                   |
| 2026-04-26 13:39 | `ollama.config_warning`       | warning | (same — no tunnel URL)                                              |
| 2026-04-26 13:22 | `ollama.circuit_open`         | warning | 3 recent failures                                                   |
| 2026-04-26 13:22 | `ollama.circuit_skip` ×2      | warning | reason=circuit_open, recent_failures=3                              |
| 2026-04-26 13:22 | `ollama.generate` ×3          | failure | "Ollama unreachable"                                                |
| 2026-04-26 13:22 | `ollama.embed` ×4             | failure | "Ollama unreachable"                                                |

**Note on `tunnel_used: false`:** The successful health/embed events at 12:52–12:53 UTC had `tunnel_used: false` — those are local dev runs, not Vercel. In production, `tunnel_used` is never true because there is no tunnel URL to use.

**Historical scope (7-day rollup):**

| Date       | Hour (UTC)  | Failures             | Notes                                  |
| ---------- | ----------- | -------------------- | -------------------------------------- |
| 2026-04-21 | 06:00       | 2 embed              | Day 1 of production — already failing  |
| 2026-04-22 | 06:00       | 3 embed              | Nightly ingest                         |
| 2026-04-23 | 06:00       | 11 embed             | Nightly ingest                         |
| 2026-04-24 | 06:00       | 6 embed              | —                                      |
| 2026-04-24 | 12:00–13:00 | 15 generate          | Twin Q&A calls                         |
| 2026-04-24 | 21:00       | 4 embed + 4 generate | —                                      |
| 2026-04-25 | 03:00       | 126 embed            | HTTP 500 (Ollama running but erroring) |
| 2026-04-25 | 06:00       | 132 embed            | Nightly ingest — all fail              |
| 2026-04-25 | 11:00–12:00 | 18 embed             | HTTP 500 then unreachable              |
| 2026-04-26 | 12:00–19:00 | 29 total             | Circuit open twice                     |

**All-time:** 371 failures out of 2,336 ollama events (15.9% failure rate since 2026-04-19). Circuit has opened exactly twice.

---

## 2 — Tunnel Mechanism

**Implementation:** `lib/ollama/client.ts` — `getBaseUrl()` reads `process.env.OLLAMA_TUNNEL_URL` and strips trailing slashes. Falls back to `http://localhost:11434` if unset.

```typescript
const url = (process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434').replace(/\/$/, '')
```

**Expected tunnel type:** Cloudflare tunnel (per `.env.example` and CLAUDE.md Step 6.5 "OLLAMA_TUNNEL_URL wiring"). Planned but never deployed.

**Actual state:** `OLLAMA_TUNNEL_URL` is not set in Vercel. Every Vercel function call hits localhost and fails immediately (~30–55ms fail-fast, sometimes up to 799ms before timeout).

**`harness_config` check:** No OLLAMA or tunnel keys found in the `harness_config` table.

---

## 3 — Vercel Side Test

Cannot run a live curl from a Vercel function in this audit. Based on the event log, the answer is unambiguous: every production call to `/api/tags` (health check) and `/api/generate` returns a connection-refused or timeout equivalent. The 30–55ms failure duration is consistent with immediate ECONNREFUSED against localhost in Node.

The env var `OLLAMA_TUNNEL_URL` is **not present** in the Vercel project environment (evidenced by the `ollama.config_warning` events firing on every production cold start).

---

## 4 — Local Ollama Status

**Running:** Yes. `localhost:11434` responds to `/api/tags`.

**Models loaded:**

- `qwen2.5:32b` (19.8 GB, Q4_K_M) — primary generate model
- `qwen2.5-coder:7b` (4.7 GB) — code tasks
- `qwen2.5:7b` — general/fast
- `nomic-embed-text` — embedding model (critical path)
- `colin-assistant:latest`, `colin-analyst:latest` — custom models
- `gemma4:latest`, `llava:7b`, `llama3.1:8b`

Port 11434 is open and healthy. The machine is not the problem.

---

## 5 — Fallback Paths Currently Active

| Module                       | Primary (broken)              | Fallback (active)       | Degradation                                       |
| ---------------------------- | ----------------------------- | ----------------------- | ------------------------------------------------- |
| **Twin `/api/twin/ask`**     | Ollama embed → pgvector       | FTS keyword search      | Lower recall; misses semantic matches             |
| **Twin `/api/twin/ask`**     | Ollama generate (qwen2.5:32b) | Claude Sonnet 4.6       | Costs money; not Colin-tuned                      |
| **Knowledge nightly ingest** | Ollama embed → vector stored  | Row saved, no embedding | Twin knowledge base growing with zero-vector rows |
| **Purpose Review**           | Ollama generate (analysis)    | Claude Haiku            | Costs money                                       |
| **Work Budget estimator**    | Ollama refine (XL tasks only) | Heuristic fallback      | Slightly less accurate XL estimates               |

**night_tick:** Does NOT use Ollama. The claim that "night_tick is on Claude API fallback" appears to be inaccurate — codebase audit shows it performs only health/integrity checks with no Ollama dependency. It runs fine regardless of tunnel state.

---

## 6 — Cost of Status Quo

**Twin fallback traffic (last 24h):** 17 calls, all routed to Claude Sonnet 4.6. `tokens_used` and `cost_usd` fields are not being populated in `agent_events` (logging gap). Rough estimate:

- Avg call ~1,500 tokens in, ~300 tokens out
- Claude Sonnet 4.6: ~$3/MTok in, $15/MTok out
- 17 calls × (1,500 × $3/M + 300 × $15/M) = ~$0.076 + $0.077 = **~$0.15/day at current volume**

**At scale this is not the cost problem.** The real cost is quality degradation:

- The nightly knowledge ingest (`/api/knowledge/nightly` at 06:00 UTC) has been failing all embeds since day 1. Every new knowledge entry saved during the last 8 days has no vector. FTS degrades Twin answer quality by an unknown but likely significant margin.
- The Twin has been operating on FTS-only retrieval since its first production use. It has never used pgvector in production.

**Claude API spend:** Low in absolute terms (~$1–5/week at current usage). Not an emergency, but will grow with usage and the quality gap will widen as the knowledge base accumulates un-vectorized entries.

---

## 7 — Fix Options

### Option A — Set up Cloudflare tunnel (planned, Step 6.5)

**Effort:** Medium (~30–60 min) | **Durability:** High if auto-start configured

Steps:

1. Install `cloudflared` if not present
2. `cloudflared tunnel --url http://localhost:11434` — generates a `trycloudflare.com` URL
3. Set `OLLAMA_TUNNEL_URL=https://[generated].trycloudflare.com` in Vercel (all environments)
4. Add `cloudflared` to Windows startup (Task Scheduler or NSSM service) so tunnel survives reboots
5. Confirm production `ollama.health` returns `tunnel_used: true`

**Risk:** Cloudflare's free `trycloudflare.com` URLs are ephemeral — they change on every `cloudflared` restart. Either use a named tunnel (requires Cloudflare account) or update Vercel env on every restart (painful).

**Verdict:** Right approach, but the ephemeral URL problem makes the free tier fragile. Use a named tunnel for durability.

---

### Option B — ngrok (fast, temporary)

**Effort:** Low (~5 min) | **Durability:** Low (URL changes on restart unless paid plan)

Steps:

1. `ngrok http 11434`
2. Copy HTTPS forwarding URL → set as `OLLAMA_TUNNEL_URL` in Vercel
3. Done — tunnel is live

**Risk:** Free ngrok URLs change on every restart. Paid ngrok gives a static URL ($8–10/month). Same fragility concern as Option A free tier.

**Verdict:** Good for testing that the env-var fix works end-to-end. Not durable without a paid plan.

---

### Option C — Retire tunnel, route all inference to an API

**Effort:** High (half-day to full day) | **Durability:** Permanent

Options:

- **Groq:** Free tier, fast inference, OpenAI-compatible API. Qwen 2.5 32B not listed but Llama 3.3 70B available.
- **Together.ai or Fireworks.ai:** Qwen 2.5 32B available, ~$0.35–0.80/MTok
- **Self-host on VPS:** $5–20/month DigitalOcean/Hetzner, Ollama installed, public endpoint — no tunnel needed

**Verdict:** Correct long-term direction if the local machine becomes unreliable (power, sleep, ISP). Not warranted yet.

---

## 8 — Recommendation

**Fix now: Option A (named Cloudflare tunnel) + Option B as immediate unblock.**

Sequence:

1. Today — run ngrok to unblock production immediately and confirm the env-var fix works end-to-end.
2. This week — set up a named Cloudflare tunnel + Windows startup service so it survives reboots. Retire the ngrok URL once named tunnel is stable.
3. Backfill embeddings — after tunnel is live, run `/scripts/backfill-embeddings.ts` to vector-embed the 8 days of un-vectorized knowledge entries.

**Do not retire the local Ollama** — the machine is healthy, the models are loaded, and the cost of self-hosting inference is zero. The problem is purely the missing env-var and the missing startup automation.

---

## Appendix — Logging Gap

`tokens_used` and `cost_usd` are always null in `twin.ask` events. The fallback Claude call does not populate these fields. Recommend adding token accounting to `claudeFallback()` in `app/api/twin/ask/route.ts` so the real API cost is visible in morning_digest.
