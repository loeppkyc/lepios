# GPU Day Checklist

**Purpose:** Step-by-step checklist for the day Colin upgrades the local GPU and promotes Ollama from 7B (current) to 32B as the primary inference model.

**Trigger:** Run this checklist when a new GPU is installed and verified. Do not run speculatively.

**Last updated:** 2026-05-14

---

## Pre-Conditions (must be true before starting)

- [ ] New GPU installed, drivers verified (`nvidia-smi` shows correct VRAM)
- [ ] GPU Day readiness score ≥ 95% in `docs/gpu-day-readiness.md`
- [ ] Harness running clean: 3 consecutive overnight ticks with status = completed
- [ ] Daytime tick running clean: 3 consecutive days with status = completed (A4 criterion)
- [ ] `DAYTIME_TICK_ENABLED=1` already set in Vercel (otherwise daytime tick has no baseline)
- [ ] Cloudflare tunnel (`cloudflared`) service confirmed running: `sc query cloudflared`

---

## Phase 1 — Verify Hardware

```powershell
# Confirm GPU is detected
nvidia-smi

# Check available VRAM
nvidia-smi --query-gpu=memory.total,memory.free --format=csv
```

Expected: ≥ 24 GB VRAM free before any models loaded.

---

## Phase 2 — Pull and Verify Models

```bash
# Pull the 32B model (takes time — start this first)
ollama pull qwen2.5:32b

# Verify it's available
ollama list

# Quick smoke test — should respond in < 10s on new GPU
ollama run qwen2.5:32b "Respond with only: GPU Day OK"
```

Expected: model loads in < 5s from VRAM (not disk). Response in < 10s total.

Keep the existing 7B model as fallback:

```bash
ollama list
# qwen2.5-coder:7b should still appear
```

---

## Phase 3 — Record Baseline Speed

Run a timed benchmark and record in `docs/gpu-day-readiness.md` under A3:

```bash
# Time a representative code task (matches A3 benchmark format)
time ollama run qwen2.5-coder:7b "Write a TypeScript function that returns the current UTC time as an ISO string."
```

Record: wall time, eval_count, tok/s. Compare against baseline of **8.14 tok/s** (2026-04-27 on integrated GPU).

Target on dedicated GPU: ≥ 30 tok/s for 7B, ≥ 15 tok/s for 32B.

---

## Phase 4 — Update Ollama Config

The harness uses `autoSelectModel('analysis')` which resolves to `OLLAMA_ANALYSIS_MODEL` env var.

Check current value:

```bash
# In Vercel dashboard or via Supabase
SELECT value FROM harness_config WHERE key = 'OLLAMA_ANALYSIS_MODEL';
```

If it returns `qwen2.5-coder:7b` or is unset, update it:

```sql
UPDATE harness_config SET value = 'qwen2.5:32b' WHERE key = 'OLLAMA_ANALYSIS_MODEL';
-- If row doesn't exist:
INSERT INTO harness_config (key, value) VALUES ('OLLAMA_ANALYSIS_MODEL', 'qwen2.5:32b');
```

Also check `OLLAMA_DAYTIME_MODEL` (used by daytime-tick):

```sql
-- Should be qwen2.5:32b for full GPU Day
SELECT value FROM harness_config WHERE key = 'OLLAMA_DAYTIME_MODEL';
```

---

## Phase 5 — Smoke Test Tunnel + Models

Invoke the daytime tick manually to verify the full stack:

```bash
curl -X GET https://lepios-one.vercel.app/api/cron/daytime-tick \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response:

```json
{
  "status": "completed",
  "checks": [
    { "name": "ollama_health", "status": "pass" },
    { "name": "signal_review", "status": "pass" },
    { "name": "site_health", "status": "pass" }
  ],
  "meta": { "tunnel_used": true, "ollama_model": "qwen2.5:32b" }
}
```

If `ollama_health` fails: verify tunnel is running, verify model is pulled.

If `signal_review` shows `"status": "warn"` with "timed out": model is cold-loading. Run again after 60s — should warm up on second call.

Verify the row in Supabase:

```sql
SELECT
  occurred_at,
  status,
  meta->>'ollama_model' AS model,
  meta->>'tunnel_used' AS tunnel,
  quality_score->>'aggregate' AS score
FROM agent_events
WHERE task_type = 'daytime_tick'
ORDER BY occurred_at DESC
LIMIT 3;
```

---

## Phase 6 — Update Triage Rubric

Open `docs/ollama-triage.md` and update:

1. Add 32B to the "Known Good Tasks" table for any task that was previously 7B-only
2. Update F18 metric targets for the new GPU (wall time targets change)
3. Record the new baseline tok/s

---

## Phase 7 — Update GPU Day Readiness Tracker

In `docs/gpu-day-readiness.md`:

- A3: Record new tok/s benchmark (overwrite 2026-04-27 entry)
- A4: Mark 100% once 3 clean overnight ticks confirm no 530s
- A7: Review GPU swap path doc — update model config diff table with actual values

Recompute total and bump "Last updated."

---

## Go / No-Go Criteria

| Check                                          | Go  | No-Go                               |
| ---------------------------------------------- | --- | ----------------------------------- |
| `nvidia-smi` shows ≥ 24 GB VRAM                | Yes | Stop — hardware not ready           |
| `qwen2.5:32b` listed in `ollama list`          | Yes | Pull again                          |
| Daytime tick smoke test: status = "completed"  | Yes | Debug tunnel or model               |
| `tunnel_used: true` in response                | Yes | Set `OLLAMA_TUNNEL_URL` in Vercel   |
| tok/s ≥ 15 for 32B                             | Yes | Record as-is and note the shortfall |
| Night tick: no new failures after model change | Yes | Roll back model change              |

---

## Rollback

If daytime ticks start failing after model upgrade:

1. Set `OLLAMA_DAYTIME_MODEL` back to `qwen2.5-coder:7b` in harness_config
2. Set `OLLAMA_ANALYSIS_MODEL` back to `qwen2.5-coder:7b` (or unset for default)
3. Verify next daytime tick completes with status = "completed"
4. File a task in task_queue: "Debug 32B load failure on new GPU"

The 7B fallback is always available — rollback takes < 2 minutes.

---

## Post-GPU-Day Tasks to Queue

After all Go criteria are met, queue these:

- [ ] Expand daytime tick to 3× per day (10:00, 14:00, 19:00 MT) — spec in harness-step-6.5-ollama-daytime-tick.md §4
- [ ] Enable LLM-based quality scoring (feedback-loop-scoring.md §11.3) — now unblocked
- [ ] Re-evaluate knowledge_dedupe routing: was tiered at 32B, confirm 32B handles it reliably
- [ ] Update `docs/ollama-triage.md` Known Good table with GPU Day validation results
