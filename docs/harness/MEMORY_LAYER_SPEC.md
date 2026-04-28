# MEMORY_LAYER_SPEC

**Status:** APPROVED (Draft 2, 2026-04-28). Colin redline applied — source attribution on `idea_inbox` and `decisions_log`. **decisions_log: shipped 2026-04-28** (chunk #1 of priority order; Option A partial-index redline applied — see §M3 footer).
**Source of truth:** This doc.
**Authority:** Migration `0044_memory_layer_schema.sql` is written from this doc.
**Parent spec:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) — this is the deferred memory-layer scope referenced in its redline notes.

---

## At a glance

| Field                             | Approved                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| Component count change            | **0** (extends `digital_twin` scope; no new harness rows)                 |
| New tables                        | **3** — `idea_inbox`, `decisions_log`, `session_digests`                  |
| New endpoints                     | **2** — `POST /api/memory/idea`, `GET /api/memory/session-digest`         |
| New ingest categories             | **2** — `idea`, `decision` added to existing `knowledge.category`         |
| Migration                         | **0044** — single file, all three tables + RLS + FTS                      |
| Honest re-score of `digital_twin` | **85% → ~50%** when memory-layer surfaces are subsumed                    |
| Honest re-score of harness rollup | **55.7% → ~52.4%** as a consequence                                       |
| Twin retrieval API change         | **none** — new rows mirror into existing `knowledge` table via DB trigger |

---

## The problem (verbatim from kickoff)

Memory currently lives in 4 disconnected places:

1. Anthropic memory (read-only, recency-biased, can't query)
2. CLAUDE.md (manually curated, limited size)
3. Repo files (only seen if read)
4. Past chats (searchable but inconsistently used)

No unified store. Every session starts fresh. Colin re-explains context. This is the bottleneck on velocity, not compute.

## The goal

Build the LepiOS Memory Layer — single Supabase-backed memory spine that every session reads on entry. Eliminates re-explaining. Survives context limits. Lets Colin shift between windows without losing state.

---

## Architecture decisions (the four the kickoff flagged)

### A1. Memory layer = expansion of `digital_twin` scope, **not** a new component row

The kickoff prompt suggested this as the likely answer. Confirming it after audit:

- Twin already owns the retrieval substrate: `knowledge` table, pgvector index, FTS fallback, `/api/twin/ask`. The new tables are _content sources_ feeding that substrate, not parallel infrastructure.
- Adding 3 new harness rows would force a weight rebalance two days after Migration 0043 reseated the foundation. Bad timing, low payoff.
- Bundling them into `digital_twin` makes the rollup _more_ honest, not less: today's 85% scores the Q&A endpoint as feature-complete, but the corpus excludes ideas, decisions, and session continuity. Expanding the scope and re-scoring is the F19 move.

**Concrete consequences:**

- `digital_twin` scope (in `HARNESS_FOUNDATION_SPEC.md`) expands from "Q&A interface" to:
  > Q&A interface + idea inbox + decisions log + session digest. The full memory spine — corpus, retrieval, capture surfaces, and session-entry composition.
- `digital_twin` completion drops 85% → ~50% on first re-score (table below).
- Harness rollup drops 55.7% → ~52.4%. This is a deliberate honesty correction; flagged in `morning_digest` the day the spec lands.
- The path back to 95% (still Priority #1 in the foundation spec) now requires shipping idea_inbox + decisions_log + session_digest, not just fixing F-L14.

**Re-scored breakdown of `digital_twin` (proposed):**

| Sub-system               | Weight inside twin | Today    | Notes                                               |
| ------------------------ | ------------------ | -------- | --------------------------------------------------- |
| Corpus + retrieval (Q&A) | 40%                | 85%      | Existing — pgvector + FTS + /api/twin/ask           |
| Ingest pipeline          | 15%                | 60%      | F-L14 registry-driven ingest still pending          |
| `idea_inbox`             | 15%                | 0%       | Seed corpus exists in memory/feature_backlog only   |
| `decisions_log`          | 15%                | 10%      | docs/decisions/\*.md exists; no DB store, no query  |
| `session_digest`         | 15%                | 30%      | Many digest line builders exist; no composer/header |
| **Blended completion**   |                    | **~50%** |                                                     |

Math: 0.40·0.85 + 0.15·0.60 + 0.15·0 + 0.15·0.10 + 0.15·0.30 = 0.34 + 0.09 + 0 + 0.015 + 0.045 = **0.49** ≈ 50%.

### A2. `session_digest` loads via slash command + HTTP endpoint, not auto-inject

Claude Code currently has **no reliable hook** to auto-prepend content at session start. The reliable surfaces today are:

1. Slash command — extend the existing global `/startup` skill to fetch the digest and prepend it to its briefing output.
2. HTTP — `GET /api/memory/session-digest` returns markdown. Any window (or future chat_ui) calls it explicitly.
3. Persisted history — every fetch writes a row to `session_digests` so replay is possible.

**Decision:** ship #1 + #2 + #3. Defer auto-inject until either Claude Code exposes a hook or chat_ui ships (chat_ui-A1 should call this endpoint at conversation creation).

### A3. Scoring/filtering — three layers, in order

The twin returns up to 50 candidate memories on a typical query. Filter to ~10 that matter for THIS session:

1. **Rule-based pre-filter** — applied per source table, before semantic ranking:
   - `idea_inbox`: status = `active` AND score >= threshold AND (no `dismissed_at`); recency cap 60 days.
   - `decisions_log`: superseded = false AND tag overlap with current scope OR recency cap 14 days.
   - `agent_events`: action ∈ {`ship.*`, `deploy.*`, `decision.*`, `escalate.*`, `blocker.*`} AND last 7 days.
   - `task_queue`: status ∈ {`queued`, `running`} AND priority ≤ 3.
2. **Semantic ranking** — when the digest is being built for a _targeted_ session (e.g., "Sprint 5 Dropbox" handoff), rerank pre-filtered rows by pgvector similarity to a session topic string. When no topic, skip semantic and use recency.
3. **Section budget cap** — fixed budgets per section: top 10 ideas, top 5 decisions, top 5 events, top 5 tasks. Each section emits "and N more — see /memory/idea-inbox" when capped.

### A4. `idea_inbox` ↔ `scout_agent` connection

`scout_agent` is foundation-spec component #15 (specialized*agents role added in `f846d53`). It is a \_producer*; `idea_inbox` is the _queue_.

- Scout writes rows with `source = 'scout_agent'`, `score` derived from its leverage rubric, `metadata.scout_run_id` for traceability.
- The inbox `source` enum is locked from day one (see M2 schema). Until scout ships, the producers are:
  - `manual_telegram` — Telegram bot (already integrated via `outbound_notifications` pattern, inverse direction)
  - `manual_api` — `POST /api/memory/idea` from any client (Colin, Claude Code, future chat_ui)
  - `manual_cli_backlog` — one-shot import from `memory/feature_backlog.md`
  - `session_decision_overflow` — sessions noting an idea but not actioning it (writes here instead of dropping it on the floor)
- The locked enum lets us measure scout signal-to-noise vs. manual ideas without a retrofit migration once scout starts producing.

---

## Component specs

### M1. `digital_twin` (the existing component, scope expanded)

No code changes to `app/api/twin/ask/route.ts`. The retrieval substrate (`knowledge` table + pgvector + FTS) is unchanged.

**What changes:** `SEARCHABLE_CATEGORIES` (currently `['personal_correspondence','personal_knowledge_base','principle','rule']`) expands to include `idea` and `decision`.

**Files:**

- [`app/api/twin/ask/route.ts`](../../app/api/twin/ask/route.ts) — one-line update to category whitelist.
- [`scripts/ingest-claude-md.ts`](../../scripts/ingest-claude-md.ts) — F-L14 fix lands here in parallel: drive entity list from `lib/rules/registry.ts` instead of static array.

### M2. `idea_inbox` table

Where ideas land from any source. Status-tracked. Twin-queryable.

**Schema (Migration 0044, first table):**

```sql
CREATE TABLE public.idea_inbox (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Free-text body
  title         TEXT         NOT NULL,
  body          TEXT,                                       -- optional long-form
  summary       TEXT,                                       -- ≤ 200 chars, used in digest

  -- Provenance — producer attribution. Locked enum from day one so scout vs.
  -- manual signal-to-noise is measurable without retrofit (Draft 2 redline).
  source        TEXT         NOT NULL
                CHECK (source IN (
                  'manual_telegram',          -- Colin texts via Telegram bot
                  'manual_api',               -- POST /api/memory/idea (Colin or any human/agent)
                  'manual_cli_backlog',       -- one-shot import from memory/feature_backlog.md
                  'scout_agent',              -- scout_agent findings (foundation spec #15)
                  'session_decision_overflow' -- session noted an idea but didn't action it
                )),
  source_ref    TEXT,                                       -- chat_id, session_id, scout_run_id, etc.

  -- Lifecycle
  status        TEXT         NOT NULL DEFAULT 'parked'
                CHECK (status IN ('parked','active','shipped','dismissed')),
  score         NUMERIC(4,2) NOT NULL DEFAULT 0.50          -- 0.00–1.00, leverage estimate
                CHECK (score >= 0 AND score <= 1),

  -- Tags + linkage
  tags          JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- array of strings
  related_task_id UUID       REFERENCES public.task_queue(id) ON DELETE SET NULL,

  -- Lifecycle timestamps
  promoted_at   TIMESTAMPTZ,                                -- parked → active
  shipped_at    TIMESTAMPTZ,                                -- active → shipped
  dismissed_at  TIMESTAMPTZ,                                -- → dismissed (with reason in body)

  -- Generated FTS
  fts           tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,'') || ' ' ||
      coalesce(summary,'') || ' ' ||
      coalesce(body,'')
    )
  ) STORED
);

CREATE INDEX idea_inbox_status_score_idx ON public.idea_inbox (status, score DESC, created_at DESC);
CREATE INDEX idea_inbox_source_idx       ON public.idea_inbox (source, created_at DESC);
CREATE INDEX idea_inbox_fts_idx          ON public.idea_inbox USING GIN (fts);

ALTER TABLE public.idea_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "idea_inbox_authenticated" ON public.idea_inbox
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
```

**Twin integration (DB trigger, in same migration):**

```sql
-- AFTER INSERT/UPDATE on idea_inbox → upsert mirrored row into knowledge with category='idea'
-- Embedding stays NULL until the next ingest job runs (existing pattern; not blocking).
CREATE OR REPLACE FUNCTION public.idea_inbox_mirror_to_knowledge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.knowledge (entity, category, domain, title, problem, solution, context, confidence, tags)
  VALUES (
    'idea_inbox:' || NEW.id::text,
    'idea',
    'memory',
    NEW.title,
    NULL,
    NEW.summary,
    coalesce(NEW.body,'') || ' [status=' || NEW.status || ', source=' || NEW.source || ']',
    NEW.score,
    NEW.tags
  )
  ON CONFLICT (entity) DO UPDATE SET
    title = EXCLUDED.title,
    solution = EXCLUDED.solution,
    context = EXCLUDED.context,
    confidence = EXCLUDED.confidence,
    tags = EXCLUDED.tags,
    updated_at = now();
  RETURN NEW;
END;
$$;
-- Note: this requires `entity` to be UNIQUE in `knowledge`. The current schema indexes it
-- but does not enforce uniqueness. Migration 0044 adds: ALTER TABLE knowledge
-- ADD CONSTRAINT knowledge_entity_unique UNIQUE (entity); — backfill must dedupe first.

CREATE TRIGGER idea_inbox_to_knowledge
  AFTER INSERT OR UPDATE ON public.idea_inbox
  FOR EACH ROW EXECUTE FUNCTION public.idea_inbox_mirror_to_knowledge();
```

**Endpoint:** `POST /api/memory/idea` — body `{ title, body?, summary?, source, source_ref?, tags?, score? }`. Returns `{ id, status }`.

### M3. `decisions_log` table

Append-only-ish log of architectural/spec decisions. Every redline cycle, every non-obvious choice. Queryable months later.

**Schema (Migration 0044, second table):**

```sql
CREATE TABLE public.decisions_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- What
  topic           TEXT         NOT NULL,                       -- "Memory layer architecture"
  context         TEXT,                                        -- the situation / problem
  options_considered JSONB     NOT NULL DEFAULT '[]'::jsonb,   -- array: [{label, summary, rejected_reason?}]
  chosen_path     TEXT         NOT NULL,                       -- the decision in one sentence
  reason          TEXT,                                        -- why this option

  -- Classification
  category        TEXT         NOT NULL DEFAULT 'architecture'
                  CHECK (category IN ('architecture','scope','data-model','tooling','process','principle','correction')),
  tags            JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Provenance — `decided_by` is the actor; `source` is the capture pipeline.
  -- Both locked from day one for downstream attribution analytics (Draft 2 redline).
  decided_by      TEXT         NOT NULL DEFAULT 'colin'
                  CHECK (decided_by IN ('colin','coordinator','agent','consensus')),
  source          TEXT         NOT NULL
                  CHECK (source IN (
                    'redline_session',         -- Colin redlining a spec/PR/acceptance doc
                    'morning_digest_response', -- decision captured from a digest reply
                    'incident_response',       -- triage decision during a live incident
                    'post_mortem'              -- decision recorded during a retro / post-mortem
                  )),
  source_ref      TEXT,                                        -- file path, PR number, session id
  related_files   JSONB        NOT NULL DEFAULT '[]'::jsonb,   -- array of repo paths

  -- Supersession chain (for "we changed our minds about X")
  supersedes_id   UUID         REFERENCES public.decisions_log(id) ON DELETE SET NULL,
  superseded_at   TIMESTAMPTZ,                                 -- non-null = this row is no longer active

  -- Generated FTS
  fts             tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(topic,'') || ' ' ||
      coalesce(context,'') || ' ' ||
      coalesce(chosen_path,'') || ' ' ||
      coalesce(reason,'')
    )
  ) STORED
);

CREATE INDEX decisions_log_active_idx ON public.decisions_log (decided_at DESC) WHERE superseded_at IS NULL;
CREATE INDEX decisions_log_category_idx ON public.decisions_log (category, decided_at DESC);
CREATE INDEX decisions_log_fts_idx     ON public.decisions_log USING GIN (fts);

ALTER TABLE public.decisions_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decisions_log_authenticated" ON public.decisions_log
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
```

**Twin integration (DB trigger, identical pattern to M2):** mirrors to `knowledge` with `category='decision'`, `entity='decisions_log:{uuid}'`. When `superseded_at` flips to non-null, mirror row's confidence is cut in half (knowledge stays correct without losing history).

**Seed corpus:** the existing `docs/decisions/*.md` files (currently 3 files) get one-shot ingested by `scripts/ingest-decisions.ts` — one row per file, `decided_by='colin'`, `source='redline_session'` (these all originated as session redlines), `category` parsed from filename or front-matter.

**No new endpoint** — decisions are written by coordinator / Claude Code via `mcp__claude_ai_Supabase__execute_sql` or by extending the existing `acceptance-doc-approved` event flow to also INSERT here. (See M5 priority.)

> **REDLINE 2026-04-28 (Option A — applied at chunk #1 ship):**
>
> Migration 0044 ships a **partial unique index** scoped to entity prefix `'decisions_log:%'` instead of the table-wide `knowledge.entity UNIQUE` constraint specified above. The mirror trigger's `ON CONFLICT (entity) WHERE entity LIKE 'decisions_log:%'` matches that partial index.
>
> **Why:** pre-flight against prod found ~270 duplicate non-null `entity` values in `knowledge` (e.g., "Janice Jones" 541 dups, "Colin Loeppky" 2026, "megan" 1179) — the personal-archive corpus has been ingesting same-entity rows from multiple sources for months. A table-wide UNIQUE would have required destructive dedupe of thousands of rows with no defined win-rule.
>
> **Effect:** memory-layer rows have unique-by-entity guarantees; existing personal-archive dups are untouched and still retrievable through twin's existing FTS path. Idea_inbox chunk #2 will add a sibling partial index for the `'idea_inbox:%'` prefix (same pattern, scoped predicate).
>
> **Follow-up:** task_queue row `task='knowledge_dedupe'` filed at chunk #1 ship. When prioritized: define win-rule (highest `times_used` then most recent `updated_at`), build dedup script, take backup, run it, then upgrade partial indices to table-wide UNIQUE if data shape supports it. Multi-hour chunk, own acceptance doc.
>
> **Spec impact:** §M2 (idea_inbox) inherits the same partial-index pattern when chunk #2 ships. The "Migration scope" section's pre-flight assumption ("Expected: 0 rows") is superseded for chunks #1–#3; restore once `knowledge_dedupe` runs.

**Shipped:** 2026-04-28 — migration 0044 applied to prod; route `POST /api/memory/decision` deployed; twin `SEARCHABLE_CATEGORIES` whitelist expanded with `decision` + `idea`; 11 seed rows from today's redline + post-mortem sessions captured. `harness:digital_twin.completion_pct` re-scored 85 → 62 reflecting expanded memory-layer scope (decisions_log ~90%; idea_inbox + session_digest still pending). Follow-on `task_queue.knowledge_dedupe` filed for partial-index → table-wide upgrade.

### M4. `session_digests` table + composer

The header block every session loads on entry. Output is markdown.

**Schema (Migration 0044, third table):**

```sql
CREATE TABLE public.session_digests (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Session context
  branch        TEXT,                                       -- git branch when fetched
  topic         TEXT,                                       -- optional: session focus for semantic rerank
  requested_by  TEXT,                                       -- 'startup-skill','manual','chat-ui','api'

  -- Output
  markdown      TEXT         NOT NULL,                      -- the rendered digest
  sections      JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- structured: { rollup: {...}, ideas: [...], decisions: [...], events: [...], tasks: [...] }

  -- Metrics
  bytes         INT          NOT NULL,
  build_ms      INT
);

CREATE INDEX session_digests_recent_idx ON public.session_digests (generated_at DESC);

ALTER TABLE public.session_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_digests_authenticated" ON public.session_digests
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
```

**Composer:** `lib/memory/session-digest.ts`

```typescript
export interface SessionDigest {
  markdown: string
  sections: {
    header: { date: string; branch: string }
    rollup: { harness_pct: number; product_pct: number | null; harness_delta: number | null }
    open_scope_docs: Array<{ path: string; updated_at: string }>
    recent_events: Array<{ action: string; actor: string; occurred_at: string; summary: string }>
    top_ideas: Array<{ id: string; title: string; score: number; status: string }>
    recent_decisions: Array<{ id: string; topic: string; chosen_path: string; decided_at: string }>
    open_tasks: Array<{ id: string; task: string; priority: number; status: string }>
  }
  bytes: number
  build_ms: number
}

export async function buildSessionDigest(opts: {
  topic?: string
  requested_by: string
  budget_bytes?: number // default 6000 (≈ 1500 tokens)
}): Promise<SessionDigest>
```

**Sources reused (no new builders):**

- Rollup line: existing `buildHarnessRollupLine()` from `lib/harness/rollup.ts`.
- Open scope docs: `git ls-files docs/sprint-*/* docs/harness/* | filter mtime < 7d AND not closed` (closed = file contains `Status: shipped|closed|merged`).
- Recent events: `agent_events` SELECT with action prefix filter (above).
- Top ideas: `idea_inbox` SELECT with §A3 filter.
- Recent decisions: `decisions_log` SELECT WHERE superseded_at IS NULL AND decided_at > now() - 14d.
- Open tasks: `task_queue` SELECT WHERE status IN ('queued','running') AND priority ≤ 3.

**Endpoint:** `GET /api/memory/session-digest?topic=&requested_by=startup-skill` returns `{ markdown, sections }` and writes a `session_digests` row.

**Slash-command integration:** `/startup` skill extended to:

1. Call the endpoint with `requested_by='startup-skill'` and `topic` derived from current branch name.
2. Prepend the returned markdown to its existing briefing output.
3. Cache the digest id so subsequent `/startup` calls within the same session reuse rather than rebuild.

---

## Migration scope — `0044_memory_layer_schema.sql`

**Single migration, four logical sections. ~250 lines, mostly DDL.**

```sql
-- 0044_memory_layer_schema.sql
-- Memory Layer: idea_inbox, decisions_log, session_digests + knowledge entity uniqueness.
-- Spec: docs/harness/MEMORY_LAYER_SPEC.md
--
-- 1. Backfill-dedupe knowledge.entity, then ALTER TABLE knowledge ADD CONSTRAINT knowledge_entity_unique.
-- 2. CREATE TABLE idea_inbox (M2) + RLS + trigger to mirror into knowledge.
-- 3. CREATE TABLE decisions_log (M3) + RLS + trigger to mirror into knowledge.
-- 4. CREATE TABLE session_digests (M4) + RLS.
-- 5. INSERT one decisions_log row recording THIS spec's decision (memory-layer-extends-twin).
```

**Pre-migration check (must run before INSERTing the constraint):**

```sql
-- Returns rows that violate the impending UNIQUE constraint
SELECT entity, COUNT(*) FROM knowledge GROUP BY entity HAVING COUNT(*) > 1;
-- Expected: 0 rows (entity was indexed but not unique; any duplicates are bugs to fix first).
```

**Rollback:**

```sql
DROP TABLE IF EXISTS public.session_digests;
DROP TRIGGER IF EXISTS decisions_log_to_knowledge ON public.decisions_log;
DROP TRIGGER IF EXISTS idea_inbox_to_knowledge ON public.idea_inbox;
DROP FUNCTION IF EXISTS public.decisions_log_mirror_to_knowledge();
DROP FUNCTION IF EXISTS public.idea_inbox_mirror_to_knowledge();
DROP TABLE IF EXISTS public.decisions_log;
DROP TABLE IF EXISTS public.idea_inbox;
ALTER TABLE public.knowledge DROP CONSTRAINT IF EXISTS knowledge_entity_unique;
```

---

## Acceptance criteria (per F21 — written before code)

### A. Schema lands cleanly

- [ ] Migration 0044 applies on prod. `list_tables` returns three new tables.
- [ ] `SUM(weight_pct) FROM harness_components = 100` (unchanged — no new rows).
- [ ] No `ON CONFLICT` failures in the seed step.

### B. Idea inbox round-trips through twin

- [ ] `POST /api/memory/idea {title:'test idea',source:'manual_api'}` returns 201 + `{id, status:'parked'}`.
- [ ] Within ≤ 1s, `SELECT 1 FROM knowledge WHERE entity = 'idea_inbox:'||$id` returns 1 row.
- [ ] `POST /api/twin/ask {question:'what is the test idea?'}` retrieves it via FTS path (vector path fails until embedding ingest runs — both pass acceptance).

### C. Decisions log captures this spec

- [ ] One seeded row in `decisions_log` recording: topic="Memory layer architecture", chosen_path="extend digital_twin scope; add 3 tables; no new harness component row", decided_by='colin', source='redline_session' (after redline approval).
- [ ] `POST /api/twin/ask {question:'what was the memory layer architecture decision?'}` returns the chosen_path text in its answer.

### D. Session digest produces a non-empty header on first call

- [ ] `GET /api/memory/session-digest` returns 200, `bytes > 0`, all 7 sections present.
- [ ] `bytes ≤ 6000` for the default budget.
- [ ] One row appended to `session_digests`.
- [ ] When `idea_inbox` is empty, the `top_ideas` section emits `_(no active ideas)_` rather than vanishing.

### E. `/startup` integration

- [ ] Running `/startup` in a fresh window produces output where the first ~80 lines are the session-digest markdown.
- [ ] If the endpoint fails (Supabase down, etc.), `/startup` falls back to its prior behavior with a `Memory layer: unavailable` line. **Never blocks session start.**

### F. F19 honesty correction lands

- [ ] After 0044 is applied: `digital_twin.completion_pct` updated from 85 → 50 (or whatever the redline blesses) via a follow-up `UPDATE` in the same PR.
- [ ] `morning_digest` next run shows the rollup drop and a one-liner explaining why.

---

## Priority order (the kickoff's last question)

Build in this order. Each item is a chunk-sized slice (acceptance-doc-able).

| #   | Slice                                          | Effort | Why first / Notes                                                        |
| --- | ---------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 1   | **decisions_log table + seed ingest**          | ½ day  | Smallest, immediate value — captures _this very spec's_ decision.        |
| 2   | **idea_inbox table + `POST /api/memory/idea`** | 1 day  | Existing seed in `memory/feature_backlog.md`. Telegram producer follows. |
| 3   | **knowledge.entity UNIQUE + mirror triggers**  | ½ day  | Bridges (1) and (2) to the twin. Must land before (4) is useful.         |
| 4   | **Twin category whitelist expansion + F-L14**  | ½ day  | One-line route change + ingest-claude-md.ts registry-driven rewrite.     |
| 5   | **session_digest composer + endpoint + table** | 1–2 d  | Most integration points. Depends on (1)–(4).                             |
| 6   | **`/startup` slash-command extension**         | ½ day  | Trivial once (5) is live. Closes the user-visible loop.                  |
| 7   | **digital_twin re-score + foundation update**  | ½ day  | Edit `HARNESS_FOUNDATION_SPEC.md` digital_twin row + 0044's UPDATE step. |

Total: **~5 days end-to-end**, fully serial. With parallelism (1+2 in different windows, 3 after both, 4 in parallel with 5), **~3 days wall-clock.**

**Stop conditions / off-ramp:** if (5) blows up the session-init context budget (>6KB markdown), the spec needs a redline before continuing — section budgets shrink or sections drop. Don't ship a bloated digest.

---

## Out of scope (not built here, named for the avoidance of doubt)

- `scout_agent` — separate spec; this doc only defines the _queue_ it will write to.
- Auto-injection of digest at Claude Code session start — no reliable hook today; revisit when chat_ui ships or Claude Code adds one.
- Multi-user RLS hardening on the three new tables — `auth.uid() IS NOT NULL` matches the current single-user pattern (see SPRINT5-GATE comments in 0011 / 0015 / 0017).
- Richer scoring on `idea_inbox.score` — manual / source-derived for v1; learned scoring is a follow-on.
- UI for browsing the inbox / decisions log — covered by chat_ui (component #14, gated separately) or a future `/memory` page.
- Replacing the four current memory locations (Anthropic memory, CLAUDE.md, repo files, past chats). This spec _augments_; deprecation of the old surfaces is a separate decision per surface.

---

## Integration plan with `HARNESS_FOUNDATION_SPEC.md`

Single follow-on edit to the foundation spec, applied at the same time as 0044's UPDATE step (see acceptance F):

1. Replace `digital_twin` block in §"T3 — Agentic capabilities" with the expanded scope wording from §A1 above.
2. Update the "Why 85%" line to "Why 50%" with the sub-system breakdown table.
3. Update the rollup math table footer: `T3` total `12.1 → 8.8`; total `55.7 → 52.4`. Annotate: "Drop from 55.7 → 52.4 reflects honest re-scoring of digital_twin to include memory-layer scope (idea_inbox, decisions_log, session_digest). See MEMORY_LAYER_SPEC.md §A1."
4. In the Priority section, replace `digital_twin (85 → 95%)` with `digital_twin (50 → 95%)` and link to this doc's §"Priority order".

No other foundation-spec edits.

---

## Working agreement reminders (per kickoff)

- Specs first, code second.
- No padding. Honest numbers. Twin drops to 50% — that's the right answer.
- Acceptance tests written before building (§ Acceptance criteria, above).
- Doc-as-source: this file is authoritative; migration 0044 follows it.
- Read existing files before drafting anything new — done; sources cited inline.
