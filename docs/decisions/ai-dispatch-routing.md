# AI Dispatch Routing — v1 Rules

**Route:** `POST /api/ai/dispatch`
**Decision date:** 2026-05-14
**Task:** 582c5d5f

## Problem

LepiOS needs a single entry point for ad-hoc tasks that can decide at runtime whether
Ollama (local, fast, free) or the coordinator (remote, slower, queued) handles the
request. Without this, callers choose the backend themselves, leading to inconsistent
routing and wasted API quota on tasks that Ollama could answer locally.

## Decision

A rule-based classifier (`classifyTask`) runs before any inference call:

1. **Length gate:** tasks > 300 characters → coordinator. Long tasks are complex by
   definition and benefit from coordinator planning.

2. **Keyword gate (case-insensitive substring match):** if the task string contains
   any coordinator keyword → coordinator. Current keyword list:
   `migrate`, `schema`, `database`, `supabase`, `acceptance doc`, `sprint`,
   `grounding`, `approval`, `architect`, `design`, `refactor`, `pr`,
   `pull request`, `deploy`, `cron`, `migration`

3. **Ollama path:** classifier returns `'ollama'` → call `generate(task, { task: 'general' })`.
   If `OllamaUnreachableError` is thrown (circuit open or network failure), fall through
   to the coordinator path. The caller gets a transparent response — no error surfaced.

4. **Coordinator path:** insert into `task_queue` with `source='ai_dispatch'`, return
   `{ routed_to: 'coordinator', task_id }`. The harness pickup cron handles execution.

## Tradeoffs

**Chose rule-based over embedding similarity** for v1: zero latency, no Ollama
dependency for the classifier itself, deterministic (testable). Downside: `'pr'` as
a substring will match words like "sprint", "improve", "april" — these will over-route
to coordinator. Acceptable for v1; v2 can use word-boundary matching or an embedding.

**No user-facing fallback error on Ollama failure:** the Ollama → coordinator fallthrough
is silent. Callers get a coordinator response with no indication that Ollama was
attempted. This is intentional — the fallthrough is a reliability improvement, not a
degraded mode. The circuit-state alert in `agent_events` is the signal.

**Priority 5 (neutral):** ai_dispatch tasks don't carry urgency context from the caller,
so they're queued at the midpoint. Callers who need priority control should pass an
optional `priority` field — that's a v2 feature.

## What changed in the schema

Migration `0204_ai_dispatch_source.sql` adds `'ai_dispatch'` to the
`task_queue.source` CHECK constraint. All other values unchanged.

## v2 candidates

- Word-boundary matching for `pr` keyword to reduce false positives
- Optional `priority` field in request body
- Embedding-based classifier for ambiguous short tasks
- Dry-run mode (`?dryRun=true`) for testing classification without side effects
