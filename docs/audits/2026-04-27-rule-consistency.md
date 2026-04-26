# Rule Consistency Audit — 2026-04-27

**Scope:** F19 and F20 references across the full repo, post-W3 renumber and post-W4 registry build.  
**Method:** `git grep -n "F19"` and `git grep -n "F20"` across all non-binary files, classified against `lib/rules/registry.ts`.  
**Auditor:** Claude Code W4 session.  
**Result:** 0 hard drift items. 3 minor issues (stale checkboxes, incomplete references array, known namespace ambiguity).

---

## 1. F19 Reference Table

Total matches: 12 (excluding 4 package-lock.json hash false positives).

| # | File | Line | Content (abbreviated) | Classification | Status |
|---|------|------|-----------------------|----------------|--------|
| 1 | `CLAUDE.md` | 72 | Architecture Rule F19 — continuous-improvement | Arch rule ✓ | Correct |
| 2 | `CLAUDE.md` | 166 | F-L8 body: "F19 assigned twice (2026-04-26)" | Historical record | Correct |
| 3 | `CLAUDE.md` | 167 | F-L8 body: "F19 was assigned to continuous improvement and separately..." | Historical record | Correct |
| 4 | `~/.claude/CLAUDE.md` | 73 | F19 — Continuous improvement (process layer) in §2 Preferences | Global arch rule ✓ | Correct |
| 5 | `~/.claude/CLAUDE.md` | 250 | F19: Table name spec drift (failure log §4) | Global failure log — different namespace | Correct |
| 6 | `docs/sprint-5/purpose-review-acceptance.md` | 204 | "Also add to CLAUDE.md as F20 (Architecture Rules §3, after F19)" | Ordering reference — instruction already executed | See drift #3 |
| 7 | `scripts/ingest-claude-md.ts` | 571 | `entity: 'cmdingest:global:F19'` — "Grep exact table name before writing any SQL" | Global failure log namespace | Correct |
| 8 | `scripts/ingest-claude-md.ts` | 800 | `entity: 'cmdingest:lepios:arch-F19-continuous-improvement'` | Arch rule namespace | Correct |
| 9 | `docs/handoffs/2026-04-27-session-end.md` | 54 | "F19→F20 design-system rule renumber across 6 files" | Historical record | Correct |
| 10 | `docs/handoffs/2026-04-27-w3.md` | 10 | "LepiOS arch F19 (continuous-improvement process rule)" | Historical record | Correct |
| 11 | `docs/handoffs/2026-04-27-w3.md` | 11 | "LepiOS arch F20 (design-system, entity slug renamed from arch-F19)" | Historical record | Correct |
| 12 | `docs/handoffs/2026-04-27-w3.md` | 17 | "F19→F20 design-system renumber across 6 files (commit 344ca13)" | Historical record | Correct |

**F19 verdict:** No stale design-system references remain. W3 renumber was complete.

---

## 2. F20 Reference Table

Total matches: 21 (excluding package-lock.json false positives).

| # | File | Line(s) | Content (abbreviated) | Classification | Status |
|---|------|---------|----------------------|----------------|--------|
| 1 | `CLAUDE.md` | 73 | Architecture Rule F20 — design-system enforcement | Arch rule ✓ | Correct |
| 2 | `~/.claude/CLAUDE.md` | 254 | F20: Twin endpoint failure (failure log §4) | Global failure log — different namespace | Correct |
| 3 | `scripts/ingest-claude-md.ts` | 583 | `entity: 'cmdingest:global:F20'` — "Verify endpoint returns 200" | Global failure log namespace | Correct |
| 4 | `scripts/ingest-claude-md.ts` | 813 | `entity: 'cmdingest:lepios:arch-F20-design-system'` | Arch rule namespace | Correct |
| 5 | `tests/design-system.test.ts` | 4,6,11,16,20,29 | F20 design-system enforcement negative-control test | Test ✓ | Correct |
| 6 | `docs/sprint-5/purpose-review-study.md` | 167,169,172,229 | F20 design-system in study doc | Arch rule ref ✓ | Correct |
| 7 | `docs/sprint-5/purpose-review-acceptance.md` | 191,204,205 | F20 design-system in acceptance doc | Arch rule ref ✓ | Correct |
| 8 | `docs/sprint-5/purpose-review-acceptance.md` | 254,255 | `- [ ] F20: design-system acceptance test...` / `- [ ] F20: rule added to CLAUDE.md` | Stale open checkboxes | **Drift #1** |
| 9 | `docs/sprint-5/work-budget-acceptance.md` | 404,406,407,482 | F20 design-system (N/A for this chunk) | Arch rule ref ✓ | Correct |
| 10 | `docs/handoffs/2026-04-27-w3.md` | 11,17 | Historical record | Historical | Correct |
| 11 | `docs/handoffs/2026-04-27-session-end.md` | 54 | Historical record | Historical | Correct |

**F20 verdict:** All F20 references correctly identify design-system enforcement. No stale references to old F19 label.

---

## 3. Registry Cross-Reference

Registry at `lib/rules/registry.ts` (as of W4 build, PR #11):

| Rule | `defined_at` in registry | Verified actual line | Match? |
|------|--------------------------|----------------------|--------|
| F17 | `CLAUDE.md:70` | Line 70: `7. **F17 — Behavioral ingestion justification required:**` | ✓ |
| F18 | `CLAUDE.md:71` | Line 71: `8. **F18 — Measurement + benchmark required:**` | ✓ |
| F19 | `~/.claude/CLAUDE.md:73` | Line 73: `### F19 — Continuous improvement (process layer)` | ✓ |
| F20 | `CLAUDE.md:73` | Line 73: `10. **F20 — Design system enforcement:**` | ✓ |

**F20 `references` array — completeness check:**

| File listed in registry | Present in repo? | Cites F20? |
|-------------------------|-----------------|------------|
| `tests/design-system.test.ts` | ✓ | ✓ |
| `docs/sprint-5/purpose-review-acceptance.md` | ✓ | ✓ |
| `docs/sprint-5/purpose-review-study.md` | ✓ | ✓ — **missing from registry** |
| `docs/sprint-5/work-budget-acceptance.md` | ✓ | ✓ — **missing from registry** |

**F17 and F18 `references` arrays** — not audited exhaustively in this pass (scope was F19/F20). Both have substantial reference lists that appear consistent with the grep results from W4 audit.

---

## 4. CLAUDE.md Sections — F-Number Context

### `lepios/CLAUDE.md §3` (Architecture Rules)

```
line 70:  7. F17 — Behavioral ingestion justification required
line 71:  8. F18 — Measurement + benchmark required
line 72:  9. F19 — Continuous improvement (process layer)
line 73: 10. F20 — Design system enforcement
```

All four sequential. No gaps. No duplicates. ✓

### `~/.claude/CLAUDE.md §2` (Preferences & Conventions)

```
line 73: ### F19 — Continuous improvement (process layer)
```

Only F19 appears here (F17, F18, F20 are project-scoped; F19 is global-scoped). Consistent with registry.

### `~/.claude/CLAUDE.md §4` (Failure / Success Log)

```
line 242: F17: Coordinator writing to main instead of task-scoped branch
line 246: F18: Env vars absent at coordinator runtime
line 250: F19: Table name spec drift
line 254: F20: Twin endpoint never reachable in production
line 258: F21: Sprint context lost mid-run
```

These are sequential failure-log labels — **a separate namespace** from the architecture rules. The same numbers (F17–F20) refer to different things in each namespace. This is not drift; the ingest script correctly disambiguates with entity prefixes (`cmdingest:global:F*` vs `cmdingest:lepios:arch-F*`). Documented below.

---

## 5. Drift Items

### Drift #1 — Stale open checkboxes in `purpose-review-acceptance.md`

| Detail | |
|--------|---|
| **File** | `docs/sprint-5/purpose-review-acceptance.md:254-255` |
| **Lines** | `- [ ] F20: design-system acceptance test in every future port chunk acceptance doc` |
| | `- [ ] F20: rule added to CLAUDE.md as Architecture Rule §3 F20` |
| **Issue** | Both items are done: F20 is in `CLAUDE.md:73`, and the test exists at `tests/design-system.test.ts`. Checkboxes are still `[ ]`. |
| **Severity** | Minor — no functional impact, but an unchecked TODO may cause a future coordinator to re-do completed work. |
| **Fix** | Change `[ ]` to `[x]` on both lines. |

### Drift #2 — `lib/rules/registry.ts` F20 `references` array incomplete

| Detail | |
|--------|---|
| **File** | `lib/rules/registry.ts:89` |
| **Issue** | F20 `references` lists 2 files. Grep found 2 additional files that cite F20 in rule-context: `docs/sprint-5/purpose-review-study.md` and `docs/sprint-5/work-budget-acceptance.md`. |
| **Severity** | Low — `references` is informational. The registry's purpose (collision prevention) is unaffected. |
| **Fix** | Append the two paths to the F20 `references` array. |

### Drift #3 — Stale done-instruction in `purpose-review-acceptance.md:204`

| Detail | |
|--------|---|
| **File** | `docs/sprint-5/purpose-review-acceptance.md:204` |
| **Line** | `**Also add to CLAUDE.md as F20** (Architecture Rules §3, after F19):` |
| **Issue** | This was an instruction to add F20 to CLAUDE.md. The instruction was executed (F20 is in CLAUDE.md:73). The text reads as a pending action but is a completed historical instruction. |
| **Severity** | Informational — acceptance docs are not re-read by agents as live work queues. Low risk of confusion. |
| **Fix** | Optional: annotate the line with `(Done — landed in CLAUDE.md:73)` or leave as historical context. |

---

## 6. Known Pattern — Two-Namespace F-Numbers

**Not drift, but worth documenting for future contributors.**

The numbers F17–F20 appear in two distinct namespaces:

| Namespace | Where | F17 | F18 | F19 | F20 |
|-----------|-------|-----|-----|-----|-----|
| **Architecture rules** | `lepios/CLAUDE.md §3` | behavioral-ingestion | measurement-benchmark | continuous-improvement | design-system |
| **Global failure log** | `~/.claude/CLAUDE.md §4` | branch-guard | harness_config | table-name-drift | twin-endpoint |

The `ingest-claude-md.ts` script handles this correctly with entity prefix disambiguation:
- `cmdingest:global:F19` = table-name-drift (failure log)
- `cmdingest:lepios:arch-F19-continuous-improvement` = architecture rule

A Twin query for "what is F19?" would return both chunks. This is correct behaviour (the Twin should surface both), but it may confuse a session that assumes F-numbers are globally unique. The registry README documents this under "Namespace note."

**The only risk** is if a future coordinator adds a rule by checking the failure log for "next available number" (F22) rather than calling `getNextRuleNumber()` from the registry (which returns 21 based on arch rules). The registry is now the single authority; failure log numbering is separate and should not be consulted for new rule claims.

---

## 7. Summary

| Category | Count |
|----------|-------|
| Total F19 references audited | 12 |
| Total F20 references audited | 21 |
| Correct / expected | 30 |
| Stale open checkboxes (Drift #1) | 2 lines |
| Incomplete references array (Drift #2) | 2 missing paths |
| Stale done-instruction (Drift #3) | 1 line |
| Hard drift (wrong rule number for content) | **0** |

**W3 renumber was complete and correct. No F19=design-system references remain anywhere.**

---

## 8. Recommended Fixes (prioritized)

| Priority | Fix | File | Risk |
|----------|-----|------|------|
| **1 — Low risk, 2-char edit** | Close `[ ]` → `[x]` on lines 254–255 | `docs/sprint-5/purpose-review-acceptance.md` | None |
| **2 — Registry completeness** | Add `docs/sprint-5/purpose-review-study.md` and `docs/sprint-5/work-budget-acceptance.md` to F20 `references` array | `lib/rules/registry.ts:89` | None |
| **3 — Optional annotation** | Add `(Done — landed in CLAUDE.md:73)` to line 204 | `docs/sprint-5/purpose-review-acceptance.md` | None |

All three are documentation-only changes. None affect runtime behaviour, tests, or CI.

---

## 9. Resolved — 2026-04-27 (fix/rule-registry-drift)

All three recommended fixes applied in one commit. Registry tests: **18/18 green** before and after.

| Fix | File | Change | Verified |
| --- | ---- | ------ | -------- |
| Drift #1 — stale checkboxes | `docs/sprint-5/purpose-review-acceptance.md:254-255` | `[ ]` → `[x]` on both F20 lines | ✓ |
| Drift #2 — incomplete references | `lib/rules/registry.ts` F20 entry | Added `purpose-review-study.md` and `work-budget-acceptance.md` | ✓ |
| Drift #3 — stale instruction | `docs/sprint-5/purpose-review-acceptance.md:204` | Appended "Done: landed in CLAUDE.md:73" | ✓ |

### F21 consistency audit (W4 add-on)

W1 registered F21 (acceptance-tests-first) before this session ran. Quick pass:

| Check | File | Result |
|-------|------|--------|
| Arch rule defined | `CLAUDE.md:69` — `6. **F21 — Acceptance tests first:**` | ✓ |
| Registry entry | `lib/rules/registry.ts` — F21 `name: 'acceptance-tests-first'`, `scope: 'project'`, `defined_at: 'CLAUDE.md:69'` | ✓ |
| Registry test | `tests/rules/registry.test.ts:145` — `it('registry contains F21 (acceptance-tests-first)')` | ✓ |
| README table | `lib/rules/README.md:44` — F21 listed | ✓ |
| Global failure log F21 | `~/.claude/CLAUDE.md:258` — F21: Sprint context lost (separate namespace) | ✓ |
| Ingest: failure log | `scripts/ingest-claude-md.ts:596` — `cmdingest:global:F21` maps to sprint-state | ✓ |
| Ingest: arch rule | `scripts/ingest-claude-md.ts` — **no `arch-F21-acceptance-tests-first` entity** | **Gap** |

**F21 gap:** The Twin corpus has `arch-F17/18/19/20` entities but no `arch-F21-acceptance-tests-first`. The acceptance-tests-first rule is not queryable from the Twin. This is a carry-forward action item (not fixed here — out of scope for this PR). Recommend adding an `arch-F21` entry to `ingest-claude-md.ts` in the next session that touches the ingest script.

**Namespace table updated** (both namespaces now include F21):

| Namespace | Where | F17 | F18 | F19 | F20 | F21 |
|-----------|-------|-----|-----|-----|-----|-----|
| **Architecture rules** | `lepios/CLAUDE.md §3` | behavioral-ingestion | measurement-benchmark | continuous-improvement | design-system | acceptance-tests-first |
| **Global failure log** | `~/.claude/CLAUDE.md §4` | branch-guard | harness_config | table-name-drift | twin-endpoint | sprint-state-lost |
