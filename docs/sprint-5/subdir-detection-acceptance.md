# Acceptance Doc — Subdir Detection Fix for `scanStreamlitModules`

**Task ID:** 3dcf9706-ccc6-43d9-915a-7da9bf8d3c88  
**Filed:** 2026-04-28  
**Approved:** 2026-05-09 (Colin, via manual_db)  
**Chunk:** subdir-detection  
**Sprint:** 5 (parallel harness track)

---

## Scope

Fix `lib/scanners/streamlit-module-scanner.ts` so that `scanStreamlitModules()` detects Python package directories inside `pages/` and registers them as `ModuleCandidate` entries alongside flat `.py` files.

**One acceptance criterion:** After the fix, a call to `scanStreamlitModules(root)` where `pages/tax_centre/` is a directory containing `.py` files returns a `ModuleCandidate` with `filename = 'tax_centre'` — the same result shape as for flat `.py` files, with `line_count`, `external_apis`, `dependencies`, and all other fields populated from the package's entry point content.

---

## Out of Scope

- Dead reference detection (deferred — Q1 answered `defer` by Colin 2026-05-09). Do NOT add detection of dead references (`show_load_time`, `dev_section`, `get_sheet` with no matching import) in this chunk. That is a separate future chunk.
- Changes to `spec-generator.ts`, `streamlit-categories.ts`, or any other file unless strictly necessary for the scanner fix.
- Changes to embed-streamlit-source.ts (already handles subdirs via `walkDir`).

---

## Background / Bug

`scanStreamlitModules` at line 96 of `lib/scanners/streamlit-module-scanner.ts`:

```typescript
if (statSync(fullPath).isDirectory()) continue  // ← BUG: skips all subdirs
```

This means Python package directories like `pages/tax_centre/` (which contains `colin_tax.py`) are silently skipped. The scanner reports 148 lines for the Tax Centre module when the actual implementation is 7,995 lines — a 54× undercount that causes incorrect complexity classification and missing API detection.

The `embed-streamlit-source.ts` script already recurses subdirs correctly via its `walkDir` function (lines 211–226). Adapt the same pattern for `scanStreamlitModules`.

---

## Filename Convention for Package Directories (Q2 = option_a)

When a subdirectory in `pages/` is detected as a package, store in `ModuleCandidate.filename` the **raw directory name with no trailing slash and no file extension**.

Examples:
- `pages/tax_centre/` → `filename: 'tax_centre'`
- `pages/6_Tax_Centre/` → `filename: '6_Tax_Centre'`

This preserves compatibility with `extractPageNumber` (which strips leading digits) and `extractTitle` (which strips `^\d+_` prefix and replaces `_` with spaces). The `.py` extension is omitted to signal to downstream consumers that this is a package, not a flat file.

---

## Implementation Guidance

### Entry point selection for packages

For a directory `pages/<dir>/`, read the first matching file in priority order:
1. `pages/<dir>/__init__.py`
2. `pages/<dir>/<dir>.py` (e.g., `tax_centre/tax_centre.py`)
3. Any `.py` file in the directory (first alphabetically, skip files starting with `_`)

If no `.py` file is found in the directory, skip it (not a Python package — just a data dir).

### What to compute from entry point content

Compute all `ModuleCandidate` fields from the entry point file's content exactly as for flat files:
- `line_count` — line count of the entry point file only (not entire package)
- `title` — from `st.title()` in the entry point, or derived from directory name
- `page_number` — from numeric prefix in directory name (e.g., `6_Tax_Centre` → 6)
- `category`, `confidence` — from `categorize(dirName, content)`
- `complexity` — from `complexity(lineCount, importCount, tabCount)`
- `external_apis` — from `detectExternalApis(content)`
- `dependencies` — from `detectDependencies(content)`
- `tab_count`, `import_count` — as usual

### Sort order

Packages sort alongside flat files using `page_number`. Packages with no numeric prefix in directory name sort to the end (page_number = null → 999).

---

## Files Expected to Change

- `lib/scanners/streamlit-module-scanner.ts` — primary fix (lines 76–124)
- `tests/streamlit-scanner.test.ts` — add test cases for subdir detection

---

## Check-Before-Build Findings

- `walkDir` in `scripts/embed-streamlit-source.ts:211` — exact pattern to adapt. It uses `readdirSync` + `statSync().isDirectory()` + recursion. The scanner should do one-level-only subdir detection (not recursive), since Streamlit packages in `pages/` are never nested more than one level.
- No existing subdir detection in `lib/scanners/streamlit-module-scanner.ts` — clean addition.
- Tests in `tests/streamlit-scanner.test.ts` use `makeTempPages` helper that writes to `tmpdir()`. Extend it (or write a parallel `makeTempPagesWithSubdir` helper) to support creating subdirectories for the new test cases.

---

## Test Plan

New tests to add to `tests/streamlit-scanner.test.ts`:

1. **Package dir with `__init__.py`** — `pages/tax_centre/__init__.py` present → `ModuleCandidate` returned with `filename='tax_centre'`, `line_count` matching content length, `page_number=null`
2. **Package dir with numbered prefix** — `pages/6_Tax_Centre/__init__.py` → `filename='6_Tax_Centre'`, `page_number=6`
3. **Package dir with no `__init__.py`, has matching `.py`** — `pages/foo_module/foo_module.py` → found
4. **Package dir with no `.py` files at all** — skipped, not included in candidates
5. **Mixed flat + subdir** — `pages/` has both flat `.py` files AND subdirs → all returned, sorted by page_number
6. **Subdir starting with `_`** — skipped (e.g., `pages/_internal/`)

---

## Grounding Checkpoint

Run the scanner against the actual Streamlit OS `pages/` directory:

```bash
node -e "
const { scanStreamlitModules } = require('./lib/scanners/streamlit-module-scanner');
const candidates = scanStreamlitModules('../streamlit_app');
const taxCentre = candidates.find(c => c.filename.toLowerCase().includes('tax'));
console.log('Tax Centre found:', taxCentre ? 'yes' : 'no');
if (taxCentre) console.log(JSON.stringify(taxCentre, null, 2));
console.log('Total candidates:', candidates.length);
"
```

**Expected:** `tax_centre` (or `6_Tax_Centre`) appears in results with `line_count > 1000` (actual is ~7,995). If the scanner still reports 148 lines or null, the fix didn't work.

Colin verifies this output. "Tests pass" is not sufficient grounding — the actual Streamlit source must be reachable.

---

## Kill Signals

- If `pages/tax_centre/` turns out to be the only package-style directory and has fewer than 500 lines, the complexity signal impact is minor — defer the fix and close as low-priority. (Unlikely given the 7,995 line count reported in metadata.)
- If detecting subdirs causes the scanner to emit false positives (non-module directories like `pages/assets/` or `pages/data/`) and filtering them is complex, escalate before over-engineering.

---

## Cached-Principle Decisions

None — this is a bug fix with no architectural decisions. Colin explicitly approved via `approval_status: approved` in task_queue metadata on 2026-05-09.

---

## Open Questions

None. Colin answered both open questions on 2026-05-09:
- Q1 (`defer`) — dead-reference detection deferred
- Q2 (`option_a`) — filename = raw directory name, no trailing slash, no extension
