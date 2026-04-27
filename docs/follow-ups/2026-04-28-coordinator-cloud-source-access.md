# Coordinator Cloud Source Access — Design Doc

**Date:** 2026-04-28  
**Author:** Claude (design-only, no implementation)  
**Status:** Awaiting Colin decision  
**Triggered by:** 4 overnight coordinator failures (tasks 8b3d7030, a88b0018, ec1d00c7, 8ab362ac)

---

## 1 — Confirmed Failure Mode

### What the coordinator spec requires

`coordinator.md` Phase 1a instructs:

> "Read the Streamlit implementation of the feature end to end: UI layer, data layer, logic, config, and any helper utilities it calls."

The task_spec passed to the coordinator contains only metadata — no source content:

```
module_filename: "52_Utility_Tracker.py"
title: "rebuild streamlit module: Utility Tracker"
description: "141 lines, small complexity. Imports from: ..."
priority: "medium"
estimated_weight: "small"
prereqs: [...]
audit_hints: [...]
```

The coordinator's tools are `Read, Glob, Grep, Write, Edit, Bash`. Phase 1a requires it to
`Read` the actual `.py` file. The path it would construct:

```
../streamlit_app/pages/52_Utility_Tracker.py
```

resolves to `C:\Users\Colin\Downloads\Claude_Code_Workspace_TEMPLATE (1)\streamlit_app\pages\52_Utility_Tracker.py`
on Colin's local machine.

### Why the cloud routine can't reach it

Coordinators fired via the Anthropic Routines API run in Anthropic's cloud infrastructure.
They have no network path to Colin's local filesystem. The `Read` tool call would return
`file not found` or hang. Phase 1a blocks immediately. The coordinator cannot proceed to
Phase 1b (Twin Q&A) or Phase 1d (acceptance doc).

### Evidence from the overnight run log

`docs/overnight-runs/2026-04-27-overnight-streamlit-rebuild.md` confirms all 4 tasks
were fired as cloud routines via `/api/cron/task-pickup` → `COORDINATOR_ROUTINE_TOKEN`
(Vercel production env). None of the 4 tasks are the tax_centre task (af44ba61),
which has a separate grounding checkpoint issue.

All 4 failed tasks are small-complexity modules (114–141 lines):

- `52_Utility_Tracker.py` — 140 lines
- `9_Profile.py` — 113 lines
- `99_n8n_Webhook.py` — 114 lines (listed as 114 in scanner, confirmed)
- `97_Dropbox_Archiver.py` — 141 lines

There is no study doc written for any of these in `docs/sprint-*/`. Phase 1a never completed.

---

## 2 — Existing Infrastructure Audit

### task_spec fields (what the coordinator already has)

From `lib/scanners/spec-generator.ts` (`TaskSpec` interface):

| Field              | Content                          | Source access?     |
| ------------------ | -------------------------------- | ------------------ |
| `module_filename`  | `"52_Utility_Tracker.py"`        | No — filename only |
| `title`            | Human-readable title             | No                 |
| `description`      | Line count, complexity, APIs     | No                 |
| `priority`         | `critical / high / medium / low` | No                 |
| `estimated_weight` | `small / medium / large`         | No                 |
| `prereqs`          | Known dependency list            | No                 |
| `audit_hints`      | LepiOS file hints                | No                 |
| `candidate.*`      | All `ModuleCandidate` fields     | No                 |

No field carries source content. The `candidate` object has `line_count`, `external_apis`,
`dependencies`, `tab_count`, `import_count` — all derived metadata, not source.

### Knowledge corpus chunks (what's in the Twin)

`scripts/embed-streamlit-source.ts` chunked the Streamlit codebase into the `knowledge`
table (`domain='streamlit_source'`) during the April corpus run. Key facts:

**What is chunked:**

- Python files from `streamlit_app/` (excluding `tests/`, dead files, test\_ prefix)
- Split by `def`, `class`, and method boundaries
- Each chunk: function/method header + body, max 200 lines, truncated at 4,500 chars before embedding
- `title`: `"pages/52_Utility_Tracker.py — functionName"`
- `entity`: `"pages/52_Utility_Tracker.py"`
- `context`: raw chunk text (the actual code, stored in full — not just the embedding)

**What is NOT chunked:**

- Module-level code: imports, constants, `st.set_page_config()`, top-of-file setup
- Any function body under 5 lines
- Code between functions
- For Streamlit pages that write their entire UI at module scope (no `def`s), coverage is near zero

**Can the Twin serve "give me the full source of 52_Utility_Tracker.py"?**

No, not reliably. The `match_knowledge` RPC does vector similarity search. Asking
"give me source of 52_Utility_Tracker.py" embeds into a query vector that won't reliably
match chunk embeddings whose text is code bodies anchored to function names.

**However:** A direct Supabase query (bypassing the Twin's RAG layer) CAN retrieve all
corpus chunks for a file by entity path:

```sql
SELECT title, context
FROM knowledge
WHERE domain = 'streamlit_source'
  AND entity = 'pages/52_Utility_Tracker.py'
ORDER BY title;
```

This is not the same as having the full source. It returns only the chunked functions —
missing module-level code — and ordering by title (function name) is not the same as
ordering by line number.

**Reconstruction quality by module size:**

| Module                 | Lines | Expected chunks | Module-level code risk                      | Reconstruction quality |
| ---------------------- | ----- | --------------- | ------------------------------------------- | ---------------------- |
| 9_Profile.py           | 113   | 1–3             | High (typical Streamlit page, minimal defs) | Poor                   |
| 52_Utility_Tracker.py  | 140   | 2–4             | Medium                                      | Fair                   |
| 99_n8n_Webhook.py      | 114   | 1–3             | High                                        | Poor                   |
| 97_Dropbox_Archiver.py | 141   | 2–4             | Medium                                      | Fair                   |

For the overnight modules (all small, 113–141 lines), Streamlit page files of this size
often contain most of their logic at module scope (no `def`s). Corpus reconstruction
may return fewer than 2 chunks and miss the majority of the source.

---

## 3 — Fix Options

### Option A — Embed source_content in task metadata at queue time

**How it works:**

When `scripts/scan-streamlit-and-queue.ts` (or a new insertion script) creates a
task_queue row, it reads the file content and includes it as a field in the task JSON.
The coordinator reads `spec.source_content` at session start, never touches the filesystem.

Best implementation: a separate migration adds a `streamlit_source_snapshot` table:

```sql
CREATE TABLE streamlit_source_snapshot (
  task_id UUID PRIMARY KEY REFERENCES task_queue(id),
  filename TEXT NOT NULL,
  source_text TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Coordinator reads at Phase 1a start:

```bash
curl -s "${SUPABASE_URL}/rest/v1/streamlit_source_snapshot?task_id=eq.{task_id}&select=source_text" \
  -H "apikey: ${SERVICE_ROLE_KEY}"
```

**Effort:** Low. One migration, one addition to the task-insertion script (or a one-off
backfill script for the 4 stuck tasks). Coordinator spec gains one line in Phase 1a:
"If `streamlit_source_snapshot` row exists for this task_id, use it as the source content."

**Durability:** High. Content is frozen at task-generation time. Always available regardless
of filesystem, network, or local Ollama state.

**Ongoing maintenance:** Low. The scan-and-queue script runs locally (where the filesystem
IS accessible) and populates the snapshot table. Coordinator reads from Supabase.
Content is stale if the Streamlit file changes after queuing — acceptable for module ports,
since you're porting a specific version of the Streamlit source, not a moving target.

**Risk:** For very large files (colin_tax.py at 6,922 lines ≈ 200KB), the `source_text`
field is large but within Postgres TEXT limits. The 4 overnight modules are 113–141 lines
(~4–6KB each) — no concern.

---

### Option B — Push Streamlit codebase to private GitHub repo; coordinator clones

**How it works:**

Create `loeppkyc/loeppky-streamlit-source` (private), push `streamlit_app/pages/` to it
(without `secrets.toml` or `.streamlit/`). Coordinator does a sparse checkout in Phase 1a:

```bash
git clone --filter=blob:none --sparse https://x-access-token:${GH_TOKEN}@github.com/loeppkyc/loeppky-streamlit-source.git /tmp/streamlit-source
cd /tmp/streamlit-source
git sparse-checkout set pages/52_Utility_Tracker.py
```

**Effort:** Medium. New GitHub repo to create and maintain. GH_TOKEN as a new secret in
`harness_config`. Sparse checkout invocation in coordinator spec. Push automation needed
(manual push, or a local git hook, or n8n trigger on Streamlit change).

**Durability:** High if the repo is kept in sync. But "if" is load-bearing. The Streamlit
repo is actively edited; any sync lag means coordinators read stale source.

**Ongoing maintenance:** Medium-high. Every Streamlit change requires a push to the source
mirror repo. No automation currently exists for this. If the push is forgotten, coordinators
silently port stale code. Git authentication in cloud routines adds another secret to rotate.

**Large diff cost:** Sparse checkout is efficient for individual files, but network latency
per coordinator session is ~5–15s per clone. For 84 modules × N retries, this accumulates.

**Security:** `secrets.toml` must be excluded explicitly. One mistake = leaked Streamlit secrets
in a repo that may eventually become less private.

**Verdict:** More durable than Option C for full source, but higher maintenance and security
surface area than Option A.

---

### Option C — Twin retrieval mode: coordinator queries corpus chunks by entity path

**How it works:**

Coordinator queries Supabase `knowledge` table directly at Phase 1a for all chunks
matching the module's entity path (bypassing the Twin's vector search):

```bash
curl -s "${SUPABASE_URL}/rest/v1/knowledge?domain=eq.streamlit_source&entity=like.*52_Utility_Tracker*&select=title,context&order=title.asc" \
  -H "apikey: ${SERVICE_ROLE_KEY}"
```

Coordinator assembles chunks into a partial source view and proceeds with Phase 1a using
that reconstruction.

**Effort:** Zero. No new infra. Infrastructure is already in production. Coordinator spec
gains a Phase 1a section: "Query knowledge table for entity chunks; warn if <3 chunks returned."

**Durability:** Medium-low. The corpus was embedded once. It is refreshed only when
`embed-streamlit-source.ts` is re-run manually (requires local Ollama). If the Streamlit
source changes after the last embed run, coordinators read stale chunks. Larger problem:
the chunker never captures module-level code, so any Streamlit page whose logic is at
module scope (no function defs) returns 0 usable chunks.

**Reconstruction quality assessment for the 4 overnight modules:**

The 4 stuck modules are small (113–141 lines). Streamlit pages of this size commonly have
their entire UI logic at module scope. Testing with the chunker logic:

- `chunkPythonFile` only captures `def` and `class` blocks, minimum 5 lines
- A 113-line profile page that's 80% `st.text_input`, `st.button`, `col =` assignments
  at module scope would produce 0 usable chunks
- Reconstruction for these specific 4 modules is likely poor to zero

**Ongoing maintenance:** Low but opaque. When the corpus goes stale is invisible to the
coordinator. A coordinator that gets 0 chunks doesn't know if the file has no functions
(possible) or the corpus is stale (also possible). Both look identical.

**Verdict:** Fastest to wire up (no code changes needed today), but lowest quality and
least reliable for exactly the modules most likely to be queued first (small, simple pages
tend to be script-style with no function defs).

---

## 4 — Recommendation

### For re-firing the 4 blocked tasks fastest: Option A (one-off backfill)

Run a local script to read the 4 stuck files and insert their content into
`streamlit_source_snapshot` (or directly into the task_queue `spec` JSONB as a
`source_content` field). The coordinator spec gains one clause in Phase 1a.
These 4 tasks can be re-fired tonight.

This requires no new Supabase table if you're willing to embed the source in the existing
task_queue `spec` JSONB column — just add `"source_content": "<file text>"` to the
spec JSON for those 4 rows. The coordinator reads `spec.source_content` if present.
No migration needed. Pure data backfill + coordinator spec patch.

**Estimated effort:** 2 hours including testing. One SQL UPDATE per task + coordinator
spec edit (3 lines).

### For the remaining 79 modules: Option A with dedicated table

Add `streamlit_source_snapshot` as a proper migration so the scan-and-queue flow
can populate it automatically. The coordinator spec reads from this table in Phase 1a
as its primary source, with a fallback comment: "If table row is absent, escalate —
do not attempt filesystem access." This makes the filesystem-dependency explicit and
auditable.

**Option B** (GitHub mirror) is rejected because it adds a sync-discipline requirement
with no enforcement. One forgotten push corrupts a coordinator run silently. The risk
profile is worse than Option A.

**Option C** (corpus retrieval) is rejected as primary because module-level code (the
dominant pattern in Streamlit pages) is never chunked. For the exact modules queued
for overnight runs — simple, short, script-style pages — corpus coverage is the worst.
Option C can remain as an **optional enrichment** in Phase 1a (coordinator reads corpus
chunks for supplementary function-level detail) but must not be the sole source of truth.

### Durability comparison at 84 modules

|                                          | A (snapshot table)      | B (GitHub mirror)        | C (corpus only)       |
| ---------------------------------------- | ----------------------- | ------------------------ | --------------------- |
| Correct for script-style pages (no defs) | Yes                     | Yes                      | No                    |
| Correct for large files (>1000 lines)    | Yes                     | Yes                      | Partial               |
| Stale risk on Streamlit change           | Low (noted in metadata) | Medium (silent drift)    | Medium (silent drift) |
| New infrastructure                       | One migration + table   | New repo + secret + sync | None                  |
| Maintenance burden                       | Low                     | Medium-high              | Low                   |
| Re-fire 4 tasks tonight                  | Yes (JSONB patch)       | No (new repo needed)     | Possible but risky    |

**Recommendation: Option A. Implement as JSONB patch first (tonight), migrate to dedicated
table in the next scanner PR.**

---

## 5 — Separate Bug: tax_centre Scanner Misclassification

This is **not** the same root cause as the cloud filesystem failure. Flag separately.

**What the scanner reported:**

```
6_Tax_Centre.py: 148 lines, small complexity
```

**What actually exists:**

```
pages/6_Tax_Centre.py          147 lines  ← entry-point router only
pages/tax_centre/__init__.py     1 line
pages/tax_centre/colin_tax.py  6922 lines  ← the real module
pages/tax_centre/megan_tax.py  1073 lines
Total:                         7995 lines
```

**Root cause:** `scanStreamlitModules` in `lib/scanners/streamlit-module-scanner.ts`
(line 92–94) skips any entry that does not end in `.py`:

```typescript
if (!entry.endsWith('.py')) continue
```

The `tax_centre/` directory entry passes the `isDirectory()` check at line 96–98 and is
skipped. The scanner reads `6_Tax_Centre.py` (the 147-line entry-point that `import`s
from `tax_centre/`) and correctly captures its line count — but misses the subdir entirely.

**Impact:**

- `af44ba61` (tax_centre overnight task) was queued with `estimated_weight: 'small'`,
  `line_count: 148`, `complexity: 'small'`
- The actual rebuild scope is ~8,000 lines — larger than PageProfit (3,374 lines),
  the current largest module
- The coordinator will write an acceptance doc scoped to a "small" module but the builder
  will find a large/complex subdir package
- The grounding checkpoint on this task is already required (tax figures) — but scope
  misclassification will surface as a separate surprise

**Recommended fix:** In `scanStreamlitModules`, when a `.py` entry imports from a
same-name subdirectory (e.g. `6_Tax_Centre.py` imports `from pages.tax_centre` or
`import tax_centre`), walk that subdir and add its line count to the parent candidate.
Alternatively: add an explicit subdir walk that detects Python packages (dirs with
`__init__.py`) and registers them as candidates in their own right.

**This is a separate scanner fix — do not block the cloud filesystem fix on it.**
The `af44ba61` task should be manually corrected in task_queue before re-fire:
update `spec.candidate.line_count` and `spec.estimated_weight` to reflect actual scope.

---

## 6 — Action Items (proposed, not implementing)

| #   | Action                                                                                              | Option      | Effort | Blocks                 |
| --- | --------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------- |
| 1   | SQL UPDATE: add `source_content` to `spec` JSONB for tasks 8b3d7030, a88b0018, ec1d00c7, 8ab362ac   | A           | 30 min | Re-fire tonight        |
| 2   | Coordinator spec patch: Phase 1a reads `spec.source_content` if present, else escalate              | A           | 30 min | Re-fire tonight        |
| 3   | Migration: `streamlit_source_snapshot` table                                                        | A           | 1h     | Future batch queuing   |
| 4   | Scanner patch: detect subdir packages (like tax_centre/) and walk them                              | scanner bug | 1h     | Accurate line counts   |
| 5   | SQL UPDATE: correct `af44ba61` task line_count and estimated_weight                                 | scanner bug | 10 min | Tax centre accuracy    |
| 6   | Option C (corpus enrichment): add as optional Phase 1a supplement after primary source is confirmed | C           | 1h     | Optional quality boost |

**Minimum to re-fire tonight:** items 1 and 2 only.
