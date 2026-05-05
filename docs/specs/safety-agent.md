# Spec — Safety Agent

**Date:** 2026-05-05
**Status:** decided to build; queued in `task_queue`
**Closes (decision portion):** gpu-day-readiness C3 ("Safety Agent doctrine resolved")

## Purpose

Catch destructive or unsafe agent operations **before** they execute. Today, the only safety check is Colin's eyes on every PR / migration / destructive op. The Safety Agent automates that pre-flight review for the patterns that pattern-match cleanly.

This is **not** an authorisation layer (RLS already does that). It's a **review** layer between an agent's proposed action and the action actually firing.

## Scope

Three categories of action go through Safety:

1. **Destructive DB ops** — DROP, TRUNCATE, DELETE without WHERE, ALTER on RLS-policy-bearing tables
2. **Secret-adjacent ops** — any code change that adds, removes, or moves a value matching `process.env.X` or `harness_config` keys
3. **External-side-effect ops** — Telegram sends to non-Colin chat IDs, Stripe live-mode charges, Supabase Storage bucket changes, GitHub force-push to main

For each category: **block + notify Colin** by default. Colin approves via Telegram callback. Approval is logged to `agent_events` with `actor_type='colin'`, `kind='safety_approval'`.

## Integration points

- **Coordinator** — calls `runSafetyCheck(action)` before any builder hand-off that includes a category-1/2/3 op.
- **Builder** — calls `runSafetyCheck(diff)` before `git commit`. If blocked, the chunk is paused and a Telegram approval card is sent.
- **Direct SQL via MCP** — out of scope per `docs/decisions/sql-direct-write-backdoor.md`. Colin's hands, no agent in the loop.

## Phases

### Phase 1 — Static analysis (no LLM)

Regex/AST checks on:

- SQL strings (DROP/TRUNCATE/DELETE without WHERE)
- TSX/TS source diffs (process.env.X / harness_config additions or removals)
- Telegram bot.sendMessage calls (chat_id literal vs config-resolved)

Ships as `lib/harness/safety/static.ts`. No model dependency. Fast (<50ms per check).

### Phase 2 — LLM review (local Ollama)

For diffs that pass Phase 1 but match a "review-recommended" heuristic (touches `app/api/`, touches `lib/auth/`, touches a migration file), run a local Ollama review with a hardened prompt asking specifically for safety regressions. Output: `pass | warn | block` plus a one-sentence rationale.

Ships as `lib/harness/safety/llm-review.ts`. Uses `OLLAMA_TWIN_MODEL` (32B post-GPU; 7B pre-GPU). 30s timeout, default-fail-closed (`block` on timeout).

### Phase 3 — Approval flow

Telegram inline keyboard: **Approve** / **Block** / **Defer**. Approve clears the gate; Block kills the task; Defer logs and reschedules for human review next morning_digest.

Ships as `app/api/harness/safety/approve/route.ts`. Reuses existing Telegram approval pattern from deploy gate.

## Acceptance criteria

- [ ] `lib/harness/safety/static.ts` flags 100% of test cases for the 3 destructive-DB patterns + 3 secret patterns + 3 side-effect patterns (9 total). Tests in `tests/harness/safety/static.test.ts`.
- [ ] `lib/harness/safety/llm-review.ts` runs against the same 9 cases + 9 known-safe controls; calibrated to <10% false-block rate.
- [ ] Telegram approval flow round-trips end-to-end: agent proposes → Telegram card arrives → Colin taps Approve → action fires → `agent_events` row written with kind=`safety_approval`.
- [ ] Coordinator + Builder both wire `runSafetyCheck()` at hand-off and pre-commit respectively.

## Out of scope

- RLS / authorization (already enforced at Postgres level)
- Direct SQL via Supabase MCP (per backdoor decision)
- Manual `git commit` from Colin's terminal (Colin is trusted; this layer is for agents)

## Build estimate

3 builder sessions:

1. Phase 1 static checks + tests
2. Phase 2 LLM review + Modelfile prompt + calibration
3. Phase 3 Telegram approval flow + Coordinator/Builder integration

Plus 1 Colin review + 1 calibration session = ~4–6 hours total Colin time.

## Open questions for builder

- Should approval be persistent (Approve once → all similar diffs auto-pass for 24h)? Recommendation: **no**, every action gets its own decision. Cheap; prevents silent escalation.
- Should `Defer` accumulate in a queue or be sent inline to morning_digest? Recommendation: **morning_digest queue**, deferred items show as a compact list with action buttons.
