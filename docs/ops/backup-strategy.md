# Backup Strategy — Twin + Chat History

**Last updated:** 2026-05-04
**Status:** F5 — 50% (PITR implicit + manual export documented; no automated nightly export yet)

---

## What must be preserved

| Asset | Table(s) | Why it matters |
| ----- | -------- | -------------- |
| Twin knowledge corpus | `knowledge` | 7-week Streamlit corpus + ongoing chat-summarize facts. Loss = months of ingestion work. |
| Chat history | `conversations`, `messages` | Behavioral signal source for chat-summarize → Twin pipeline. |
| Harness state | `task_queue`, `harness_components`, `agent_events` | Operational continuity. Reproducible from code if lost, but inconvenient. |
| Config | `harness_config` | Runtime secrets/config. Reproducible but painful. |

---

## Layer 1 — Supabase PITR (implicit, always on)

Supabase Pro plans include Point-in-Time Recovery up to 7 days. The project `xpanlbcjueimeofgsara` is on a paid plan.

- **Coverage:** all tables, 7-day window
- **RTO:** ~30 min (Supabase dashboard restore)
- **RPO:** ~5 min (WAL flush interval)
- **Action required:** none — automatic

Verify: Supabase dashboard → Project → Database → Backups.

---

## Layer 2 — Manual export (knowledge corpus)

Run when making large schema changes or before a migration that touches `knowledge`:

```bash
# Export Twin corpus to JSON
npx tsx scripts/export-knowledge.ts > docs/backups/knowledge-$(date +%Y%m%d).json
```

If `export-knowledge.ts` doesn't exist yet, use the Supabase MCP directly:

```sql
-- Paste into Supabase SQL editor, download result as CSV
SELECT id, entity, chunk_type, content, source, tags, created_at
FROM knowledge
ORDER BY created_at;
```

Store exports in `docs/backups/` (gitignored if large — add to `.gitignore`).

---

## Layer 3 — Automated nightly export (not yet built)

**Gap:** no script exports `knowledge` + `conversations` + `messages` to a durable store (Dropbox or local disk) nightly.

**Recommended approach:**
1. Add a `GET /api/cron/backup` route (protected by `requireCronSecret`)
2. Queries `knowledge` + `conversations` + `messages` since last export
3. Writes NDJSON to Supabase Storage or posts to Telegram as file attachment
4. Logs to `agent_events` with row counts

**Priority:** low until Twin corpus exceeds ~5,000 chunks or chat history exceeds 6 months.

---

## Recovery runbook

### Scenario A — accidental row deletion
1. Supabase dashboard → Database → Backups → Point-in-time restore to 10 min before deletion
2. Verify row count matches expected
3. Resume normal operation

### Scenario B — project corruption / accidental drop
1. Supabase dashboard → restore to last known-good backup
2. Re-apply any migrations written after the backup timestamp (`supabase/migrations/`)
3. Re-run `scripts/embed-streamlit-source.ts` if `knowledge` rows are stale

### Scenario C — complete Supabase account loss
1. Restore from most recent `docs/backups/knowledge-*.json` export
2. Re-create project, apply all migrations in order
3. Re-import knowledge rows via `scripts/import-knowledge.ts` (to be written)
