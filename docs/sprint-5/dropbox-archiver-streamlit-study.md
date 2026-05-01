# Dropbox Archiver — Streamlit Study

**Sprint:** 5 (parallel track — Streamlit module port)
**Chunk:** `dropbox-archiver`
**Coordinator task:** `8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47`
**Source file:** `pages/97_Dropbox_Archiver.py` (141 lines)
**Source embedded:** yes — in task_queue metadata.source_content
**Date:** 2026-05-01

---

## What it does

A 3-stage pipeline for archiving old Dropbox files to an external hard drive. Stage 1
(Audit) runs in Streamlit Cloud and shows Dropbox storage usage plus a count of files
older than a configurable cutoff (default 90 days). Stages 2 and 3 must run locally
via terminal — Stage 2 downloads archiveable files to `C:/AI_Data/exports/dropbox`,
Stage 3 copies them to an external hard drive with SHA256 spot-check verification.

---

## How it does it

### Data source
- Calls `dropbox_archiver.audit(older_than_days=cutoff_days)` from `scripts/dropbox_archiver.py`.
- Audit result shape (from error handling code):
  ```
  { used_gb, quota_gb, pct, archiveable_total, already_local, need_download,
    need_download_bytes, files: [{path, size, is_local}, ...] }
  ```
- `files[]` is the full list of archiveable files, each with a local-presence flag.

### Auth
- Dropbox connection is in the backend script — credentials are not in the Streamlit page.
- Env vars consumed by script: assumed DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
  (confirmed present in Vercel — prerequisites marked DONE in task metadata).

### Cutoff slider
```python
cutoff_days = st.slider("Archive files older than", min_value=30, max_value=730, value=90, step=30, format="%d days")
```

### Metrics shown (Stage 1)
1. `Dropbox Used` — `{used_gb:.1f} GB` with delta `{pct:.0f}% of {quota_gb:.0f} GB`
2. `Archiveable Files` — `{archiveable_total:,}` files older than cutoff_days
3. `Already on Computer` — `{already_local:,}` (requires local filesystem scan → **dropped in LepiOS**)
4. `Need Download` — `{need_download:,}` with `{need_download_bytes/1024**3:.2f} GB`

### Stage 2 command (terminal only)
```
cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --download --days {cutoff_days}
```

### Stage 3 command (terminal only, drive letter hardcoded as D)
```
cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --transfer D --days {cutoff_days}
```

---

## Domain rules embedded

1. **Default cutoff is 90 days** (slider: 30–730, step 30).
2. **Protected folder `/Hubdoc/Uploads` is never deleted automatically** — shown in sidebar.
3. **Stage 1 runs in cloud; Stages 2–3 must run locally** — the Streamlit page explicitly
   tells the user to switch to a terminal for Stages 2–3.
4. **Already-on-Computer metric requires local filesystem** — `is_local` per file in audit
   result means the local path `C:/AI_Data/exports/dropbox` was checked by the backend script.
5. **Stage 2 output dir:** `C:/AI_Data/exports/dropbox` (hardcoded in `--download` command).
6. **Stage 3 uses SHA256 spot-checking** — mentioned in sidebar description.
7. **Stage 2 is safe to re-run** — sidebar note: "Safe to re-run — skips files already downloaded."
8. **Progress bar** shows `used_gb / quota_gb` usage percent.
9. **Conditional stage 2 skip**: if `need_download == 0`, show "All archiveable files already on PC. Proceed to Stage 3."

---

## Edge cases

1. `audit_result is None` — no audit run yet; Stage 1 shows info placeholder "Run the audit..."
2. `"error" in audit_result` — Stage 1 shows `st.error(f"Audit error: {audit_result['error']}")`
3. `ImportError` — `dropbox` package not installed on the running machine
4. `need_download == 0` — all archiveable files already local; skip Stage 2 entirely
5. `used_pct` could exceed 100 (Dropbox sometimes reports over-quota) → `st.progress(min(used_pct/100, 1.0))` clamps it
6. `files = []` with `audit_result` set — no archiveable files exist for the given cutoff

---

## Fragile or improvable points

1. **Hardcoded local path** in Stage 2/3 commands: `c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/` — breaks if Colin moves the workspace directory. Should be editable or at minimum clearly labeled as "update this path".
2. **Drive letter `D` hardcoded** in Stage 3 command — should be a dropdown/input.
3. **No caching** of audit results — each button press re-fetches from Dropbox. In Streamlit this is fine (session_state persists per tab); in a web API context this would make each page load hit the Dropbox API.
4. **`already_local` requires local filesystem** — not possible server-side; correctly dropped in spec.
5. **No timestamp shown** on audit result — user doesn't know how fresh the data is.
6. **Full recursive file traversal** for archiveable count — expensive for large accounts; Streamlit runs it locally so it's OK, but in a web API it would be slow.

---

## Colin's scope decisions (from task metadata.spec_decisions)

```
Hybrid port A+D:
(A) Pure informational — Dropbox account stats via OAuth API (used GB, file counts, oldest folder).
(D) Command reference — copy-to-clipboard buttons for local Stages 2-4 commands.
Dropped: 'Already on Computer' metric requires local filesystem scan.
```

**LepiOS scope is explicitly scoped to A+D.** Archiveable file count from full recursive
traversal is NOT in scope for the API endpoint; the API endpoint returns space usage stats
and a root-folder listing for the "oldest folder" metric.

---

## Twin Q&A — blocked (endpoint unreachable)

All four questions received `Host not in allowlist` from the production twin endpoint.
Adding all to `pending_colin_qs`.

| # | Question | Disposition |
|---|----------|-------------|
| Q1 | What drive letter does Colin use for the external hard drive (Stage 3)? | pending_colin_qs — [twin: unreachable] |
| Q2 | Are there other Dropbox folders protected from archiving besides /Hubdoc/Uploads? | pending_colin_qs — [twin: unreachable] |
| Q3 | How frequently does Colin run the Dropbox Archiver workflow? | pending_colin_qs — [twin: unreachable] |
| Q4 | Is the default 90-day cutoff Colin's preferred value, or does he usually change it? | pending_colin_qs — [twin: unreachable] |

---

## 20% Better

| Category | Streamlit limitation | LepiOS improvement |
|----------|---------------------|-------------------|
| Correctness | `already_local` requires local FS — silently shows 0 if run from wrong machine | Dropped per spec — not misleading anymore |
| Correctness | Drive letter D hardcoded in Stage 3 command | Drive letter as a text input (default D) so Colin doesn't need to manually edit the copied command |
| Performance | Full recursive Dropbox traversal for archiveable count — expensive | API returns space_usage + root-folder list only; no recursive traversal |
| UX | Static code blocks — user must select and copy | Copy-to-clipboard buttons — one click per stage |
| UX | No last-fetched timestamp | Show `Last fetched: X min ago` on the stats tile |
| UX | Protected folders noted in sidebar only | Show protected folder list inline on the page |
| UX | Cutoff days from session state (not bookmarkable) | `?days=90` query parameter — bookmarkable |
| Extensibility | Workspace path hardcoded | Show path with an edit note; could be a local setting in future |
| Observability | No logging of audit runs | Log `dropbox_audit_run` event to agent_events (F18) |
| Data model | No "oldest folder" in Streamlit version | Add `oldest_folder: {name, modified}` from root-level list_folder — helps Colin prioritize what to archive first |

**Semantic changes that require Colin Q:**
- Drive letter default D → input (not a semantic change, just UX — no escalation needed)
- All other improvements are cosmetic or performance — no domain-semantic escalation

---

## Pending Colin Questions

Before writing acceptance doc, routing to Colin:

1. **Q1 [twin: unreachable]** — What drive letter should be the default for the Stage 3 transfer command? (D assumed — can Colin confirm?)
2. **Q2 [twin: unreachable]** — Are there other protected Dropbox folders besides `/Hubdoc/Uploads`?
3. **Q3 [twin: unreachable]** — What is the approximate frequency of use (weekly? monthly?) — relevant for deciding whether to add a "last run" session tracker.
4. **Q4 [twin: unreachable]** — Is 90 days Colin's preferred default cutoff, or should the acceptance doc use a different default?
