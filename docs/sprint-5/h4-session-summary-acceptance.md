# H4 — Coordinator Session Summary to agent_events

**Task ID:** da9bba88-4fc6-4e0a-9bc8-981857b222a1  
**Hardening ID:** H4  
**Source:** postmortem_915d1fee (docs/autonomous-loop-postmortem-2026-04-27.md §H4)  
**Written by:** Coordinator, 2026-05-10  
**Status:** Awaiting Colin approval

---

## Scope

Add a mandatory **Phase 7 — Session Summary** section to `.claude/agents/coordinator.md` that every coordinator session executes at session end, writing a single `coordinator_session_summary` row to `agent_events` containing a complete decision log.

**One acceptance criterion:** Querying `SELECT meta FROM agent_events WHERE action = 'coordinator_session_summary' AND meta->>'task_id' = '<task_id>'` returns a row with all required fields present within 60 seconds of any coordinator session ending.

---

## Out of Scope

- Schema migration — `agent_events` table already has all required columns (`session_id`, `meta`, `output_summary`, `duration_ms`). No DDL needed.
- Backfilling prior sessions — the 3 existing summary rows are informally written; leave them as-is.
- Automatic file-read detection via hooks — coordinator maintains best-effort manual tracking in context.
- Application code changes — this is a protocol doc change only.

---

## Check-Before-Build Findings

**Pattern already exists (grounded):**
```sql
SELECT meta->>'task_id', meta->>'outcome', occurred_at 
FROM agent_events WHERE action = 'coordinator_session_summary' ORDER BY occurred_at DESC LIMIT 3;
```
Returns 3 rows (H1: 2026-04-27, H2: 2026-05-08, H5: 2026-05-10). Prior coordinators have been writing this event informally.

**Inconsistencies in existing rows:**
- H5 row: missing `files_read` field
- All rows: `session_id` column is null (should be populated with run_id)
- All rows: `output_summary` column is null (human-readable summary missing)
- H1 row uses `files_updated` instead of `files_written` (inconsistent key name)

**What needs building:** A formal "Phase 7" section in coordinator.md that specifies exact field names, required fields, and execution timing. No code changes. Builder edits coordinator.md only.

---

## Required Fields (standardized)

All fields go in the `meta` JSONB column. Additionally, the dedicated columns below must be populated.

### Dedicated columns (not in meta)
| Column | Value |
|--------|-------|
| `action` | `'coordinator_session_summary'` |
| `domain` | `'orchestrator'` |
| `actor` | `'coordinator'` |
| `status` | `'success'` or `'error'` |
| `session_id` | `run_id` from invocation context |
| `output_summary` | Human-readable one-line outcome (e.g. "H4 acceptance doc written, awaiting Colin approval") |

### meta JSONB fields (required)
| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | UUID from invocation context |
| `run_id` | string | run_id from routine-fire-payload |
| `hardening_id` / `chunk_id` | string | Which task this session was for |
| `outcome` | string | One of: `completed`, `awaiting-grounding`, `acceptance_doc_ready_awaiting_colin_approval`, `escalated`, `error` |
| `phases_completed` | array | Phase names completed, in order (e.g. `["branch_guard", "runtime_config_read", "acceptance_doc_written"]`) |
| `files_read` | array | Key files read during session (best-effort; always include `coordinator.md`, `sprint-state.md`) |
| `files_written` | array | Files written or edited during session |
| `warnings` | array | Warnings encountered (e.g. `["branch_guard_triggered", "heartbeat_skipped", "twin_unreachable"]`) |

### meta JSONB fields (include when applicable)
| Field | When to include |
|-------|----------------|
| `builder_task_id` | When a builder task was created in task_queue |
| `acceptance_doc` | File path of acceptance doc written |
| `telegram_notification_id` | Row ID of outbound_notifications row queued |
| `pr` | PR number if a PR was created |
| `commit` | Commit hash if coordinator made a commit |
| `escalation_reason` | Principle or rule cited for escalation |
| `approx_tokens_in` | Estimated input tokens for the session |
| `approx_tokens_out` | Estimated output tokens for the session |

---

## Files Expected to Change

- `.claude/agents/coordinator.md` — add Phase 7 section (builder's job)
  - No seam approval needed (not in the seam set)
  - Builder adds the section after "Phase 6 — Sprint close" and before "Escalation rules"

---

## External Deps Tested

None — this is a protocol/doc change only. The `agent_events` INSERT is already proven by 3 historical rows.

---

## 20% Better (vs. informal pattern)

| Category | Improvement |
|----------|-------------|
| Correctness | Standardize `files_written` key (H1 used `files_updated` — unify) |
| Observability | Populate `session_id` column with run_id for direct column-filter queries (no JSON parsing) |
| UX | Populate `output_summary` column with human-readable one-liner |
| Observability | Add `heartbeat_count` to meta — 0 means the heartbeat gap exists, >3 means healthy |
| Extensibility | Add `builder_task_ids` array field for sessions that spawn multiple builder tasks |

---

## Grounding Checkpoint

**After builder PR merges and the next coordinator session completes:**

```sql
SELECT session_id, output_summary, meta
FROM agent_events 
WHERE action = 'coordinator_session_summary' 
ORDER BY occurred_at DESC LIMIT 1;
```

Pass criteria:
- `session_id` is non-null (populated with run_id)
- `output_summary` is non-null (human-readable one-liner)
- `meta` contains all required fields: `task_id`, `run_id`, `outcome`, `phases_completed`, `files_read`, `files_written`, `warnings`

This is a DB-state query checkpoint (Principle 14 escape hatch). No physical-world artifact needed.

---

## Kill Signals

- Builder finds coordinator.md has an existing Phase 7 section → report back, this chunk is already done
- Agent_events INSERT fails for the session summary in the next real run → root cause and fix before marking complete

---

## Open Questions

1. **session_id source**: Using `run_id` from the routine-fire-payload as the `session_id`. Colin: is there a better source for the claude.ai session ID that coordinators can reliably access, or is run_id the right proxy? [twin: unreachable, using coordinator judgment]

2. **files_read tracking**: Best-effort manual tracking by coordinator (reads that happen in fast succession before context is written to a list). Comprehensive tracking would require hook-level instrumentation. Accept best-effort for now? [twin: unreachable]

---

## META-C Cache-Match Evaluation

**Cache-match enabled:** Yes (sprint-state.md `cache_match_enabled: true` for Sprint 5).

**Trigger match:** F18 ("every new module must ship with metrics capture") applies here as "every coordinator run must ship with an auditable event." The coordinator is an autonomous agent that is not currently instrumented at session close. The postmortem explicitly identifies this as H4 and provides the acceptance criterion.

**No contradicting information:** 3 existing sessions already write this event informally. The check-before-build confirms the pattern is established; this chunk formalizes it.

**Reversibility:** Fully reversible — adding a protocol section to coordinator.md is reversible by removing it. No schema changes, no data mutations.

**Confidence:** MEDIUM — trigger match is principle-adjacent (F18 is about modules; coordinator is an agent, not a UI module). Escalating to Colin rather than auto-proceeding, per META-C rule (medium confidence → escalate).

**Decision: escalate to Colin for approval.**
