# Backfill: agent_events.task_type — 2026-04-20

## Context

Migration `0014_add_quality_scoring.sql` added `task_type TEXT` (nullable) to
`agent_events` as part of the feedback loop scoring system
(see `docs/feedback-loop-scoring.md` §6.1). The column was made nullable
intentionally to allow a backfill of existing rows before enforcing NOT NULL.

This runbook documents the backfill executed on 2026-04-20 to assign `task_type`
to all 57 pre-existing rows.

## Mapping rules applied

| action | domain | actor | task_type assigned | rationale |
|---|---|---|---|---|
| `night_tick` | `orchestrator` | `night_watchman` | `night_tick` | direct spec match |
| `morning_digest` | `orchestrator` | `night_watchman` | `morning_digest` | direct spec match |
| `scan` | `pageprofit` | `user` | `book_scan` | core pageprofit scan flow |
| `scan` | `pageprofit` | `acceptance-test` | `book_scan` | same action, test actor — same scoring bucket |
| `bsr_sparkline` | `pageprofit` | `user` | `book_scan` | sub-action of scan card flow, same domain/purpose |
| `ollama.embed` | `ollama` | `system` | `ollama_embed` | discrete embedding operation |
| `ollama.generate` | `ollama` | `system` | `ollama_generate` | discrete generation operation |
| `ollama.health` | `ollama` | `system` | `ollama_health` | health probe, distinct from generate/embed |
| `metrics.digest` | `system` | `cron` | `legacy_untyped` | see note below |

## Row counts updated

| task_type | rows |
|---|---|
| `ollama_embed` | 27 |
| `book_scan` | 19 |
| `night_tick` | 5 |
| `ollama_generate` | 2 |
| `ollama_health` | 2 |
| `legacy_untyped` | 1 |
| `morning_digest` | 1 |
| **Total** | **57** |

## Execution

Run as a single transaction with a safety guard:

```sql
BEGIN;
-- ... 9 UPDATE statements (one per mapping rule above) ...
DO $$ DECLARE null_count INTEGER; BEGIN
  SELECT COUNT(*) INTO null_count FROM agent_events WHERE task_type IS NULL;
  IF null_count != 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows still NULL — rolling back', null_count;
  END IF;
END $$;
COMMIT;
```

Safety check result after COMMIT: `null_count = 0` ✅

## Note on legacy_untyped

The 1 row with `task_type = 'legacy_untyped'` has `action = 'metrics.digest'`,
`domain = 'system'`, `actor = 'cron'`. This corresponds to a pre-Step-6 metrics
cron route (`/api/metrics/digest`) that appears in `vercel.json` but has no
implementation in the current codebase.

If this code path is revived, the `legacy_untyped` rows should be re-backfilled
with an appropriate task_type (likely `metrics_digest`) and a new mapping rule
added to the scoring config. Do not leave `legacy_untyped` as a permanent type
in production trend views — it will pollute scoring baselines.
