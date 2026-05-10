# H5 — Branch Pre-configuration on Coordinator Trigger

**task_id:** 844c49f2-1fe8-4026-a236-9fd3cfd9807d  
**hardening_id:** H5  
**source:** postmortem docs/autonomous-loop-postmortem-2026-04-27.md  
**written_at:** 2026-05-10  
**status:** awaiting-colin-approval

---

## Scope

Every coordinator session starts on a random Claude Code branch (`claude/vibrant-heisenberg-{random}`)
and requires the branch guard to correct it on every run. This chunk eliminates the "start wrong,
correct" pattern by ensuring the coordinator branch is set before any file write can occur.

**One acceptance criterion:** Zero `branch_guard_triggered` events appear in `agent_events` after
the fix ships across three consecutive coordinator runs (guard remains active but never needs to fire).

---

## Out of Scope

- Changing how the Routines API works (Anthropic platform — not ours to change)
- Modifying the branch guard safety net itself (it remains; we only change when it logs)
- Any changes to how `harness/task-{id}` branches are eventually merged to main
- Sprint 4 Chunk D work (separate sprint)

---

## Check-Before-Build Findings

### What exists

| File | Relevant finding |
|---|---|
| `lib/harness/invoke-coordinator.ts:59-73` | Routines API `fire` sends `{ text: "task_id: ...\nrun_id: ..." }`. Comment explicitly says branch selection happens in-session via guard. No branch param supported. |
| `.claude/agents/coordinator.md` §Branch Naming | Branch guard runs after Runtime Config read. Logs `branch_guard_triggered` (status=warning) when current ≠ expected. "Expected behavior: fires on every invocation." Alarm = zero events when fires happened. |
| `agent_events` table | `branch_guard_triggered` rows accumulate on every coordinator run — confirmed per postmortem timeline (2026-04-26 19:06:53). |

### No existing H5 implementation

No prior acceptance doc, no code changes attempted for this hardening item.

### API constraint confirmed

The Routines API `/fire` endpoint accepts only `{ text }` — no branch parameter. Confirmed in
coordinator.md (note dated 2026-04-28) and in `invoke-coordinator.ts` line 59 comment. Option (c)
("session configured via trigger config") is **not feasible** with current API.

---

## Approach (Two-Part)

### Part A — Routine system prompt update (Colin action)

Update the Routine's system prompt to add a Step 0 that runs before step 1 ("Read coordinator.md"):

```
Step 0 (execute first, before any other action):
Parse task_id from the INITIAL CONTEXT. Then run:
  git fetch origin 2>/dev/null; git checkout -b harness/task-{task_id} 2>/dev/null || git checkout harness/task-{task_id}
```

This ensures the session is on `harness/task-{task_id}` before coordinator.md is even read.
When the branch guard runs (as normal), current branch == expected branch → it logs
`branch_guard_passed` (success) and proceeds without logging the warning event.

**Colin required:** Routine system prompt lives in Anthropic console / Claude Code routine config.
Builder cannot touch it.

### Part B — coordinator.md branch guard refinement (builder)

Update the branch guard section in `.claude/agents/coordinator.md` to distinguish two cases:

| Case | Condition | Event logged | Status |
|---|---|---|---|
| Startup correction (old normal) | current ≠ expected, corrected | `branch_guard_triggered` | warning |
| Already correct (new normal after Part A) | current == expected | `branch_guard_passed` | success |

After Part A ships: every run logs `branch_guard_passed` (success). `branch_guard_triggered` becomes
the genuine-alarm signal — fires only if something is wrong (expected branch missing, task_id absent,
unexpected starting branch).

Update coordinator.md alarm condition from:
> "alarm: zero events when fires happened means guard did not run"

To:
> "alarm: zero `branch_guard_passed` OR `branch_guard_triggered` events when fires happened means
> guard did not run. `branch_guard_triggered` (warning) means Part A is not yet active or failed."

### Part C — invoke-coordinator.ts payload enhancement (builder, optional but recommended)

Add `BRANCH: harness/task-{task_id}` as first line of fire payload text, so the Routine system
prompt can parse it without regex:

```typescript
body: {
  text: `BRANCH: harness/task-${task_id}\ntask_id: ${task_id}\nrun_id: ${run_id}`,
}
```

Makes Part A's system prompt simpler: "read BRANCH: line, execute git checkout with that value."

---

## Files Expected to Change

| File | Change | Owner |
|---|---|---|
| Anthropic Routine system prompt | Add Step 0 git checkout | Colin (console) |
| `.claude/agents/coordinator.md` | Branch guard: add `branch_guard_passed` success path, update alarm condition | Builder |
| `lib/harness/invoke-coordinator.ts` | Add `BRANCH:` line to fire payload text | Builder |

No schema migrations. No new tables. No Vercel env changes.

---

## External Deps Tested

- Routines API `/fire` — confirmed only accepts `{ text }` (no branch param). No new API calls needed.
- `agent_events` table — `branch_guard_triggered` and `branch_guard_passed` both use existing schema
  (domain, action, actor, status, meta). No migration needed.

---

## Grounding Checkpoint

After both Part A (Routine system prompt updated) and Part B (coordinator.md updated) ship:

1. Trigger one coordinator run (queue a test task or wait for next pickup)
2. Query: `SELECT action, status, occurred_at FROM agent_events WHERE action IN ('branch_guard_triggered', 'branch_guard_passed') ORDER BY occurred_at DESC LIMIT 5`
   - Expect: `branch_guard_passed` (success), zero `branch_guard_triggered` rows
3. Confirm: three consecutive runs all show `branch_guard_passed` only
4. Confirm: morning digest no longer surfaces `branch_guard_triggered` count in F18 section

**Not a grounding checkpoint:** tests passing alone. Must verify live agent_events rows.

---

## Kill Signals

- If Routine system prompt cannot be updated (API restriction, console access issue) → Part B alone
  is insufficient. Escalate to Colin for alternative (e.g., accept the warning event as permanent
  and remove it from morning_digest noise).
- If Part A causes session startup failures (git checkout fails before coordinator.md is read and
  coordinator can't recover) → revert Part A immediately; guard in coordinator.md is the fallback.

---

## Cached-Principle Decisions

**cache_match_enabled: true** (sprint-state.md, confirmed 2026-05-01)

```
2026-05-10 sprint=5 chunk=H5-branch-preconfig doc=docs/sprint-5/h5-branch-preconfig-acceptance.md
cited_principles: [META-C, hardening-scope, reversibility]
trigger_match_evidence: |
  Hardening task — infrastructure-layer change with no Streamlit predecessor.
  All decisions are additive (new event name, payload line). No data deleted.
  Scope is tightly bound: 2 code files + 1 Routine config update.
reversibility_check: |
  coordinator.md change: reversible — git revert the file.
  invoke-coordinator.ts change: reversible — git revert the file.
  Routine system prompt: reversible — Colin edits it back via console.
  No schema changes. No destructive ops.
confidence: medium
```

**Escalating to Colin despite medium confidence** because Part A requires Colin's direct action
(Routine system prompt update) — it cannot be cache-matched past a Colin decision point.

---

## Open Questions for Colin

1. **Part A feasibility:** Can you update the Routine system prompt in Anthropic console to add
   the Step 0 git checkout? If console access is unavailable or restricted, Part A can't ship.

2. **Option preference:** The postmortem listed (a) payload-driven, (b) coordinator-first-step,
   (c) session config. This doc recommends a hybrid (payload line + system prompt step 0 = option a
   with Part B guard refinement). Is this the right read?

3. **Alarm condition:** After the fix, `branch_guard_triggered` becomes the alarm signal. Morning
   digest currently counts it as "expected." Should we suppress it from the expected count (so any
   occurrence after fix is visible) or leave digest logic unchanged?

4. **Twin unreachable:** Twin was unreachable at acceptance doc write time. Questions 1–3 above
   could not be pre-screened. Answering all three in one Telegram reply is sufficient.

---

## Sprint State Update

After Colin approves, coordinator will:
1. Queue builder task for Part B + Part C (code changes)
2. Flag Part A as Colin-action-required in sprint-state.md
3. Mark H5 complete only after grounding checkpoint passes (three runs, zero `branch_guard_triggered`)
