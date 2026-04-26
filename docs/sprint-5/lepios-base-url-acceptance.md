# lepios-base-url — Acceptance Doc

Sprint 5 · chunk: lepios-base-url
Coordinator task: b93658c2-5f31-4a8f-853c-f1a469dc1af1
Colin approval: pre-staged with defaults, review_via=pre_staged_with_defaults, 2026-04-26

---

## Scope

The coordinator's self-trigger drain call fails (403 or wrong domain) because the base URL
is not available in the coordinator's runtime environment. Add `LEPIOS_BASE_URL` as a third
`harness_config` key, read it in the coordinator startup block alongside `CRON_SECRET` and
`TELEGRAM_CHAT_ID`, and use it wherever the drain URL is constructed.

**Acceptance criterion:**
(a) Migration 0031 applied — `harness_config` contains a `LEPIOS_BASE_URL` row,
(b) coordinator startup block reads `LEPIOS_BASE_URL` and logs a `config_read` agent_event
confirming all three keys are present, and
(c) a coordinator self-trigger drain succeeds (HTTP 200, notifications delivered) without a
403 error.

---

## Out of scope

- Moving any other runtime config into `harness_config`
- UI for managing `harness_config` values
- Hardcoded fallback URL (fail loud — see Open Questions)
- Changing the drain route authentication logic

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0031_lepios_base_url.sql` | New — insert `LEPIOS_BASE_URL` row into `harness_config` |
| `.claude/agents/coordinator.md` | Update startup block to fetch + export `$LEPIOS_BASE_URL` |
| Drain self-trigger call site (find via grep) | Replace hardcoded/broken URL with `$LEPIOS_BASE_URL/api/harness/notifications-drain` |

---

## Migration 0031 — exact SQL

```sql
-- 0031_lepios_base_url.sql
-- Add LEPIOS_BASE_URL to coordinator runtime config.
-- Colin must UPDATE this value after migration:
--   UPDATE harness_config SET value = 'https://lepios-one.vercel.app'
--   WHERE key = 'LEPIOS_BASE_URL';
INSERT INTO public.harness_config (key, value, is_secret)
VALUES ('LEPIOS_BASE_URL', '', false)
ON CONFLICT (key) DO NOTHING;
```

---

## coordinator.md startup block extension

Extend the existing startup SQL to include the new key:

```sql
SELECT key, value FROM harness_config
WHERE key IN ('CRON_SECRET', 'TELEGRAM_CHAT_ID', 'LEPIOS_BASE_URL');
```

Add to the "store in working context" list:
- `LEPIOS_BASE_URL` — used as the base for all self-trigger API calls

Add to the failure fallback:
- If `LEPIOS_BASE_URL` is missing or empty: log `config_read_failed` with
  `meta.missing_keys=['LEPIOS_BASE_URL']`, skip drain self-trigger, continue session.

**Do NOT log the value of `CRON_SECRET` anywhere.**

---

## Check-Before-Build findings

Builder must verify before coding:

| Item | Action |
|------|--------|
| Current drain self-trigger call site | `grep -r "notifications-drain\|drain.*url\|lepios.*vercel" .claude/ lib/ app/ --include="*.ts" --include="*.md"` |
| `harness_config` existing rows | `SELECT key FROM harness_config` — confirm CRON_SECRET + TELEGRAM_CHAT_ID exist |
| coordinator.md startup block location | Read `.claude/agents/coordinator.md` lines containing `harness_config` |
| Migration numbering | Confirm 0030 is latest — next is 0031 |

---

## External deps

| Dep | Note |
|-----|------|
| `harness_config` table | Exists (migration 0029). RLS: service role only. |
| `outbound_notifications` drain route | `GET /api/harness/notifications-drain`, Bearer auth |
| coordinator.md | Existing startup block reads CRON_SECRET + TELEGRAM_CHAT_ID — extend, don't replace |

---

## F18 metric

No new F18 event for this chunk — the existing `heartbeat` and `drain_trigger_*` events in
`agent_events` already surface whether the drain self-trigger succeeded. Confirm after deploy:

```sql
SELECT action, status, occurred_at FROM agent_events
WHERE action IN ('drain_trigger_success', 'drain_trigger_failed')
ORDER BY occurred_at DESC LIMIT 5;
```

`drain_trigger_failed` should disappear after this ships.

---

## Grounding checkpoint

1. Apply migration 0031.
2. Insert real value:
   ```sql
   UPDATE harness_config SET value = 'https://lepios-one.vercel.app'
   WHERE key = 'LEPIOS_BASE_URL';
   ```
3. Confirm all three keys populated:
   ```sql
   SELECT key, length(value) as len FROM harness_config
   WHERE key IN ('CRON_SECRET', 'TELEGRAM_CHAT_ID', 'LEPIOS_BASE_URL');
   ```
   → All three rows, all non-zero lengths.
4. Trigger a coordinator session (manual pickup curl).
5. Confirm `agent_events` contains no new `drain_trigger_failed` rows after the session.
6. Confirm any pending notifications drained successfully during the session.

---

## Open questions

All defaults accepted (pre-staged):

- Q1: Value in code vs harness_config? **harness_config** — keeps all coordinator runtime
  config in one place per the established pattern.
- Q2: Fall back to hardcoded default if row is empty? **NO** — fail loud, log
  `config_read_failed`, surface the misconfiguration rather than silently using a wrong URL.

---

## Cached-principle decisions

`cache_match_enabled: false` for Sprint 5. Pre-staged by Colin 2026-04-26 with defaults accepted.

- Principle 3 (FK over copy): value in DB, not duplicated in code ✓
- Principle 17: additive migration only, no speculative new tables ✓
- Principle 19: coordinator.md + migration only, no UI or TSX changes ✓
