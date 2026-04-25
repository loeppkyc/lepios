# Coordinator Runtime Environment — Acceptance Doc

**Sprint:** 5
**Chunk:** coordinator-env
**Date:** 2026-04-25
**Status:** awaiting-colin-approval (cache_match_enabled=false, Sprint 4 baseline)
**Study doc:** docs/sprint-5/coordinator-env-study.md
**Colin approval required before builder starts.**

---

## Scope

Create a `harness_config` key-value table in Supabase, populate it manually with
`CRON_SECRET` and `TELEGRAM_CHAT_ID`, and update `coordinator.md` with a startup
config-fetch block so the coordinator can read these values at runtime.

**One acceptance criterion:** After Colin inserts the two rows and runs a coordinator
invocation, a Telegram message appears in the LepiOS channel AND a heartbeat row
appears in `task_queue.last_heartbeat_at` for the active task.

---

## Out of Scope

- Encrypting values in harness_config beyond Supabase DB-at-rest encryption (Colin approved plaintext for solo-operator)
- Adding CRON_SECRET to the fire payload (Option A — rejected in favour of harness_config)
- Any change to the Vercel env var configuration
- Adding other config keys beyond CRON_SECRET and TELEGRAM_CHAT_ID in v1
- Changing how Vercel routes validate CRON_SECRET (no change to Next.js auth guards)

---

## Files Expected to Change

| File | Change |
|------|--------|
| `supabase/migrations/0029_harness_config.sql` | CREATE TABLE harness_config + RLS |
| `.claude/agents/coordinator.md` | Add Phase 0 startup config-fetch block |

**No application code changes.** harness_config is read by the coordinator (bash curl),
not by any Next.js route. No TypeScript files affected.

---

## Check-Before-Build Findings

- `harness_config` table: does not exist (confirmed via `information_schema.tables` query)
- Existing secret storage pattern: none in Supabase — CRON_SECRET, TELEGRAM_CHAT_ID are
  purely Vercel env vars today
- Nearest analogous migration: `0015_add_task_queue.sql` for RLS pattern (authenticated)
- Target RLS pattern: ENABLE ROW LEVEL SECURITY + no permissive policies for anon/authenticated
  → service_role bypasses RLS by default in Supabase (BYPASSRLS privilege)

---

## Migration Spec: 0029_harness_config.sql

```sql
-- 0029_harness_config.sql
-- Creates harness_config key-value store for coordinator runtime secrets.
-- service_role-only access via Supabase RLS bypass (BYPASSRLS privilege).
-- Colin manually inserts CRON_SECRET and TELEGRAM_CHAT_ID rows — no seeding in migration.
-- Explicit Colin approval: task_queue 87bc8578 metadata.review_action='approved' 2026-04-25.

CREATE TABLE public.harness_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS — no permissive policies created for anon or authenticated.
-- service_role has BYPASSRLS privilege in Supabase → can always read.
ALTER TABLE public.harness_config ENABLE ROW LEVEL SECURITY;

-- Rollback:
--   DROP TABLE IF EXISTS public.harness_config;
```

**Schema rationale:**
- `key TEXT PRIMARY KEY` — simple lookup, no UUID needed
- `value TEXT NOT NULL` — plaintext; DB-at-rest encryption covers storage layer
- `description TEXT` — human-readable label for Colin when browsing Supabase dashboard
- `updated_at TIMESTAMPTZ` — Colin can verify when a value was last rotated

---

## coordinator.md Update Spec

Add the following as a new **Phase 0 — Fetch Runtime Config** section, inserted
immediately before the current "Phase 0 — Cache-match eligibility gate" section
(renaming that section "Phase 0b" to preserve ordering). Alternatively, rename the
new block "Startup — Fetch Runtime Config" to avoid phase numbering collision.

**Preferred approach:** name it "Startup block" so it's clearly pre-phase.

Insert at the top of the "# What you do (the loop)" section, before Phase 0:

```markdown
## Startup — Fetch Runtime Config

Before any phase work: fetch CRON_SECRET and TELEGRAM_CHAT_ID from harness_config.
These are not in the coordinator shell environment; they live in Supabase.

```bash
HARNESS_CFG=$(curl -s \
  "${SUPABASE_URL}/rest/v1/harness_config?key=in.(CRON_SECRET,TELEGRAM_CHAT_ID)&select=key,value" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>/dev/null || echo "[]")

CRON_SECRET=$(echo "$HARNESS_CFG" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); v={r['key']:r['value'] for r in d}; print(v.get('CRON_SECRET',''))" \
  2>/dev/null)

TELEGRAM_CHAT_ID=$(echo "$HARNESS_CFG" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); v={r['key']:r['value'] for r in d}; print(v.get('TELEGRAM_CHAT_ID',''))" \
  2>/dev/null)

# Audit log — keys fetched, no values
curl -s -X POST "${SUPABASE_URL}/rest/v1/agent_events" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$(python3 -c 'import uuid; print(uuid.uuid4())')\",
    \"domain\": \"harness\",
    \"action\": \"harness_config.read\",
    \"actor\": \"coordinator\",
    \"task_type\": \"config_fetch\",
    \"status\": \"$([ -n '$CRON_SECRET' ] && [ -n '$TELEGRAM_CHAT_ID' ] && echo success || echo partial)\",
    \"output_summary\": \"Fetched harness_config at startup\",
    \"meta\": {\"keys_fetched\": [\"CRON_SECRET\", \"TELEGRAM_CHAT_ID\"], \"cron_secret_present\": $([ -n '$CRON_SECRET' ] && echo true || echo false), \"chat_id_present\": $([ -n '$TELEGRAM_CHAT_ID' ] && echo true || echo false)}
  }" > /dev/null 2>&1 || true
```

If CRON_SECRET or TELEGRAM_CHAT_ID remains empty after this block: continue with
existing graceful degradation (heartbeat_skipped logged, notification_insert_failed
logged). Do NOT abort. The stale window is 15 minutes; the coordinator can complete
one full phase before timeout even with no heartbeat.
```

---

## External Deps Tested

None — this chunk has no external API dependency. It uses only:
- Supabase REST API (already used extensively in coordinator)
- coordinator.md (file edit only)

---

## F17 Justification

Every coordinator run that successfully sends a Telegram notification is a signal:
Colin deployed a coordinator invocation, it completed, and he was notified. The
approve/reject/ignore rate of those notifications is a path-probability training
signal. Zero notifications = zero signal. This chunk restores the signal path.

---

## F18 Measurement

| Metric | Formula | Source table | Target |
|--------|---------|--------------|--------|
| notification_delivery_latency_p50 | p50(sent_at - created_at) | outbound_notifications | < 60s |
| notification_delivery_latency_p95 | p95(sent_at - created_at) | outbound_notifications | < 300s |
| harness_config.read success rate | COUNT(status='success') / COUNT(*) WHERE action='harness_config.read' | agent_events | 100% after initial population |

Query to surface p50/p95 latency:
```sql
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at - created_at))) AS p50_seconds,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at - created_at))) AS p95_seconds,
  COUNT(*) AS total_sent
FROM outbound_notifications
WHERE sent_at IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days';
```

Colin can ask "how are notifications doing?" and get p50/p95 + count from this query.

---

## Grounding Checkpoint

**Physical-world verification (cannot be tests-pass):**

Colin must:
1. Run the migration: `supabase db push` or apply 0029_harness_config.sql to production
2. Insert rows manually (Supabase dashboard or psql — not via agent):
   ```sql
   INSERT INTO harness_config (key, value, description)
   VALUES
     ('CRON_SECRET', '<actual-value>', 'Bearer token for Vercel cron/harness routes'),
     ('TELEGRAM_CHAT_ID', '<actual-value>', 'LepiOS Telegram channel chat ID');
   ```
3. Trigger a coordinator invocation (queue any task, let it claim)
4. Verify: `SELECT last_heartbeat_at FROM task_queue WHERE status = 'running' ORDER BY claimed_at DESC LIMIT 1` — should be a recent timestamp
5. Verify: Telegram message received in the LepiOS channel from the run

**Pass:** heartbeat updated + Telegram received
**Fail:** either missing → CRON_SECRET or TELEGRAM_CHAT_ID row may be wrong value;
check agent_events WHERE action='harness_config.read' for status and meta

---

## Kill Signals

- Migration causes RLS lockout of existing harness routes → rollback immediately (`DROP TABLE IF EXISTS public.harness_config`)
- outbound_notifications rows multiply unexpectedly (coordinator re-queuing on fetch failure) → check coordinator startup block graceful degradation
- harness_config query adds >500ms to coordinator startup → acceptable (one curl, non-blocking path)

---

## Cached-Principle Decisions

**Cache-match disabled** (cache_match_enabled=false, Sprint 4 baseline carry-forward per sprint-state.md).
All decisions escalate to Colin.

Decisions requiring Colin approval:
1. harness_config stores CRON_SECRET as plaintext TEXT — Colin approved (task 87bc8578 metadata.q3_answer: "Acceptable for solo-operator harness")
2. TELEGRAM_CHAT_ID stored in harness_config — Colin approved (task 87bc8578 metadata.q2_answer: "Yes — harness_config table with service-role-only RLS. TELEGRAM_CHAT_ID is not a secret, just a chat number.")
3. Migration number 0029 — coordinator assigned; reversible (DROP TABLE)
4. Startup block placement — before Phase 0 in coordinator.md; reversible

---

## Open Questions

None from coordinator. All blocking questions answered by Colin in task 87bc8578 metadata.
The acceptance doc is ready for Colin's final ratification before going to builder.

---

## Design System Note (F19)

No TSX files in this chunk. Not applicable.

---

## Numeric Field Definition Table

No SP-API financial data in this chunk. Not applicable.
