# Decision: Safety Agent Doctrine Direction

**Date:** 2026-04-28  
**Author:** Coordinator  
**Status:** Awaiting Colin's pick  
**Triggers §2 edit:** only after Colin approves one option below

---

## What the audit found

| Reference                          | Claim                                                                                         | Reality                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CLAUDE.md §2`                     | "Safety Agent reviews all migrations"                                                         | No agent file exists                                                                |
| `ARCHITECTURE.md §248`             | "Safety Agent reviews"                                                                        | Same — no agent                                                                     |
| `CLAUDE.md §1` harness steps       | "safety agent" listed as Step 1–5 complete                                                    | Unknown which harness component this maps to; no component doc named safety-agent   |
| `scripts/verify-safety.ts`         | Exists — scans for hardcoded API keys, Supabase service key pattern, Stripe keys, JWT secrets | Real, runs in CI, covers static secret detection only                               |
| `coordinator.md Non-negotiable #3` | "You never execute destructive operations and you never authorize builder to"                 | Real enforcement — coordinator reviews all migrations before builder applies        |
| `improvement-engine.ts:517`        | Emits "safety agent sign-off required" signals                                                | References a non-existent artifact; signal is still useful as a human-review prompt |
| `seed-real-knowledge.ts:243`       | Twin corpus seeded with Safety Agent as "always-on"                                           | Twin answers questions about Safety Agent as if it exists — drift from reality      |

**Actual migration safety today:**

- Static: `scripts/verify-safety.ts` in CI (secret pattern detection)
- Process: coordinator's Non-negotiable #3 (migration review before builder apply)
- Gap: no automated RLS policy correctness check; no structured review log; no agent

---

## Three options

### Option A — Build it as a real sub-agent now

Create `.claude/agents/safety-agent.md`. Scope: reads every new migration file before `apply_migration`, checks RLS policy presence on new tables, checks for DROP/TRUNCATE without Colin approval, logs result to `agent_events`.

- **Effort:** ~3–4h coordinator study + acceptance doc + builder task
- **Value:** Closes the fiction gap AND adds real safety leverage as harness scales
- **Risk:** Adds a new agent invocation to every migration path; needs acceptance doc first
- **Not appropriate as a doc-only task** — requires Sprint planning

### Option B — Rename the §2 claim to match reality

Change `CLAUDE.md §2` from:

> "Supabase (RLS enforced — Safety Agent reviews all migrations)"

To:

> "Supabase (RLS enforced — coordinator reviews all migration PRs before apply; `scripts/verify-safety.ts` handles static secret scanning)"

Same edit to `ARCHITECTURE.md §248`.

- **Effort:** 2-line edit across 2 files
- **Value:** Closes the fiction gap without building anything; accurate today
- **Risk:** None — no behavior changes, only doctrine accuracy
- **Twin corpus:** `seed-real-knowledge.ts:246` should also be updated to match or re-seeded

### Option C — Remove from §2 entirely

Remove the parenthetical from §2 Stack and ARCHITECTURE.md. Migration review is captured in coordinator.md Non-negotiable #3 and builder.md Step 3. §2 should describe the stack, not the process.

- **Effort:** 1-line removal across 2 files
- **Value:** Cleaner §2; no false claims
- **Risk:** Drops the visibility signal. Coordinators/builders reading §2 won't see the migration review requirement unless they also read coordinator.md §Non-negotiables. Signal loss on a safety-critical rule.

---

## Recommendation: **Option B**

Reasoning:

1. **A is out of scope for today.** Building a real sub-agent requires acceptance doc, Sprint planning, builder task. This is a doc-hardening session.

2. **C loses a load-bearing signal.** §2 is read by every session (it's the second thing in CLAUDE.md). Removing "migrations are reviewed" from that position means coordinators/builders need to remember to check coordinator.md Non-negotiables — which they may not do on a focused code task. The parenthetical earns its keep.

3. **B is accurate and complete.** `scripts/verify-safety.ts` does exist and does cover static secrets. Coordinator Non-negotiable #3 does cover migration approval. Naming both correctly closes the fiction without losing the safety signal.

4. **Twin corpus update needed regardless.** `seed-real-knowledge.ts:246` has "Safety Agent is always-on" in the Twin corpus. Even if we choose C, this claim stays in the Twin's knowledge until re-seeded. B gives the re-seed a correct replacement claim. Queue task: re-seed the safety-related corpus entry with the B wording.

---

## If Colin picks B — what gets changed

| File                                 | Old text                                                        | New text                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md §2`                       | `Supabase (RLS enforced — Safety Agent reviews all migrations)` | `Supabase (RLS enforced — coordinator reviews all migration PRs before apply; scripts/verify-safety.ts handles static secret scanning)`                             |
| `ARCHITECTURE.md §248`               | `Supabase (RLS enforced; Safety Agent reviews)`                 | `Supabase (RLS enforced; coordinator reviews all migration PRs before apply)`                                                                                       |
| `scripts/seed-real-knowledge.ts:246` | "The Safety Agent is always-on..."                              | Update to: "All migrations are reviewed by coordinator before builder applies (Non-negotiable #3). Static secret scanning runs via scripts/verify-safety.ts in CI." |

**Coordinator does NOT apply these edits.** Per coordinator.md Non-negotiable #4, CLAUDE.md and ARCHITECTURE.md are Colin's doctrine — coordinator proposes, Colin applies. `seed-real-knowledge.ts` is application code — builder applies after coordinator produces an acceptance mini-doc, or Colin applies directly.

---

## If Colin picks A — what happens next

Coordinator opens a task_queue row for "safety-agent-sub-agent" with Phase 1a–1d study required. Builds on top of the existing `scripts/verify-safety.ts` as the static layer; adds dynamic RLS-policy review as the acceptance criterion.

---

**Colin's pick:** ☐ A — Build the real agent &nbsp;&nbsp; ☐ B — Rename to match reality (recommended) &nbsp;&nbsp; ☐ C — Remove from §2 entirely
