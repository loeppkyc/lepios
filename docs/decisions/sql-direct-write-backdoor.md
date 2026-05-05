# Decision — Direct SQL writes accepted as a privileged backdoor

**Date:** 2026-05-05
**Closes:** task `305a9528-6e9b-40a3-b794-ebd2b8ac3d7f` ("design: F18 audit trail gap — direct SQL bypasses agent_events")
**gpu-day-readiness:** B6 → 100%

## Decision

Direct SQL writes via Supabase MCP `execute_sql` and pgAdmin are **accepted as designed** — they are a privileged backdoor used by Colin and the audit/repair workflow. F18 (`agent_events` audit trail) does not need to capture them.

## Rejected alternatives

- **(b) Postgres row-level audit triggers emitting to agent_events** — rejected. Cost: every table needs a trigger; performance overhead on every INSERT/UPDATE/DELETE; complicates schema migrations; trigger logic itself is a source of bugs.
- **(c) Force all writes through API path** — rejected. Breaks legitimate ad-hoc workflows (Hubdoc imports, category normalisations, balance sheet edits). Would require building API surface for every table — significant scope creep.

## Rationale

- F18 surfacing is about **agent** behaviour, not human/operator behaviour. Direct SQL is a Colin tool.
- The audit trail for direct SQL exists in Supabase's own logs (`pg_stat_statements`, log retention) — not the same surface, but not lost.
- Solo-dev context: Colin is the only operator. There is no insider-threat model to defend against.

## When to revisit

Revisit if any of the following becomes true:

- A second human gains write access to the database
- An autonomous agent gains direct SQL execution capability (i.e., not gated by the API path or a registered tool)
- F18 surfacing requirement expands to include human operations (e.g., compliance audit)

## Documentation

Direct SQL writes are documented in:

- `CLAUDE.md` §8 — Supabase `execute_sql` tool entry
- This decision doc

No code changes. No new safeguards.
