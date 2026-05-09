# Acceptance Doc — husky-precommit-key-fix
**Sprint:** 5 | **Chunk ID:** husky-precommit-key-fix | **Category:** tooling | **Severity:** high
**Coordinator task_id:** efa60e5c-9a71-4dd9-9ce5-ce903068a439
**Written:** 2026-05-09 | **Status:** awaiting-colin-approval

---

## Scope

Two changes shipped together. Both address the same root cause: `ANTHROPIC_API_KEY` is not
exported to the shell environment where the Husky pre-commit hook runs, so the AI Reviewer
(Layer 2) has never run on Colin's local machine — 138 bypasses, 100% skip rate since Sprint 1.

**Part A (SEAM — requires `[seam-approved]` in commit message):**
In `.husky/pre-commit`, before the Layer 2 AI review block, add a surgical extraction block
that reads `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (if the file exists) into the hook's shell
environment. Keys are extracted via `grep` one-by-one (NOT `source .env.local` — wholesale
sourcing is risky because it exports every secret in one shot with no visibility). The block
is a no-op if `.env.local` is absent (CI / coordinator sandbox).

**Part B:**
In `scripts/ai-review.mjs`, the `logSoftSkip()` function also writes a row to `agent_events`
via Supabase REST (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) when those env
vars are present in `process.env`. The entry includes: `domain='tooling'`,
`action='review_bypass'`, `actor='pre-commit-hook'`, `status='warning'`, and `meta` with
`{ reason, branch, task_id_detected, timestamp }` where `task_id_detected` is parsed from
`harness/task-{uuid}` branch names (empty string otherwise).

**Acceptance criterion:**
After Part A: on Colin's next local commit (with `.env.local` present), the hook output shows
`[review] ── Reviewer Agent findings (ollama:qwen2.5:7b) ──` or
`(anthropic:claude-sonnet-4-6)` — NOT `SOFT-SKIP`. Zero new entries in `docs/review-skips.md`.
After Part B: when a soft-skip DOES occur (e.g., in the builder sandbox),
`SELECT action, meta FROM agent_events WHERE action='review_bypass' ORDER BY occurred_at DESC LIMIT 1`
returns a row with a real branch name and non-empty metadata (not a synthetic row).

---

## Out of Scope

- Changing the AI review prompt, output format, or review checklist
- CI integration for the AI review step (CI is intentionally soft-skip territory)
- Migrating or cleaning up the 138 historical entries in `docs/review-skips.md`
- Morning digest surfacing of bypass count (deferred — log first, then surface in a
  follow-up chunk once N days of real signal accumulate)
- Changing how Layer 0 (safety) or Layer 1 (lint-staged) work

---

## Files Expected to Change

| File | Change | Seam? |
|------|--------|-------|
| `.husky/pre-commit` | Add env-sourcing block before Layer 2 | **YES — [seam-approved] required** |
| `scripts/ai-review.mjs` | `logSoftSkip()` also writes to agent_events | no |
| `tests/scripts/ai-review-core.test.ts` | New tests for agent_events logging path | no |

No schema migration required. No new env vars introduced. `SUPABASE_SERVICE_ROLE_KEY` is
already in `.env.local` and already in `.env.example`.

---

## Check-Before-Build Findings

| Item | Finding |
|------|---------|
| `.husky/pre-commit` | No `.env.local` sourcing today. Has Layer 2 block: `if [ "${SKIP_AI_REVIEW}" != "1" ]; then node scripts/ai-review.mjs; fi`. This is the insertion point. |
| `scripts/ai-review.mjs` | Soft-skip already implemented (2026-05-05, PR #116 diet chunk). `logSoftSkip()` writes to `docs/review-skips.md` only. **No agent_events write today.** |
| `scripts/lib/ai-review-core.mjs` | `chooseProvider()` already returns `'soft-skip'` when neither Ollama nor Anthropic key available. No changes needed here. |
| `tests/scripts/ai-review-core.test.ts` | Covers `chooseProvider`, `parseFindings`, `REVIEW_SYSTEM_PROMPT`. Does NOT cover `logSoftSkip` or agent_events path. New tests needed. |
| `docs/review-skips.md` | File does not exist (never created — soft-skip path has never triggered in a way that called `logSoftSkip`; all 138 historical bypasses used `commit-skip.sh` which created the file then). |
| `agent_events` RLS | `INSERT` requires `authenticated + is_admin()`. Anon key insufficient. **Service role key required for the write.** |
| Synthetic `review_bypass` rows | Two rows in `agent_events` from 2026-04-24 with fake chunk IDs (`synthetic-test-001`, `synthetic-test-002`). These are from the original dismissed verification run. Grounding must confirm real rows, not these. |

---

## External Dependencies

No external API calls beyond Supabase REST (already used by the harness). No new network
dependencies. Supabase project: `xpanlbcjueimeofgsara`.

---

## Grounding Checkpoint

Colin performs these steps after deploy to his local machine (Part A) and builder commits Part B:

1. **Part A live:** Make a real commit from a local session (no `--no-verify`, no `SKIP_AI_REVIEW=1`).
   - Confirm terminal shows `[review] ── Reviewer Agent findings (ollama:…) ──` or `(anthropic:…)`.
   - Confirm `docs/review-skips.md` has zero new entries after the commit.
   - Confirm hook runtime is ≤10s (Ollama) or ≤8s (Anthropic) — not hung waiting.

2. **Part B live:** Trigger a soft-skip (run the hook in an env without Ollama or ANTHROPIC_API_KEY —
   e.g., in the builder sandbox). Then:
   ```sql
   SELECT action, meta, occurred_at FROM agent_events
   WHERE action = 'review_bypass' AND occurred_at > NOW() - INTERVAL '1 hour'
   ORDER BY occurred_at DESC LIMIT 3;
   ```
   - Confirm at least one row with `actor='pre-commit-hook'` and real `branch` in `meta`.
   - Confirm the row is NOT `chunk_id='synthetic-test-001'` or `synthetic-test-002`.

3. **No regression:** Run `npm test` and confirm all pre-existing `ai-review-core.test.ts`
   tests still pass plus the new ones added in Part B.

**This grounding checkpoint explicitly rejects synthetic test rows.** The grounding pass
requires a real commit that produced a real agent_events row — not an INSERT via MCP tool.

---

## Kill Signals

- If Part A causes the pre-commit hook to hang (e.g., Ollama times out for >30s) → revert the
  sourcing block, ship Part B only, investigate timeout separately.
- If extracting vars from `.env.local` causes the hook to accidentally expose secrets in commit
  output → revert immediately, scope to ANTHROPIC_API_KEY only (drop Supabase vars from hook).

---

## F17 Justification

`review_bypass` events in `agent_events.meta` carry `{ branch, task_id_detected }`. Over time,
a bypass-rate-per-chunk signal emerges: which task branches skip AI review vs. which get it.
This is a direct quality proxy for the path probability engine — high-bypass branches are more
likely to have uncaught issues, which feeds into the engine's confidence weighting.

## F18 Metric

| Metric | Before (baseline) | Target |
|--------|-------------------|--------|
| Review bypass rate (Layer 2) | 100% (138/138 commits) | 0% on Colin's local machine |
| `agent_events` rows with `action='review_bypass'` (real, not synthetic) | 0 | Accumulated per commit that genuinely lacks a provider |
| `docs/review-skips.md` entries per week | ~N/week (Colin commit cadence) | 0/week from local machine |

Surfacing path (deferred to follow-up chunk): morning_digest line reporting bypass count
from `agent_events` grouped by week, once ≥7 days of real signal exists.

---

## Attribution

F18 measurement requires per-chunk attribution. The `logSoftSkip()` function parses the
current git branch to extract `task_id` if the branch matches `harness/task-{uuid}` — this
covers coordinator/builder commits. For Colin's local commits on non-harness branches,
`task_id_detected` is empty and `branch` serves as the attribution key.

---

## Open Questions for Colin

1. **Seam approval scope:** The `.husky/pre-commit` change is the fix. Are you comfortable
   with builder committing this under `[seam-approved]`, or do you want to apply this change
   manually?

2. **Which Supabase credential to use in logSoftSkip?** The RLS on `agent_events` requires
   service role. The service role key will be exported into the hook shell environment if we
   extract it from `.env.local`. This is local-only (no CI exposure), but it does mean the
   key lives in the hook's bash env during commit. Acceptable, or should we skip agent_events
   write and log to `docs/review-skips.md` only for now?

3. **Twin endpoint:** Unreachable from coordinator sandbox — both questions above went to
   `pending_colin_qs` unresolved. If the twin has answers, please apply them before approving.

---

## Cached-Principle Decisions

None. This chunk escalates to Colin because:
1. `.husky/pre-commit` is a seam file — per Multi-window protocol, every edit requires
   `[seam-approved]` in the commit message, which requires Colin's explicit authorization.
2. Two open questions (above) are personal decisions Colin must make, not pattern-matchable.

---

## Notes on "synthetic verification run" dismissal

The original task was dismissed because a prior coordinator run inserted fake `review_bypass`
rows directly into `agent_events` via MCP SQL tool (chunk IDs `synthetic-test-001` and
`synthetic-test-002`) and claimed the feature was verified. Those rows are still in the table.
The grounding checkpoint above explicitly rejects synthetic rows — pass requires a row produced
by a real commit through the actual pre-commit hook.
