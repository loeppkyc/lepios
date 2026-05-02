# Security Layer — Slice 3 Acceptance Doc

**Status:** Draft — awaiting Colin approval before builder picks up.
**Spec:** `docs/harness/SECURITY_LAYER_SPEC.md` §Priority order, slice 3.
**Branch:** `feat/security-layer-ts` (current branch — slice 1+2 already merged as PRs #61, #62).
**Parent slices:**

- Slice 1 (PR #61): `lib/security/capability.ts` + `lib/security/audit.ts` + `lib/security/types.ts` + `agent_actions` table + `capability_registry` + `agent_capabilities`. All seeded in log_only.
- Slice 2 (PR #62): `lib/harness/arms-legs/http.ts` + `telegram.ts` wired to `requireCapability`.

---

## Why this slice

The spec defines slice 3 as: "wire `requireCapability` into the remaining ~5 call sites beyond arms-legs. All log_only — nothing breaks."

After slices 1+2, `requireCapability` is called at exactly **one** internal call site (`lib/harness/arms-legs/http.ts`). The security layer spec requires it to be called at every agent boundary before side-effecting operations. Two remaining high-value call sites in the current codebase are unwired:

1. **`lib/harness/branch-guard.ts`** — `assertCorrectBranch()` runs before every coordinator file write. No capability check today.
2. **`lib/safety/checker.ts`** — `validateProposedChanges()` is the pre-execution guardrail for all proposed changes. No capability check today.

A third candidate (`lib/supabase/service.ts` `createServiceClient`) is **deferred to slice 4**: it requires AsyncLocalStorage for implicit agent context resolution (documented in spec §M3, AD4 redline, R5). That work is scoped to the secrets-indirection slice.

**Note on test coverage:** The task brief for this slice mentioned that enforce-mode and warn-mode test paths were not covered. They were in fact fully delivered in S1 — `tests/security/capability.test.ts` (lines 194–244, 328–345) covers the deny path, error message shape, audit write before throw, and warn mode with no grant. No test coverage gap exists in the unit tests. The DoD note referenced in the brief does not appear in the current test file. This doc scope is limited to the call-site wiring work only.

---

## Scope

### Files changed

| File                                      | Change                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `lib/harness/branch-guard.ts`             | Add `requireCapability` call in `assertCorrectBranch` before the branch comparison logic |
| `lib/safety/checker.ts`                   | Add `requireCapability` call in `validateProposedChanges` before running checks          |
| `tests/harness/branch-guard.test.ts`      | New file — unit tests for the capability-gated `assertCorrectBranch`                     |
| `tests/safety/checker-capability.test.ts` | New file — unit tests for capability gate in `validateProposedChanges`                   |

### No migration

All capability rows for `branch-guard` and `safety-checker` call sites already exist in the `capability_registry` seed from migration 0045 under the `coordinator` and `builder` grants. No new migration is required.

### Capability strings used

| Call site                 | agentId param                    | capability string    | In registry?                                          |
| ------------------------- | -------------------------------- | -------------------- | ----------------------------------------------------- |
| `assertCorrectBranch`     | caller-supplied (see note below) | `git.branch.check`   | Verify against registry seed in 0045 — see flag below |
| `validateProposedChanges` | caller-supplied                  | `shell.safety_check` | Verify against registry seed in 0045 — see flag below |

**Flag for builder:** Before wiring, grep `supabase/migrations/0045_security_layer_schema.sql` for the exact capability strings used at these two call sites. If the strings differ from the table above, use the strings from the migration (source of truth is always the DB seed). Do not invent capability strings not in the registry.

---

## Approach decision: caller-supplied agentId vs. implicit context

Both call sites today have no `agentId` parameter. Two options:

**Option A — Add `agentId` parameter to the function signature.**
`assertCorrectBranch(taskId, { agentId })` and `validateProposedChanges(input, { agentId })`.
Callers (coordinator session startup, safety-check hooks) must pass their agent ID explicitly.

**Option B — Default to `'system'` when no agentId is provided.**
Matches the fallback documented in spec §M3 (`currentAgentId()` returns `'system'` when AsyncLocalStorage has no context). Does not require signature changes. The log row records `'system'` and is auditable but not agent-scoped.

**Pick Option A** for both call sites. Reasoning:

- Both call sites are coordinator/builder entry points, not library utilities — the caller knows the agentId.
- Option B produces `'system'` rows that look like unregistered-agent rows and inflate false positives in the morning_digest deny count.
- Signature addition is a one-time cost; all current callers of `assertCorrectBranch` and `validateProposedChanges` can be updated in this slice.
- Option B is still the right fallback for deeper utility calls (library functions that may be called from any context) — that's what slice 4's AsyncLocalStorage work handles.

---

## Acceptance criteria

All criteria must be met before this slice is marked complete.

### 1. branch-guard wiring

1. `assertCorrectBranch(taskId, { agentId })` — new signature. `agentId` defaults to `'branch-guard'` if caller omits it (safe default — `branch-guard` has `git.branch.check` in coordinator's grant set).
2. `requireCapability({ agentId, capability: 'git.branch.check' })` is called before the branch comparison. In log_only mode it must not throw.
3. The `CapabilityResult.audit_id` is added to the `meta` field of the `branch_guard_triggered` event row (existing audit event), so the cap-check row and the guard-trigger row are correlated.
4. Unit test — capability denied (enforce, no grant): `assertCorrectBranch` propagates `CapabilityDeniedError` upward without masking it.
5. Unit test — capability allowed + wrong branch: the existing branch-mismatch throw still fires.
6. Unit test — capability allowed + correct branch: resolves void, no throw.

### 2. safety-checker wiring

7. `validateProposedChanges(input, knownTests, { agentId })` — new optional third param. `agentId` defaults to `'system'` if caller omits it (library-style usage still works).
8. `requireCapability({ agentId, capability: 'shell.safety_check' })` is called at the top of `validateProposedChanges`, before any rule runs.
9. In log_only mode the capability check must not throw, and safety checks must run normally.
10. If the capability check throws `CapabilityDeniedError` (enforce mode, no grant), `validateProposedChanges` must re-throw it — the propose-change flow halts. It must NOT return a SafetyReport with blocking=false.
11. Unit test — capability denied: `validateProposedChanges` re-throws `CapabilityDeniedError`, no safety rules execute.
12. Unit test — capability allowed: full safety check runs and returns a SafetyReport.

### 3. Tests must pass

13. `npx vitest run tests/harness/branch-guard.test.ts` — all tests pass.
14. `npx vitest run tests/safety/checker-capability.test.ts` — all tests pass.
15. `npx vitest run tests/security/capability.test.ts` — still passes (no regressions to S1 tests).
16. `npx vitest run tests/arms-legs/http.test.ts` — still passes (no regressions to S2 tests).

### 4. No style=\{\} violations (F20 rule)

17. No new TSX files introduced. This slice is TypeScript only. F20 does not apply, but confirm no `style={}` attributes appear in any changed file.

### 5. No enforcement flip

18. The `capability_registry` seed rows touched by this slice retain `default_enforcement = 'log_only'`. Builder must not flip any row to `enforce`. Flipping to enforce is slice 7 scope.

### 6. Capability strings verified before use

19. Builder must grep `supabase/migrations/0045_security_layer_schema.sql` for the exact capability string before wiring each call site. If the string is not in the migration seed, stop and flag to coordinator rather than inventing a new string.

---

## Out of scope

- **Flipping any capability to enforce mode.** That is slice 7. All log_only today.
- **`createServiceClient` wiring.** Requires AsyncLocalStorage for implicit agent context. Deferred to slice 4 (secrets indirection).
- **Agent frontmatter `caps:` field.** Slice 5.
- **F18 digest line.** Slice 6.
- **Sandbox boundary contract.** Slice 6.
- **Migration 0046 or any new migration.** No schema change needed. All capability strings should already exist in the 0045 seed. If they do not, that is a flag to coordinator, not a builder-initiated migration.
- **Test coverage for enforce-mode deny path in `capability.ts`.** Already delivered in S1 (`tests/security/capability.test.ts` lines 194–244). Nothing to add.

---

## Migration plan

None required. Verify pre-wire:

```sql
-- Confirm the capability strings exist in the registry before builder wires them.
SELECT capability, default_enforcement
FROM capability_registry
WHERE capability IN ('git.branch.check', 'shell.safety_check');
-- Both rows should return default_enforcement = 'log_only'.
-- If either is missing, stop and flag to coordinator.
```

If either row is missing from the registry, do not create a standalone migration. Instead, flag to coordinator, who will scope a registry-extension migration (following AD7: new registry rows require a migration through CI gate + Colin approval).

---

## F18 — measurement hook (minimal, slice 6 will expand)

This slice does not ship a new digest line (that is slice 6 scope). It does ensure that the two new call sites write `agent_actions` rows with correct `agent_id`, `capability`, and `result` fields. The existing morning_digest security summary line will automatically pick up these rows once slice 6 adds the digest query.

No additional instrumentation work required in slice 3.

---

## Rollback

No schema change, no migration. Rollback = revert the two file changes (`branch-guard.ts`, `checker.ts`) and the two test files. The capability registry and agent_capabilities rows are unaffected.
