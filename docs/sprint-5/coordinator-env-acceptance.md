# Sprint 5 — coordinator-env Acceptance Doc

**Status:** Colin-approved (callback `2026-04-25T23:05:19Z`, task `87bc8578-6eb8-4f84-b522-00c4804a2398`)
**Recovery note:** Original file not committed to disk. Reconstructed from approved task metadata. Content matches the approved design.

---

## Scope

Create a `harness_config` key-value table in Supabase and update `coordinator.md` with a
startup block that reads `CRON_SECRET` and `TELEGRAM_CHAT_ID` from it at session start, so
coordinator heartbeats and Telegram notifications actually fire.

**Acceptance criterion:** On the next autonomous coordinator run after Colin inserts real values
into `harness_config`, the `agent_events` table contains a heartbeat row with `status='success'`
and the `outbound_notifications` row for that run has a non-null `chat_id`.

---

## Out of scope

- Any UI for managing `harness_config` values (Colin uses Supabase dashboard directly)
- Any API route for `harness_config` reads/writes
- Encryption of stored values at the application layer (RLS + service-role-only access is the
  security boundary)
- Migrating any other runtime config into `harness_config` (extend later per Principle 17)
- Changes to `lib/harness/invoke-coordinator.ts` (Option A is not selected)

---

## Files expected to change

| File                                          | Action                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| `supabase/migrations/0029_harness_config.sql` | Create new                                                |
| `.claude/agents/coordinator.md`               | Update — add startup block + update notification template |

No application code changes. No changes to any `app/` or `lib/` files.

---

## Check-Before-Build findings

- `harness_config` table: **does not exist** (confirmed `mcp__Supabase__execute_sql` → relation not found)
- Migration numbering: last migration is `0028_attribution_actor_type_colin.sql`; next is `0029`
- `outbound_notifications.chat_id` column: **nullable** — drain at `notifications-drain/route.ts:158` already implements `row.chat_id ?? defaultChatId` fallback
- `CRON_SECRET` in coordinator.md: referenced as `$CRON_SECRET` bash var at lines 35, 395 — never populated in coordinator runtime
- `TELEGRAM_CHAT_ID` in coordinator.md: referenced at line 368 — never populated in coordinator runtime

---

## External deps tested

| Endpoint                                | Auth required                         | Status                                        |
| --------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `POST /api/harness/task-heartbeat`      | `Authorization: Bearer {CRON_SECRET}` | Confirmed — `task-heartbeat/route.ts:8`       |
| `POST /api/harness/notifications-drain` | `Authorization: Bearer {CRON_SECRET}` | Confirmed — `notifications-drain/route.ts:77` |

---

## Migration 0029 — exact SQL

```sql
-- harness_config: runtime config store for coordinator agent
-- Coordinator reads this at session start via mcp__Supabase__execute_sql.
-- Service role bypasses RLS; anon + authenticated have zero access.
CREATE TABLE public.harness_config (
  key        text        PRIMARY KEY,
  value      text        NOT NULL DEFAULT '',
  is_secret  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.harness_config ENABLE ROW LEVEL SECURITY;
-- No permissive policies: anon + authenticated are locked out.
-- Service role bypasses RLS by default in Supabase — no explicit policy needed.

-- Seed coordinator runtime config keys.
-- Colin MUST insert the real values after applying this migration:
--   UPDATE harness_config SET value = '<actual-value>' WHERE key = 'CRON_SECRET';
--   UPDATE harness_config SET value = '<actual-value>' WHERE key = 'TELEGRAM_CHAT_ID';
INSERT INTO public.harness_config (key, value, is_secret) VALUES
  ('CRON_SECRET',      '', true),
  ('TELEGRAM_CHAT_ID', '', false);
```

---

## coordinator.md changes — exact specification

### Change 1 — Add "Runtime Config" section

Insert the following block **immediately before `# Reference files you read`** (currently at
line 48 of `.claude/agents/coordinator.md`):

````markdown
# Runtime Config — Read at Session Start

Before any other action — before Phase 0, before reading ARCHITECTURE.md — read the
coordinator's runtime config from `harness_config` via `mcp__Supabase__execute_sql`:

```sql
SELECT key, value FROM harness_config WHERE key IN ('CRON_SECRET', 'TELEGRAM_CHAT_ID');
```
````

Store the results in your working context:

- `CRON_SECRET` — used as the Bearer token in every heartbeat and drain-trigger curl
- `TELEGRAM_CHAT_ID` — used as `chat_id` in every `outbound_notifications` insert

If the query fails (table missing or row absent):

1. Log `agent_events` row: `action='config_read_failed', status='warning',
meta.missing_keys=['CRON_SECRET'|'TELEGRAM_CHAT_ID']`
2. Continue — heartbeat is skipped per Non-negotiable #6; notifications insert with null
   `chat_id` (drain fallback covers delivery)

**Do NOT log the value of `CRON_SECRET` anywhere in your output or tool calls.**

````

### Change 2 — Update notification insert template

In the "Step 2 — Insert into outbound_notifications" section (around line 362), replace the
`"chat_id": "${TELEGRAM_CHAT_ID}",` line with the value read from harness_config at startup:

**Before:**
```json
    "chat_id": "${TELEGRAM_CHAT_ID}",
````

**After:**

```json
    "chat_id": "<TELEGRAM_CHAT_ID from harness_config>",
```

Add a comment above the insert block (in the markdown prose, not the JSON):

> `chat_id` — use the value read from `harness_config` at session start. If not available,
> omit the field entirely (null) — the drain will fall back to `process.env.TELEGRAM_CHAT_ID`.

### Change 3 — Update heartbeat curl template

In the "Non-negotiables" section (around line 35), add a note below the heartbeat curl:

> `CRON_SECRET` in the Bearer header — use the value read from `harness_config` at session
> start. If not available, skip heartbeat and log per the fallback rule above.

---

## Grounding checkpoint

**Colin verifies (after applying migration and inserting real values):**

1. `SELECT * FROM harness_config;` → two rows, both with non-empty values
2. Trigger a coordinator run manually (or wait for next scheduled pickup)
3. `SELECT * FROM agent_events WHERE action = 'heartbeat' ORDER BY created_at DESC LIMIT 5;`
   → contains at least one row with `status = 'success'`
4. `SELECT id, chat_id, status FROM outbound_notifications ORDER BY created_at DESC LIMIT 5;`
   → `chat_id` is non-null on coordinator-generated rows

**Not acceptable as grounding:** tests pass, migration applied with empty values, or no
coordinator run after insertion.

---

## Kill signals

- If inserting CRON_SECRET into harness_config creates a security concern Colin didn't
  anticipate → revert migration, reconsider Option A (pass in fire payload)
- If harness_config read adds >5s latency to coordinator startup → revisit (unlikely — it's one
  indexed lookup)

---

## Cached-principle decisions

`cache_match_enabled: false` for Sprint 5 (explicit override, every doc escalates to Colin).

**Colin approved this specific chunk** via `task_queue` callback at `2026-04-25T23:05:19Z`.
This is not a cache-match proceed — it is a direct Colin ratification.

Principles cited for doc contents:

- Principle 3 (FK over copy): storing config in DB rather than duplicating in fire payload ✓
- Principle 17 (no speculative infrastructure): only CRON_SECRET + TELEGRAM_CHAT_ID seeded;
  no other future config speculated ✓
- Principle 19 (destructive ops): migration is additive-only; no data at risk ✓

---

## Open questions

None. All questions resolved via Q&A in task metadata (see `coordinator-env-study.md`).
