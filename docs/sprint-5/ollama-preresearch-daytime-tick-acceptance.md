# Acceptance Doc: Ollama Pre-Research in Daytime Tick

**Chunk ID:** `sprint-5-ollama-preresearch`  
**Task ID:** `574ed32c-29bf-4058-abc5-1b3375f2bb58`  
**Written by:** Coordinator, 2026-05-15  
**Status:** AWAITING COLIN APPROVAL — see Open Questions Q1 + Q2 (blocking)

---

## Scope

Extend the daytime tick (`lib/orchestrator/daytime-tick.ts`) to, for each queued task in
`task_queue`, generate an Ollama-produced research summary of relevant Streamlit source
material and store it in `task_queue.metadata.research_notes`. Update
`.claude/agents/coordinator.md` Phase 1a to use `research_notes` as supplementary
context when present.

**One acceptance criterion:** After the daytime tick runs, any task whose description
references a Streamlit module has `metadata.research_notes` set to a non-empty string;
and a coordinator run for that task produces a Phase 1a study doc with content consistent
with (not contradicting) the research notes.

---

## Out of scope

- **Phase 1a full skip** — coordinator still writes study doc; notes are supplementary
  context only. (This design choice is Q1 below — Colin must decide before builder starts.)
- Changes to Phase 1b (Twin Q&A), Phase 1c (20% Better), or any other coordinator phase.
- Changing the task-generation flow — pre-research happens in the daytime tick, not at
  task-creation time.
- A UI for viewing research notes.
- Pre-research for greenfield/harness tasks that have no Streamlit predecessor (they skip
  Phase 1a anyway, so research notes provide no benefit).

---

## Files expected to change

| # | File | Change |
|---|------|--------|
| 1 | `lib/orchestrator/daytime-tick.ts` | Add `runPreResearch()` call inside `runDaytimeTick()` after health checks, wrapped in `safeCheck` pattern |
| 2 | `lib/harness/pre-research.ts` | **New file** — pre-research orchestration (see Architecture below) |
| 3 | `.claude/agents/coordinator.md` | Add Phase 1a seed block: if `task.metadata.research_notes` non-empty, read as Phase 1a context before writing study doc. **Requires explicit Colin approval — see Q2.** |
| 4 | `tests/harness/pre-research.test.ts` | **New file** — unit tests for pre-research logic (see Test plan) |

No migration required — `metadata` is already JSONB on `task_queue`. No new columns, no
new indexes needed for the write path (research_notes is written, not queried by DB).

---

## Check-Before-Build findings

**Existing — reuse:**

- `lib/ollama/client.ts → generate()` — circuit breaker, confidence extraction, logging
  already included. No new Ollama client needed. Use `task: 'analysis'` for summaries
  (uses the 32B model per `OLLAMA_MODELS.ANALYSIS`).
- `lib/ollama/client.ts → hydrateOllamaConfig()` — already called at daytime tick start;
  Ollama config is already hydrated before `runPreResearch()` is called.
- `lib/harness/source-content.ts → extractSourceFromMetadata()` — establishes the
  metadata field pattern. Pre-research writes to `metadata.research_notes`; coordinator
  reads it. Same data-in-metadata idiom.
- `knowledge` table — 174 `streamlit_source` rows already present, one row per function.
  Fields: `entity` (filename, e.g. `pages/52_Utility_Tracker.py`), `title` (function
  name), `context` (Python source). Queryable via ILIKE on `entity`.
- `lib/harness/task-pickup.ts → TaskRow` — `metadata: Record<string, unknown>` already
  typed.

**Gap — what to build:**

- `lib/harness/pre-research.ts` — the orchestration (~100–130 lines):
  1. `extractModuleHints(description: string): string[]` — regex for Streamlit module
     patterns (`\d\d_\w+\.py`, page slugs like `utility_tracker`, known page numbers)
  2. `fetchSourceSnippets(hints: string[]): string` — Supabase query:
     `SELECT entity, title, context FROM knowledge WHERE domain='streamlit_source' AND entity ILIKE '%{hint}%' ORDER BY entity LIMIT 10` — concatenate results, cap at 6000 chars
  3. `summarizeSource(taskDesc: string, source: string): Promise<string>` — call
     `generate()` with system prompt "Summarize domain rules, data flow, and edge cases
     from this Streamlit code. Be precise. Max 400 words."
  4. `writeResearchNotes(taskId: string, notes: string, sourceFiles: string[]): Promise<void>` — UPDATE task_queue metadata
  5. `runPreResearch(): Promise<PreResearchResult>` — public entry point, calls 1–4 for
     each queued task, handles Ollama-unreachable gracefully (skip, do not error)

**File location note:** Task description mentions `lib/harness/daytime-tick` but the file
is at `lib/orchestrator/daytime-tick.ts`. Not a problem — same file, builder should use
the actual path.

---

## Architecture — source retrieval constraint

**Critical:** The daytime tick runs in Vercel (cloud). It cannot read local `.py` files
from disk. The task description says "reads those files locally" — this only applies when
the tick runs locally (e.g. during development). In production (Vercel → Cloudflare tunnel
→ local Ollama), source must come from the `knowledge` table.

The `knowledge` table has 174 `streamlit_source` rows from a prior embed run. Source
content is in the `context` field. Each row is one function. For a given task, pre-research
queries by module hint, concatenates up to 10 function snippets (capped at 6000 chars),
and sends to Ollama.

**Graceful degradation:** If Ollama is unreachable (circuit OPEN) OR knowledge table
returns no rows for the extracted hints, skip pre-research silently. Do NOT write
`research_notes`. Coordinator proceeds with normal Phase 1a.

---

## Pre-research metadata fields written

| Field | Type | Content |
|-------|------|---------|
| `metadata.research_notes` | string | Ollama-generated 200–400 word summary of domain rules + data flow |
| `metadata.research_notes_source_files` | string[] | List of `entity` values matched (e.g. `["pages/52_Utility_Tracker.py"]`) |
| `metadata.research_notes_generated_at` | ISO string | Timestamp of generation |
| `metadata.research_notes_model` | string | Ollama model used (e.g. `qwen2.5:32b`) |

---

## Coordinator Phase 1a integration (pending Q1 answer)

**If Colin approves supplementary-context approach (recommended):**

Add to coordinator.md Phase 1a, before step 1:

```
**Phase 1a seed — check before reading files:**
If `task.metadata.research_notes` is non-empty:
1. Read the notes verbatim.
2. Write a `## Pre-Research Notes` section at the top of the study doc, quoting the notes.
3. Use as context when reading Streamlit source — do NOT replace Phase 1a with the notes.
   Notes reduce re-reading cost; Phase 1a rigor is preserved.
```

**If Colin approves full-skip approach:**

```
**Phase 1a skip — research notes present:**
If `task.metadata.research_notes` is non-empty:
1. Copy notes verbatim into `docs/sprint-{N}/chunk-{id}-streamlit-study.md` under `## Pre-Research (Ollama-generated)`.
2. Skip steps 1–5 of Phase 1a (no Streamlit file reading).
3. Proceed directly to Phase 1b Twin Q&A with the pre-research notes as context.
```

The skip approach saves more tokens but risks missing domain rules Ollama didn't surface.
Coordinator author recommends supplementary-context only. Builder should not start until
Colin decides.

---

## F17 — behavioral ingestion justification

Pre-research feeds curated source summaries into coordinator Phase 1a before Streamlit
file reading. This reduces hallucination risk (coordinator starts from Ollama-vetted facts)
and reduces cloud token cost. Direct contribution to the coordinator improvement loop.
F17 satisfied — measurable signal (token usage before/after) with clear benchmark.

---

## F18 — measurement

- **Unit**: `coordinator_tokens_in` per Phase 1a task
- **Source**: `agent_events WHERE action='session_summary' AND domain='coordinator'`
  — read `meta->>'phases_completed'` to filter Phase 1a runs
- **Benchmark**: Average `tokens_in` of last 5 coordinator runs that included Phase 1a
  (query: `SELECT meta FROM agent_events WHERE action='session_summary' AND domain='coordinator' ORDER BY occurred_at DESC LIMIT 10` — filter in application for `phases_completed` containing phase 1)
- **Target**: 25–35% reduction in `tokens_in` per Phase 1a run
- **Surfacing path**: Morning digest already reads session_summary rows. Builder should add
  `research_notes_used: true/false` to session_summary meta so before/after comparison is
  trivial. Colin can ask "how is pre-research doing?" → morning digest shows % reduction.

---

## Grounding checkpoint

Colin verifies after deploy:

1. Trigger daytime tick:
   ```bash
   curl -s -X POST https://lepios-one.vercel.app/api/cron/daytime-tick \
     -H 'Authorization: Bearer {CRON_SECRET}'
   ```

2. Check a queued task for research notes:
   ```sql
   SELECT id, task,
     metadata->>'research_notes' AS notes,
     metadata->>'research_notes_source_files' AS source_files
   FROM task_queue
   WHERE status = 'queued'
     AND metadata->>'research_notes' IS NOT NULL
   LIMIT 3;
   ```

3. Verify notes are non-empty and reference the expected Streamlit module.

4. Check agent_events for pre-research log:
   ```sql
   SELECT meta FROM agent_events
   WHERE action = 'pre_research_complete'
   ORDER BY occurred_at DESC LIMIT 3;
   ```

5. Run a coordinator on a pre-researched task. Confirm:
   - Study doc `## Pre-Research Notes` section matches `metadata.research_notes`
   - No contradictions between notes and study doc findings

**Not acceptable as grounding:** "tests pass." Tests verify logic, not Ollama output quality.

---

## Kill signals

| Signal | Severity | Response |
|--------|----------|---------|
| Research notes consistently empty — Ollama unreachable or no knowledge hits | Non-kill — graceful degradation | Monitor; if Ollama stays down, pre-research adds no value but no harm |
| Coordinator produces worse acceptance docs (misses domain rules from Streamlit) | KILL — coordinator over-relying on incomplete summaries | Rollback coordinator.md change; Phase 1a returns to full mode |
| Token usage INCREASES (coordinator reads notes + does full Phase 1a anyway) | KILL if no improvement after 5 tasks | Rollback; root cause: coordinator not using notes effectively |
| Pre-research errors block daytime tick (uncaught exception) | KILL if tick fails | Root cause: safeCheck wrapper missing or swallowing wrong error type |

---

## Test plan (`tests/harness/pre-research.test.ts`)

| ID | Test | Pass condition |
|----|------|---------------|
| PR-1 | `extractModuleHints` — `"port 52_Utility_Tracker.py"` | Returns `["utility_tracker", "52_utility"]` |
| PR-2 | `extractModuleHints` — no Streamlit hint in description | Returns `[]` |
| PR-3 | `fetchSourceSnippets` — mock knowledge returns 3 rows | Returns concatenated context, total ≤ 6000 chars |
| PR-4 | `fetchSourceSnippets` — knowledge returns empty | Returns `""` |
| PR-5 | `runPreResearch` — Ollama reachable, knowledge hit | Writes `research_notes` to task_queue metadata |
| PR-6 | `runPreResearch` — Ollama throws OllamaUnreachableError | Skips gracefully, does NOT write metadata, does NOT throw |
| PR-7 | `runPreResearch` — no queued tasks | Returns early, no Ollama call |
| PR-8 | `runPreResearch` — task with `research_notes` already present | Skips that task (idempotent — do not overwrite) |

---

## Open questions (BLOCKING — Colin must answer before builder starts)

**Q1 (blocking): Phase 1a behavior when research_notes present**

> Task description says "skip Phase 1a if pre-research is present." But Phase 1a is where
> domain rules are extracted from the Streamlit reference — skipping it risks missing rules
> Ollama 14B didn't surface (truncated context, low-confidence answers, incomplete coverage).
>
> **Option A (recommended):** Supplementary context only. Coordinator reads research_notes
> at Phase 1a start, uses as seed, still writes the study doc by reading actual Streamlit
> source. Estimated token savings: ~25–30% (coordinator has pre-summarized context, fewer
> raw file reads needed).
>
> **Option B:** Full Phase 1a skip. Coordinator copies research_notes into study doc, skips
> Streamlit source reading entirely. Estimated token savings: ~40–50%. Risk: acceptance docs
> may miss domain rules Ollama didn't capture.
>
> Which do you want?

**Q2 (blocking): Explicit approval to edit `.claude/agents/coordinator.md`**

> Editing coordinator.md changes the behavior of every future autonomous coordinator run.
> This is a doctrine-level edit that requires Colin's explicit approval (CLAUDE.md §3,
> rule 4: "Decisions Are Colin's"). Builder should NOT touch this file until you confirm.
>
> Please confirm: "Approved — builder may edit coordinator.md per Q1 answer above."

---

## Cached-principle decisions

Cache-match not applied. Both Q1 and Q2 require Colin's explicit judgment:
- Q1: trade-off between token savings and acceptance-doc quality is a Colin decision (values judgment, not pattern-match)
- Q2: coordinator.md edit requires explicit approval per CLAUDE.md §3 rule 4

`cache_match_enabled: true` per sprint-state.md, but META-C condition requires
`confidence: high`. Without Q1 and Q2 resolved, confidence is `medium` (unsatisfied
condition (b) — uncertain whether cached decisions apply to a coordinator.md edit).
Escalation is correct per META-C logic.

---

## GitHub prior art (§8.4)

Searched for "ollama pre-research task queue coordinator preprocessing":
- No open-source project found that does exactly this pattern (task pre-research via local
  LLM before cloud agent pickup).
- Closest prior art: LLM router patterns (route to local vs. cloud based on task type).
  Not applicable — this is preprocessing, not routing.
- **Verdict: Build-new**, but build on existing `generate()` and `knowledge` table
  infrastructure already in the repo. Net new code: ~130 lines in `pre-research.ts`.
