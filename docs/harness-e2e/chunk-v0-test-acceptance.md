# Acceptance Doc — harness-e2e / chunk v0-test

**Sprint:** harness-e2e (throwaway — harness plumbing exercise, not Sprint 4 work)
**Chunk:** v0-test
**Status:** awaiting-colin-approval
**Written:** 2026-04-22T13:55:00-06:00
**Written by:** coordinator sub-agent

---

## Scope

Add `lib/harness/version.ts` exporting `HARNESS_VERSION = '0.1.0'` and `tests/harness/version.test.ts` asserting that exact value; `npm test` passes with the new test included.

**Acceptance criterion (single):** Running `npm test` on a clean checkout produces a passing result that includes `tests/harness/version.test.ts` with one test green.

---

## Out of scope

- No migrations. No Supabase writes. No deploy gate exercise beyond "does the test pass."
- No Sprint 4 Business Review work.
- No harness component wiring (task pickup, deploy gate, Telegram thumbs) — this chunk exists only to prove the coordinator→builder→deploy gate loop runs end-to-end with the smallest possible payload.
- No `lib/harness/index.ts` barrel or other exports beyond `HARNESS_VERSION` — Principle 17: no speculative infrastructure.

---

## Files expected to change

| File | Action | Notes |
|------|--------|-------|
| `lib/harness/version.ts` | **Create** | New directory `lib/harness/` also created |
| `tests/harness/version.test.ts` | **Create** | New directory `tests/harness/` also created |

No other files. vitest.config.ts already includes `tests/**/*.test.ts` — no config change needed.

---

## Check-Before-Build findings

| Item | Exists? | State | Action |
|------|---------|-------|--------|
| `lib/harness/` directory | No | — | Build new |
| `lib/harness/version.ts` | No | — | Build new |
| `tests/harness/` directory | No | — | Build new |
| `tests/harness/version.test.ts` | No | — | Build new |
| `vitest.config.ts` include pattern `tests/**/*.test.ts` | Yes | Working | Leave alone — already covers new test path |

Prior art search: grepped repo for `HARNESS_VERSION` and `harness/version` — zero matches. Confirmed genuinely new.

---

## External deps tested

None. This chunk has no external API dependencies.

---

## Grounding checkpoint

**Grounding form:** DB-state equivalent — `npm test` output (Principle 14 escape hatch: verified DB/process-state query whose output Colin can sanity-check).

**Specific checkpoint:** After builder ships, Colin runs `npm test` in the lepios repo root and confirms:
1. Output includes a line referencing `tests/harness/version.test.ts`.
2. That test shows as passing (1 passed).
3. No pre-existing tests regress (overall suite green or same failures as baseline).

This is sufficient for an infra plumbing test — there is no physical-world artifact because `HARNESS_VERSION` is not a real-world observable. Colin confirming the test output is the closest verifiable grounding moment.

---

## Kill signals

- `npm test` still passes but the new test file is not included in output → vitest glob misconfiguration; do not mark chunk complete.
- Builder creates more than the two files listed → scope creep; coordinator flags and does not mark complete.
- Any migration file created → immediate escalation; this chunk explicitly excludes migrations.

---

## Cached-principle decisions

cache_match_enabled: false (Phase 0 result: `last_reviewed_by_colin_at: null` + sprint-state explicit override). No cache-match attempted. This doc escalates to Colin regardless.

---

## Open questions

None. Scope is unambiguously trivial, task is fully specified, no tradeoffs to surface.
