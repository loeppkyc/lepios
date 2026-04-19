# runbook-autonomous-build.md

How Colin operates the two-agent sprint loop. What he does, what the agents do, when control snaps back to him.

---

## The mental model

- **Colin** is the judgment source. Principles get cached, decisions get cached. Judgment does not.
- **Coordinator** is Colin's narrower cached self. It decides when a cache hit is safe vs. when to hand back.
- **Builder** is Claude Code with blinders on. It does what the acceptance doc says and reports in a fixed shape.

Control flows: Colin → coordinator → builder → coordinator → Colin (at grounding checkpoints, escalations, or sprint close).

---

## Launching a sprint

1. **Write the sprint brief.** One file at `docs/sprint-{N}/brief.md`. Minimum:
   - Sprint name and number
   - Kill-criterion question (the `ARCHITECTURE §11` "does this make or save money this week" style)
   - High-level chunk list (coordinator will refine, but it needs a seed)
   - Any known grounding surfaces ("must scan a real book by Chunk A")
   - Reference files (Streamlit modules) by path
2. **Initialize sprint-state.** Write `docs/sprint-state.md` per Appendix A schema. Set `cache_match_enabled` and `cache_match_reason` explicitly — for Sprint 4, `false` / `"Sprint 4 baseline"`. For Sprint 5+, `true` / `"enabled"` only after the auto-proceed log audit (Appendix B).
3. **Confirm governance files exist.** Before coordinator is summoned, these must be present at repo root:
   - `docs/handoffs/auto-proceed-log.md` with footer `last_reviewed_by_colin_at: null` on first run, or a real timestamp from the prior sprint's audit
   - `docs/handoffs/principle-evolution.md` (bootstrapped at deployment with Sprint 3 seed entries)
   - `docs/handoffs/cost-log.md` (empty on first run; append-only thereafter)
   - `docs/colin-principles.md` (ratified set, unchanged since last sprint's evolution log entries)
     A missing file here isn't recoverable mid-sprint — coordinator will fail Phase 0 and escalate immediately. Better to confirm before kickoff than triage during.
4. **Summon coordinator.** Point it at the brief:
   > Use the coordinator sub-agent. Read `docs/sprint-{N}/brief.md` and produce a sprint plan at `docs/sprint-{N}/plan.md`. Escalate the plan to me for ratification.
5. **Review the plan.** Coordinator returns with a chunk decomposition, ordering rationale, and grounding surfaces per chunk. You read, edit, approve. This is the one place you must approve — everything downstream flows from here.
6. **Give the go.** A one-liner is enough:
   > Plan approved. Proceed through chunks per the decomposition. Follow the escalation rules.

From here, coordinator drives. You go do something else.

---

## What you do during a run

Three things, in order of how often they happen:

### 1. Grounding checkpoints (most common)

Coordinator surfaces one via a structured handoff:

```
## sprint-3 chunk-a phase-5
Status: awaiting-grounding
What I did: Builder shipped chunk A. Deploy at {url}.
What I need from you: Scan 3 real books on the live /scan page. Verify estimated profit matches Amazon CA buy-box within $0.50.
Why I stopped: Principle 14 — grounding checkpoint required before next chunk.
Artifacts: docs/sprint-3/chunk-a-handoff.json
```

You do the scan. You reply with one of:

- **`pass`** → coordinator advances to next chunk
- **`fail: {what you saw}`** → coordinator applies rollback (Principle ROLLBACK), chooses patch-forward or revert, keeps going, or escalates halt
- **`pivot: {what changed}`** → coordinator stops, proposes doctrine edit, waits

Keep replies short. Coordinator is not a conversation partner; it's a switch.

### 2. Escalations (less common)

Coordinator hits one of the escalation rules and hands back:

```
## sprint-3 chunk-d phase-2
Status: escalated
What I did: Drafted acceptance doc for buyback integration.
What I need from you: New terrain — we haven't shipped a vendor integration before. Principle 15 says don't predict. See docs/sprint-3/chunk-d-acceptance.md for my draft and open questions.
```

You read the doc, decide, reply:

- **`approved`** (maybe with edits) → coordinator proceeds
- **`escalate-further: {reason}`** → rare; means the doc itself is wrong. You re-scope.
- **`defer: {reason}`** → chunk gets parked, coordinator re-plans remaining sprint

### 3. Sprint close (rare)

Coordinator writes `docs/sprint-{N}/close.md` and surfaces proposed additions to `colin-principles.md`. You review:

- Move proposed principles from `## Proposed` to ratified, edit as needed
- Confirm sprint done per SPRINT-DONE principle (including the real-world session test — for Sprint 3, that pallet run with ≥5 real books)
- Update `ARCHITECTURE.md §7` queue if anything shifted

---

## What you don't do

- You don't read builder output directly. Coordinator validates structured handoffs; if something reaches you, coordinator already decided it needs your eyes.
- You don't touch code. Ever. If builder ships something broken and coordinator doesn't catch it, that's a coordinator-config bug — fix `coordinator.md`, not the code.
- You don't chase cosmetic issues mid-sprint. They go to backlog per Principle 13.
- You don't revisit decisions mid-sprint unless a grounding checkpoint or pivot signal justifies it. Principle 18 cuts both ways: pivoting doctrine is cheap, but pivoting on a whim is expensive too.

---

## When the loop escalates to you

Summarized from `coordinator.md` — memorize this list:

1. **Grounding checkpoint result required.** Scan, price, dollar figure, DB query read-through.
2. **New terrain** (Principle 15) — chunk pattern doesn't match anything cached.
3. **Pivot signal** (Principle 18) — new information contradicts the sprint plan.
4. **Destructive op** (Principle 19) — drop, force, delete, rotate.
5. **META-C fails** — cached match exists but one of (a/b/c) doesn't hold.
6. **Principle conflict unresolved by META-A** — two ALWAYS principles collide.
7. **Doctrine edit proposed** — `ARCHITECTURE.md` or `CLAUDE.md` would need changing.
8. **Cost anomaly** — chunk or sprint burn exceeds 2x estimate.
9. **Canonical write staged** — ledger, audit, tax, user-visible money. Colin is the Reality-Check Agent until that agent is built (Sprint 5+).
10. **Instinct mismatch** (Principle 12) — data vs. instinct diverge at a grounding moment.
11. **Halt-sprint rollback option** (ROLLBACK option 3) — coordinator can't choose this alone.
12. **Coordinator uncertainty** — coordinator notices itself reaching for "probably Colin would want…" and stops.

If coordinator stops for anything outside this list, that's a config bug — refine `coordinator.md` and `colin-principles.md` so the pattern is either cacheable or explicitly on this list.

---

## Failure modes to watch for

### Coordinator over-escalates

You're doing too much manual approval. Look at `docs/handoffs/auto-proceed-log.md` — if it's empty after a sprint, coordinator isn't using its cached authority. Principles are either too tight or META-C is being applied too conservatively. Add cases to `colin-principles.md`, make trigger conditions more permissive on reversible actions.

### Coordinator under-escalates

You're finding bugs coordinator should have caught. Look at the auto-proceeded chunks that failed grounding. The principles that "cache-matched" those chunks need tightening — or a new escalation rule belongs on the list above.

### Builder builds outside scope

Handoff `files_changed` contains files not in the acceptance doc's expected list. Builder was supposed to stop. Either builder-config needs strengthening or acceptance doc was too vague. Usually the latter.

### Acceptance doc drift

You find yourself editing acceptance docs repeatedly. Coordinator's draft quality is low — add more examples under `## Proposed` principles, or tighten the acceptance-doc schema in `coordinator.md` Phase 2.

### Principle count explosion

If `colin-principles.md` grows past ~50 ratified principles, retrieval starts failing — coordinator can't pattern-match a haystack. Consolidate: prefer fewer, broader principles with clear trigger bounds over many narrow ones. Sprint-specific decisions belong in sprint-state, not principles (META-B).

---

## Cost monitoring

Every coordinator and builder run appends to `docs/handoffs/cost-log.md`. At the end of each sprint, scan the totals:

- Per-chunk average: builder chunks should land in the low thousands of tokens for tight scope; coordinator phases similar
- Escalation ratio: escalations / total handoffs — trending down across sprints is the signal the principle cache is working
- Auto-proceed ratio: auto-proceeded chunks / total chunks — trending up is the same signal, from the other direction

If either ratio stalls across 2+ sprints, the principle set has plateaued — time to add new ones from whatever you've been manually deciding repeatedly.

---

## The one thing that never changes

Grounding-checkpoint authority is yours. Coordinator never decides that a real book doesn't need scanning, a real price doesn't need verifying, a real dollar figure doesn't need reconciling. If it ever does, that's a Tier 0 violation — kill the run, fix the config, start over.

Everything else is negotiable. That one isn't.

---

## Appendix A — `docs/sprint-state.md` schema

Single YAML file. Coordinator writes; builder reads. Overwritten each update, never appended. On sprint close, archived to `docs/sprint-{N}/state-final.md` before being reset for the next sprint.

```yaml
active_sprint: 4 # integer, the current sprint number
active_chunk: 'chunk-a' # string id matching docs/sprint-{N}/chunk-{id}-acceptance.md, or null between chunks
status: 'in-build' # enum — see below
last_handoff_path: 'docs/sprint-4/chunk-a-handoff.json' # path to most recent handoff artifact, coordinator or builder
awaiting: 'builder' # enum — see below
kill_criterion_answer: null # null until sprint close; then "yes" | "no" | "partial"
opened_at: '2026-04-20T09:00:00-06:00' # ISO 8601, MT for Colin
last_updated_at: '2026-04-20T11:42:00-06:00' # ISO 8601, updated on every write

# Cache-match governance (set by coordinator Phase 0)
cache_match_enabled: false # boolean
cache_match_reason: 'Sprint 4 baseline' # string — "Sprint 4 baseline" | "audit pending" | "enabled" | other Colin override

# Sprint metadata (set at intake, read-only after)
brief_path: 'docs/sprint-4/brief.md'
plan_path: 'docs/sprint-4/plan.md'
kill_criterion: 'Does this make or save money this week?'

# Progress
chunks_planned: ['chunk-a', 'chunk-b', 'chunk-c']
chunks_complete: []
chunks_escalated: [] # chunks that required Colin mid-flight
chunks_rolled_back: [] # chunks that hit ROLLBACK option (b)
```

### Enum: `status`

- `draft` — brief exists, no plan yet
- `planning` — coordinator decomposing chunks
- `awaiting-plan-approval` — plan ratification escalated to Colin
- `in-acceptance-doc` — coordinator drafting acceptance doc for active_chunk
- `awaiting-doc-approval` — acceptance doc escalated to Colin (cache-match disabled, META-C failed, or explicit escalation)
- `in-build` — builder working
- `awaiting-grounding` — builder returned clean handoff; Colin must perform grounding checkpoint
- `awaiting-rollback-decision` — grounding failed, rollback option (c) under consideration
- `between-chunks` — chunk complete, next not yet started
- `closed` — sprint done per SPRINT-DONE principle
- `halted` — sprint stopped mid-flight, pivot or kill-criterion failure

### Enum: `awaiting`

- `colin` — waiting on human decision
- `builder` — waiting on builder chunk completion
- `coordinator` — waiting on coordinator's next phase (rare; usually transient)
- `nobody` — terminal state (closed, halted)

### Write discipline

- Coordinator overwrites on every phase transition
- Builder never writes this file; it reads on chunk start to confirm `active_chunk` matches the acceptance doc it was handed
- `last_updated_at` must always update when any other field changes — mismatch between `last_updated_at` and the most recent handoff timestamp is a signal that something skipped the state file

---

## Appendix B — Rollout mode

Sprint 4 runs cache-match-disabled by design. Sprint-state starts with:

```yaml
cache_match_enabled: false
cache_match_reason: 'Sprint 4 baseline'
```

This forces every acceptance doc through escalation so you see the real baseline volume — how many decisions genuinely need you vs. how many are pattern-matched.

Coordinator still writes the cache-match reasoning block to `auto-proceed-log.md` (with outcome = `escalated`) for every chunk, even though the chunk escalates anyway. That gives you the data to calibrate: at Sprint 5 review, look at the logged `confidence: high` entries where your actual decision matched what coordinator would have cached. Those are safe to enable. Entries where your decision diverged from coordinator's cache-match reasoning — those are the principles to refine before turning cache-match on.

To enable at Sprint 5:

1. Review `docs/handoffs/auto-proceed-log.md` from Sprint 4 end-to-end.
2. Update the footer `last_reviewed_by_colin_at: {timestamp}`.
3. Set sprint-state to `cache_match_enabled: true, cache_match_reason: "enabled"` at Sprint 5 intake.
4. Coordinator's Phase 0 check will confirm the audit is current and proceed.

If you ever want to disable cache-match ad-hoc mid-sprint (doctrine change, new domain, loss of confidence), overwrite sprint-state with `cache_match_enabled: false, cache_match_reason: "{your reason}"`. Coordinator reads this before every Phase 2 and complies.
