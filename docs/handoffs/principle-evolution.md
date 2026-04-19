# principle-evolution.md

Append-only log of every change to `docs/colin-principles.md`. Records what changed, when, why, and what sprint event prompted it. Exists so that six sprints from now you can ask "why did we say this?" and get an answer instead of reconstructing from git blame.

---

## How entries get added

1. **Coordinator proposes** a principle edit by writing it to `colin-principles.md` under `## Proposed`. At the same time, coordinator appends a draft entry to this file under `## Proposed Evolution Entries` (bottom). Both writes happen together or neither happens.
2. **Colin ratifies** by moving the principle from `## Proposed` to the ratified section in `colin-principles.md` AND moving the evolution entry from `## Proposed Evolution Entries` to the main log in this file. No ratification is complete without both moves.
3. **Colin may also edit directly** — changing a trigger, tightening a rule, retiring a principle — without coordinator involvement. Every direct edit still requires an entry here. Direct edits without an entry are a governance violation; future coordinator cannot trust principles whose history is missing.
4. **Builder never writes here.** Read-only for builder.

The cost of this discipline is ~30 seconds per ratification. The cost of skipping it is unanswerable "why" questions six months from now.

---

## How to read entries

Each entry has a consistent header and body shape. Scanning headers gives you the history; reading bodies gives you the reasoning.

**Header shape:** `### {YYYY-MM-DD} — {change_type}: {principle_id or label}`

**Change types:**

- `ADD` — new principle ratified
- `REVISE` — existing principle's rule or trigger changed (semantic change)
- `RETIRE` — principle removed from ratified set
- `SPLIT` — one principle became two or more
- `MERGE` — two or more principles collapsed into one
- `RETAG` — audience, strength, or tag changed; rule unchanged
- `WORDSMITH` — non-semantic clarification; body must justify why this isn't a REVISE

**Body fields:**

- **Prompted by:** sprint + chunk + specific event that motivated the edit
- **Before:** one-line summary of prior state (empty for ADD)
- **After:** one-line summary of new state (empty for RETIRE)
- **Why:** what we learned, what would have gone wrong without this edit
- **Ratified by:** Colin (always) — stated for audit-trail completeness
- **Links:** paths to the sprint close doc, acceptance doc, or chunk handoff that made the case

Keep bodies short. Detail belongs in the sprint close doc that prompted the edit; this file is an index, not a narrative.

---

## Main log

### 2026-04-19 — ADD: Principles 1–20 (bulk establishment)

**Prompted by:** Sprint 3 closing retrospective. Colin identified himself as the loop bottleneck between planner Claude and builder Claude Code, and requested a two-agent orchestration system for Sprint 4+. Building the coordinator required codifying the judgment patterns Colin had demonstrated during Sprint 3.

**Before:** No codified principles. Colin served as sole decision-maker per sprint.

**After:** 20 ratified principles spanning grounding, scope, data-integrity, external-deps, code-quality, pivot-detection, escalation, cost, deploy, and domain-amazon. Each tagged with strength (ALWAYS / DEFAULT) and audience (coordinator / builder / both).

**Why:** Sprint 3 Chunks A through E.2 revealed ~20 recurring decision patterns where Colin's judgment was pattern-matchable (the 80%). Codifying them enables coordinator to handle the predictable subset and reserves Colin's live attention for the irreducible 20%. The set was extracted by Claude as a first-pass seed, then reviewed principle-by-principle with Colin — each accepted, edited, or rejected explicitly.

**Ratified by:** Colin

**Links:**

- `docs/colin-principles.md` (ratified set)
- `docs/sprint-3/close.md` (TBD — sprint not yet closed at time of principle ratification)

**Note on format:** This is a bulk-establishment entry covering 20 principles added in a single review session. Ongoing entries should be per-principle; bulk entries are reserved for foundational events like this one.

---

### 2026-04-19 — ADD: META-A (conflict resolution)

**Prompted by:** Sprint 3 closing retrospective. Review revealed principles in different tags could point different directions in a real moment — e.g., Principle 13 ("defer cosmetic") vs. Principle 12 ("stop on mismatch").

**Before:** No codified tiebreak between conflicting principles.

**After:** ALWAYS-tagged principles in `grounding` / `data-integrity` / `escalation` outrank DEFAULT-tagged principles in `scope` / `code-quality` when they conflict. Safety preempts speed. Unresolved conflicts (two ALWAYS principles at genuine odds) escalate to Colin.

**Why:** Without a tiebreak, coordinator would either freeze on conflicts or pick arbitrarily. Explicit hierarchy lets coordinator resolve obvious cases autonomously and only escalate the genuinely ambiguous ones.

**Ratified by:** Colin

**Links:** `docs/colin-principles.md`

---

### 2026-04-19 — ADD: META-B (cache staleness)

**Prompted by:** Sprint 3 closing retrospective. Question of whether a prior-sprint decision (specific vendor choice, threshold number) should constrain a later sprint.

**Before:** No codified expiration policy for cached decisions.

**After:** Principles are sprint-agnostic (they encode _how_ Colin decides and are durable). Specific decisions (vendor choice, threshold numbers, schema trade-offs) expire at sprint boundaries unless explicitly re-ratified.

**Why:** Principles encode judgment style. Decisions encode context-specific tradeoffs. Conflating them causes coordinator to apply stale decisions to new contexts.

**Ratified by:** Colin

**Links:** `docs/colin-principles.md`

---

### 2026-04-19 — ADD: META-C (cached-match threshold)

**Prompted by:** Sprint 3 closing retrospective. Need to define when coordinator can act on a cached match vs. when to escalate.

**Before:** No codified threshold for cache-match action.

**After:** Coordinator can act on a cached match only when (a) trigger conditions match exactly, (b) no new information in this session contradicts the prior decision, (c) the action is reversible. Fail any → escalate. Later extended via coordinator config to require a structured reasoning block (cited_principles, trigger_match_evidence, reversibility_check, confidence level) before any cache-match proceeds.

**Why:** Pattern matching is the 80% shortcut; the 20% is where patterns look right but aren't. These three conditions exclude the most dangerous failure modes: approximate matches, stale context, and irreversible action. The structured reasoning requirement added during config design ensures coordinator cannot cache-match by feel — articulation is the gate.

**Ratified by:** Colin

**Links:** `docs/colin-principles.md`, `.claude/agents/coordinator.md` (Phase 2)

---

### 2026-04-19 — ADD: Operational principles (CHUNK-ORDERING, SPRINT-DONE, DECOMPOSITION-TRIGGER, BUILDER-HANDOFF-FORMAT, ROLLBACK)

**Prompted by:** Sprint 3 closing retrospective. Agent config design surfaced structural questions (chunk ordering rule, sprint-done definition, mid-flight decomposition triggers, builder-handoff shape, rollback policy) that needed codified answers before the autonomous loop could operate.

**Before:** No codified operational principles; structural decisions made ad-hoc per sprint.

**After:** Five operational principles establishing the mechanics of the autonomous loop. Four are coordinator-tagged; BUILDER-HANDOFF-FORMAT is both-tagged since builder authors the report and coordinator validates it.

**Why:** Coordinator and builder need shared mechanics to interoperate. Without codified versions, each coordinator run would re-derive them — expensive in tokens and error-prone across sessions.

**Ratified by:** Colin

**Links:** `docs/colin-principles.md`

---

### 2026-04-19 — ADD: Audience + strength tagging (schema)

**Prompted by:** Sprint 3 closing retrospective. Observation that principles split roughly 70/30 between coordinator-level judgment and builder-level execution; builder's prompt should pull only the execution-relevant subset to stay lean.

**Before:** No tagging schema on principles.

**After:** Every principle tagged with audience (`coordinator` | `builder` | `both`) and strength (`ALWAYS` | `DEFAULT`). Agents filter retrieval by audience. DEFAULT principles accept principled override per cited exception; ALWAYS principles do not.

**Why:** Reduces context load per agent (builder doesn't reason about escalation; coordinator doesn't reason about code-quality minutiae). Also enables META-A conflict resolution by strength comparison.

**Ratified by:** Colin

**Links:** `docs/colin-principles.md`, `.claude/agents/coordinator.md`, `.claude/agents/builder.md`

---

## Proposed Evolution Entries

_(Coordinator appends here alongside any proposed edit to `colin-principles.md`. Colin moves entries to the main log above on ratification. Builder never writes here.)_
