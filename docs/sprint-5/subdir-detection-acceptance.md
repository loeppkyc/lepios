# Bug Fix: Scanner Subdir Detection
**task_id:** 3dcf9706-ccc6-43d9-915a-7da9bf8d3c88  
**filed_at:** 2026-04-28  
**phase:** acceptance-doc-ready  
**prepared_at:** 2026-05-08T00:00:00Z

---

## Scope

Fix `scanStreamlitModules` to detect Python package directories (subdirectories containing `.py` files) in `pages/`, registering each as a `ModuleCandidate` with `line_count` = total lines across all `.py` files in that directory.

**Acceptance criterion:** Given a Streamlit root whose `pages/` directory contains both flat `.py` files AND a non-hidden, non-underscore-prefixed subdirectory containing `.py` files, `scanStreamlitModules` returns one `ModuleCandidate` per qualifying subdirectory (with `line_count` equal to the sum of all `.py` files in that dir). No subdirectory package is silently dropped.

**Verification:** Running `npx tsx scripts/scan-streamlit-and-queue.ts` against the real Streamlit baseline produces a queue entry for `tax_centre/` (or `6_Tax_Centre/`) with `line_count` ≥ 1000 (currently reported as 148 because the package directory is skipped entirely).

---

## Out of Scope

**Dead reference detection (scope_expansion from task metadata):** The task metadata includes a `scope_expansion` requesting that the scanner also detect function calls with no matching import and embed them in `spec.gotchas`. This involves:
- A design decision on what constitutes a "dead reference" (false-positive risk is high)
- A new `gotchas?: string[]` field on the `TaskSpec` interface
- Changes to `spec-generator.ts` and `scan-streamlit-and-queue.ts`

This expansion is **not included** in this acceptance doc. Colin must decide whether to include it (see Open Questions).

Note: `docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md` is referenced in the task metadata but does not exist. The scope expansion claim (34 dead references across 32 pages) is ungrounded until that doc is written.

---

## Files Expected to Change

| File | Change |
|------|--------|
| `lib/scanners/streamlit-module-scanner.ts` | Add subdir recursion in `scanStreamlitModules` |
| `tests/streamlit-scanner.test.ts` | Add test: subdir package registered with correct `line_count` |

No schema changes. No migrations. No new dependencies.

---

## Check-Before-Build Findings

**Existing pattern:** `walkDir` in `scripts/embed-streamlit-source.ts` (lines 211–226) already recurses into subdirectories, skipping `EXCLUDE_DIRS` and collecting `.py` files. The fix adapts this exact pattern.

**Current behavior (line 97, `streamlit-module-scanner.ts`):**
```typescript
if (statSync(fullPath).isDirectory()) continue  // BUG: silently drops packages
```

**Target behavior:** when a directory is found in `pages/`, collect all `.py` files within it recursively, sum their line counts, and register ONE `ModuleCandidate` representing the package.

**Builder should adapt this exact walkDir shape** (already exported from `scripts/embed-streamlit-source.ts` — do NOT import from the scripts dir into lib/scanners; inline a local helper or copy the relevant 10-line function body):

```typescript
function walkPyFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkPyFiles(fullPath, results)  // recurse — no exclusions needed here
    } else if (entry.endsWith('.py')) {
      results.push(fullPath)
    }
  }
  return results
}
```

**ModuleCandidate shape for a package directory** (e.g., `pages/tax_centre/`):
- `filename`: use directory name as-is (e.g., `"tax_centre"`) — no `.py` suffix
- `page_number`: null (directory has no page number prefix)  
  _Exception: if dirname starts with `\d+_`, extract page number the same way as files_
- `title`: `extractTitle` from combined content of all `.py` files in the dir (first match wins), with fallback to dir name → human title
- `line_count`: sum of `content.split('\n').length` across all `.py` files
- `import_count`, `tab_count`, `external_apis`, `dependencies`, `category`, `confidence`, `complexity`: derived from concatenated content of all `.py` files (same functions, same rules)

**No change needed to `generateTaskSpec` or `scan-streamlit-and-queue.ts`** — `ModuleCandidate` shape is unchanged.

---

## External Deps Tested

None. This is a pure filesystem operation with no external API calls.

---

## Grounding Checkpoint

1. `npx tsx scripts/scan-streamlit-and-queue.ts` against the real Streamlit baseline (at `../streamlit_app/`) produces a queue entry with `line_count` ≥ 1000 for the `tax_centre` package (or any other subdir package present in `pages/`).
2. The existing flat-file entry `6_Tax_Centre.py` (148 lines) still appears as a separate `ModuleCandidate` — the fix adds subdirs, not replaces existing flat files.
3. `npm test` — all tests pass including the new subdir test.

---

## Kill Signals

- If the Streamlit `pages/` directory has no subdirectory packages (all modules are flat `.py` files), this fix has no observable effect and is a no-op — still correct to ship but grounding checkpoint would need a synthetic fixture or local verification.
- If combining all `.py` files in a package directory produces incorrect API/dep detection (e.g., a test file inside the package skews detection), that's a quality issue but not a kill signal — the line_count fix is the critical repair.

---

## Open Questions (Colin decides)

**Q1 — Scope expansion: dead reference detection (Part B)**

The task metadata proposes also adding dead-reference detection to the scanner:
> "scanner should detect dead references (show_load_time, dev_section, get_sheet with no matching import) and embed them in spec.gotchas"

Claimed impact: 34 dead references across 32 pages, all BLOCKER severity for LepiOS ports. ~30 line addition.

**What this would require:**
- A heuristic to detect function calls where the called name is not imported in the file (e.g., regex: call matches `\b{name}\(` but no `import {name}` or `from X import ... {name}`)
- A new `gotchas?: string[]` field on `TaskSpec` in `spec-generator.ts`
- Test coverage for the detection heuristic
- The referenced audit doc (`docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md`) does not exist — the 34-reference claim is ungrounded

**Coordinator recommendation:** Defer Part B. The dead-reference audit doc should be written first (grounded claim), and the detection heuristic needs design review to avoid false positives. The subdir fix (Part A) is independently useful and unblocked.

**Q2 — Package ModuleCandidate filename convention**

Options for `filename` field of a subdir package:
- (a) `"tax_centre"` — bare directory name (no `.py` suffix, no trailing slash)
- (b) `"tax_centre/"` — trailing slash makes it visually clear it's a directory
- (c) `"tax_centre/__init__.py"` — only if `__init__.py` exists (falls back to (a) if absent)

Coordinator default: option (a). Makes downstream consumers (`generateTaskSpec`, `describeModule`) work with no changes. Colin can override.

---

## Cached-Principle Decisions

None — escalating to Colin for approval per standard flow. See META-C block below.

---

## META-C Block

```
2026-05-08T00:00:00Z sprint=5 chunk=subdir-detection doc=docs/sprint-5/subdir-detection-acceptance.md
cited_principles: [Beef-Up (§8.4 Check-Before-Build), Reversibility, F20-no-inline-style (not applicable — no UI), F21 acceptance-first]
trigger_match_evidence: |
  §8.4 Check-Before-Build: "verify it doesn't exist in the Streamlit OS baseline or this repo.
  Default action: Beef-Up." — walkDir in embed-streamlit-source.ts is the existing pattern to adapt.
  Situation: scanner needs subdir recursion; walkDir already solves exactly this. Adaptation, not invention.
  Reversibility: "ALTER TYPE ADD VALUE is reversible-free... Hardcoded strings: reversible-with-grep."
  Situation: no schema changes; file-only changes; revert is `git revert`. Fully reversible.
reversibility_check: |
  lib/scanners/streamlit-module-scanner.ts: add subdir branch — reversible (git revert, no dep cascade).
  tests/streamlit-scanner.test.ts: add test — reversible (delete test, tests still pass).
  docs/sprint-5/subdir-detection-acceptance.md: this file — reversible (delete).
  No schema migrations. No external API calls. No env var changes.
  All decisions: LOW cost to reverse.
confidence: high
```

META-C result: **conditions met for high-confidence match on Part A**. However, coordinator does not self-approve. Sending to Colin for ratification because:
1. This is the standard flow (every acceptance doc goes to Colin)
2. Q1 (scope expansion) and Q2 (filename convention) require Colin's answer before builder can proceed cleanly
