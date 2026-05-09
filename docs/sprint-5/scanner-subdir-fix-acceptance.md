# Acceptance Doc — Scanner: Subdir Detection Fix + Dead Reference Gotchas

**Task ID:** 3dcf9706-ccc6-43d9-915a-7da9bf8d3c88  
**Parent audit ref:** docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md (not yet created — context in task metadata)  
**Colin approval:** approved_at 2026-05-09 via manual_db (chosen_option=a, approval_status=approved)  
**Coordinator written:** 2026-05-09  

---

## Scope

Two-part fix to `lib/scanners/streamlit-module-scanner.ts`:

**Part A — Subdir detection (option_a):** When `scanStreamlitModules` encounters a subdirectory in `pages/`, check for `__init__.py`. If found and `__init__.py` has < 10 lines (stub), find the largest non-underscore `.py` file in that subdir and use it to populate the `ModuleCandidate`. Without this fix, packages like `pages/tax_centre/` (containing `colin_tax.py` at ~7,995 lines) are silently skipped, and the scanner reports 0 for the module instead of the real complexity.

**Part B — Dead reference detection (scope_expansion):** Detect 34 known dead-reference patterns across Streamlit pages. A "dead reference" is a function call in a page file whose definition or required import is absent. These are BLOCKER-severity issues for any LepiOS port of that page. Embed detected dead references in a new `gotchas: string[]` field on `ModuleCandidate` and pass through to `TaskSpec`.

**Acceptance criterion:** After the fix, running `scanStreamlitModules` against the real Streamlit OS `pages/` returns a candidate for `tax_centre` with `line_count >= 6000`, and pages containing dead references have non-empty `gotchas` arrays.

---

## Out of Scope

- Handling subdirs with `__init__.py` ≥ 10 lines (non-stub packages — skip for now, they're unusual in Streamlit pages/)
- Fixing the dead references themselves (those are port-time problems)
- Re-generating `streamlit-port-catalog.md` (builder does not regenerate; Colin re-runs the catalog script post-fix)
- Any changes to DB, migrations, or API routes

---

## Files Expected to Change

- `lib/scanners/streamlit-module-scanner.ts` — Part A: subdir detection loop; Part B: dead reference patterns + `gotchas` on `ModuleCandidate`
- `lib/scanners/spec-generator.ts` — add `gotchas: string[]` to `TaskSpec` interface; populate from `candidate.gotchas` in `generateTaskSpec`
- `tests/streamlit-scanner.test.ts` — four new tests (see Test Plan below)

---

## Check-Before-Build Findings

- `lib/scanners/streamlit-module-scanner.ts` exists; the directory-skip is at line 93-96 (`if (!entry.endsWith('.py')) continue` then `if (statSync(fullPath).isDirectory()) continue`). The subdir entry point is never reached.
- `lib/scanners/spec-generator.ts` exists; `TaskSpec` has no `gotchas` field. `audit_hints` is the closest existing field — do NOT repurpose it; add a separate `gotchas` field.
- `tests/streamlit-scanner.test.ts` exists with a `makeTempPages` helper; it only writes flat files into `pages/`. Builder must extend the helper (or add a sibling) to support creating nested subdir files for the new tests.
- No migration, no API route, no Supabase changes required.

---

## Part A — Subdir Detection: Exact Behavior Required

The scanner's `for (const entry of entries)` loop currently has two exit points for non-files:
1. `if (!entry.endsWith('.py')) continue` — skips directories (they have no extension)
2. `if (statSync(fullPath).isDirectory()) continue` — redundant guard

Builder must add a subdir-detection branch that fires **before** the `.endswith('.py')` skip for entries that are directories:

```
for each entry in pages/:
  if entry starts with '_' or '.': skip
  
  fullPath = join(pagesDir, entry)
  
  if entry is a directory:
    initPath = join(fullPath, '__init__.py')
    if __init__.py does not exist: skip (not a Streamlit package)
    initContent = readFileSync(initPath)
    if initContent.split('\n').length >= 10: skip (non-stub package — too complex for fallthrough)
    
    // Stub fallthrough: find largest non-underscore .py in the subdir
    subEntries = readdirSync(fullPath)
    candidates = subEntries
      .filter(f => f.endsWith('.py') && !f.startsWith('_') && f !== '__init__.py')
      .map(f => ({ name: f, size: readFileSync(join(fullPath, f)).length }))
      .sort by size descending
    
    if candidates is empty: skip
    
    largestFile = candidates[0]
    content = readFileSync(join(fullPath, largestFile.name), 'utf-8')
    
    // Build ModuleCandidate using the subdir name (entry) and content from largestFile
    // filename = entry (e.g., 'tax_centre')
    // title = extractTitle(entry, content) — existing function works
    // page_number = extractPageNumber(entry) — existing function works
    // ... all other fields use existing detection on content
    push to candidates
    continue  // do not fall through to the flat-file branch
  
  if entry does not end with '.py': skip
  // ... existing flat-file processing
```

Key invariants:
- `filename` on the candidate = the directory name (`tax_centre`), NOT the largest file name
- `title` derived from directory name first, then `st.title()` in the largest file
- All existing field derivations (`complexity`, `external_apis`, `dependencies`, `tab_count`, `import_count`) use the largest file's content
- Sort order unchanged: candidates sorted by `page_number ?? 999` at the end

---

## Part B — Dead Reference Detection: Exact Patterns

Add to `streamlit-module-scanner.ts` (new constant, before `scanStreamlitModules`):

```typescript
const DEAD_REFERENCE_PATTERNS: Array<{
  callPattern: RegExp
  importGuard?: RegExp  // if defined AND matches content → NOT a dead reference
  label: string
}> = [
  {
    callPattern: /\bshow_load_time\s*\(/,
    label: 'show_load_time called but not imported/defined',
  },
  {
    callPattern: /\bdev_section\s*\(/,
    label: 'dev_section called but not imported/defined',
  },
  {
    callPattern: /\bget_sheet\s*\(/,
    importGuard: /gspread|from utils\.sheets|import sheets/,
    label: 'get_sheet called but sheets not imported',
  },
]
```

Add a detection function:
```typescript
function detectDeadReferences(content: string): string[] {
  const gotchas: string[] = []
  for (const { callPattern, importGuard, label } of DEAD_REFERENCE_PATTERNS) {
    if (!callPattern.test(content)) continue
    if (importGuard && importGuard.test(content)) continue  // guarded — not dead
    gotchas.push(label)
  }
  return gotchas
}
```

Add `gotchas: string[]` to `ModuleCandidate` interface.

In the candidate-building code (both flat-file branch AND new subdir branch), populate:
```typescript
gotchas: detectDeadReferences(content),
```

---

## spec-generator.ts Changes

Add `gotchas: string[]` to `TaskSpec` interface (after `audit_hints`):
```typescript
export interface TaskSpec {
  // ... existing fields ...
  audit_hints: string[]
  gotchas: string[]       // dead references and other BLOCKER patterns detected at scan time
}
```

In `generateTaskSpec`, add:
```typescript
gotchas: candidate.gotchas,
```

---

## Test Plan (4 new tests required)

Builder adds these tests in `tests/streamlit-scanner.test.ts`. The existing `makeTempPages` helper must be extended or a new `makeTempPagesWithSubdirs` helper added that accepts nested paths.

**Test 1 — Subdir detection: stub fallthrough**
```
Setup:
  pages/tax_centre/__init__.py  → "# stub\nimport streamlit\n"  (2 lines)
  pages/tax_centre/colin_tax.py → <100 lines of content with st.title("Tax Centre")>

Assertion:
  scanStreamlitModules(root) returns exactly 1 candidate
  candidate.filename === 'tax_centre'
  candidate.line_count >= 100     // reads colin_tax.py, not __init__.py
  candidate.title contains 'Tax Centre'
```

**Test 2 — Subdir skipped when __init__.py >= 10 lines**
```
Setup:
  pages/big_module/__init__.py → <15 lines>
  pages/big_module/main.py     → <200 lines>

Assertion:
  scanStreamlitModules(root) returns 0 candidates (subdir skipped — not a stub)
```

**Test 3 — Dead reference detection: show_load_time**
```
Setup:
  pages/50_Dashboard.py → content includes:
    "show_load_time(start)\n"
    (no def show_load_time, no import that would define it)

Assertion:
  candidate.gotchas contains string matching /show_load_time/
```

**Test 4 — get_sheet NOT flagged when sheets is imported**
```
Setup:
  pages/30_Finance.py → content includes:
    "from utils.sheets import get_sheet\n"
    "data = get_sheet('mysheet')\n"

Assertion:
  candidate.gotchas does NOT contain any string matching /get_sheet/
  (import guard fires → not a dead reference)
```

---

## External Deps Tested

None. Pure TypeScript/Node.js file I/O. No external APIs, no migrations.

---

## Grounding Checkpoint

Colin runs the updated scanner against the real Streamlit OS:

```bash
cd /path/to/lepios
npx tsx -e "
const { scanStreamlitModules } = require('./lib/scanners/streamlit-module-scanner');
const candidates = scanStreamlitModules('../streamlit_app/');
const tax = candidates.find(m => m.filename.includes('tax_centre') || m.filename.includes('Tax_Centre'));
console.log('tax_centre candidate:', JSON.stringify(tax, null, 2));
console.log('total candidates:', candidates.length);
console.log('candidates with gotchas:', candidates.filter(c => c.gotchas.length > 0).map(c => ({ filename: c.filename, gotchas: c.gotchas })));
"
```

Pass criteria:
1. `tax_centre` (or similar) appears in output with `line_count >= 6000`
2. At least one candidate has a non-empty `gotchas` array

**This is the only valid grounding checkpoint. Tests passing alone is not sufficient.**

---

## Kill Signals

- If the `__init__.py` stub-detection approach produces false positives on other subdirs in pages/ that Colin would NOT want scanned as modules → pivot to explicit allowlist (subdir name must have a numeric prefix or be listed in a config constant)
- If dead reference detection produces > 50% false-positive rate across pages/ → reduce pattern list to `show_load_time` only (highest-confidence, most damaging)

---

## Cached-Principle Decisions

None applicable. Colin has provided explicit approval (approval_status=approved, approved_at=2026-05-09) — META-C not required.

---

## Open Questions

None. Colin resolved all open questions via manual_db response:
- q1 (embed source in spec): defer
- q2 (fix approach): option_a confirmed
- Grounding (tax_centre actual_lines): verified at 7,995 lines (>> 1000 threshold)
- scope_expansion: approved (34 dead refs, ~30 line addition)
