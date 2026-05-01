# Blocked Tasks — Design Decisions

**Date:** 2026-04-28  
**Tasks unblocked by this doc:** `a88b0018` (Profile), `8ab362ac` (Dropbox Archiver)  
**Status:** Awaiting Colin approval before tasks are set to `approved`

---

## Decision 1 — Profile module (a88b0018): Module Preferences section

### Audit findings

**What `SECTION_NAMES` contains (10 sections):**

```
Dashboard | Accounting & Tax | Amazon & Inventory | Scanning & Sourcing
Deals & Savings | Marketplace | Personal Finance | Trading & Betting
Life | System
```

**`ALWAYS_VISIBLE`:** `{"Dashboard", "System"}` — these two cannot be deselected.

**How it works:** Selected modules stored as a JSON array in the `SelectedModules` column of the Google Sheets `Users` table, cached 30 min via `@st.cache_data(ttl=1800)`. On load, `app.py` calls `get_selected_modules(username)` and filters the sidebar: sections not in the user's list are moved into a collapsed "Browse All Modules" expander rather than removed entirely.

**Consumers — only 2:**

1. `app.py:173` — sidebar rendering (the actual filter)
2. `pages/9_Profile.py:92` — the UI to change the setting

No individual page branches on selected modules. It is purely a sidebar visibility filter.

**LepiOS state — fully greenfield:**

- No `user_preferences` or equivalent table in Supabase (confirmed — 37 tables, none named preferences)
- No preferences code in `lib/` TypeScript
- `app/(cockpit)/_components/CockpitNav.tsx` has a fixed `NAV_LINKS` array — no filtering infrastructure

### Why this feature exists in Streamlit

The Streamlit OS has 85 pages across 10 sidebar sections. Showing all 10 sections by default creates navigation noise. The preferences system lets Colin (or a future second user) hide sections they don't use.

### Why it doesn't apply to LepiOS (yet)

LepiOS currently has ~12 nav links across a single compact nav bar. There is no noise problem. The cockpit's fixed nav is a feature, not a gap — it surfaces everything relevant without needing filtering.

### Options

| Option                                                         | Effort | Delivers                                              |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| **A) PORT IT** — new `user_preferences` table + settings UI    | ~2-3h  | Full parity, but solving a problem that doesn't exist |
| **B) STUB IT** — render section with "coming soon" placeholder | 10 min | Parity in structure, defers the decision              |
| **C) SKIP IT** — omit from port entirely                       | 0      | Correct scope for current LepiOS nav                  |

### Recommendation: **C — Skip it**

The feature exists to filter a 85-page sidebar. LepiOS nav is compact and fixed by design. Building a `user_preferences` table + CRUD UI is ~2-3 hours of greenfield infrastructure for a problem LepiOS won't have until the nav grows to 30+ items. When that day comes, the right implementation will also have auth context that doesn't exist yet.

The rest of `9_Profile.py` (Account Info, Display Name, Change Password) ports cleanly. The acceptance doc for `a88b0018` should scope to those three sections and explicitly mark Module Preferences as out-of-scope with a note explaining why.

**Colin's call:** ☐ A — Port it &nbsp;&nbsp; ☐ B — Stub it &nbsp;&nbsp; ☐ C — Skip it (recommended)

---

## Decision 2 — Dropbox Archiver module (8ab362ac): hybrid cloud/local design

### Audit findings

**Full 4-stage pipeline (backend: `scripts/dropbox_archiver.py`):**

| Stage            | What it does                                                                                    | Runs where                   |
| ---------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- |
| 1a — Usage stats | `dbx.users_get_space_usage()` → used GB, quota GB, % full                                       | Dropbox API — anywhere       |
| 1b — File list   | `dbx.files_list_folder("", recursive=True)` → files older than N days                           | Dropbox API — anywhere       |
| 1c — Local check | Compares `C:/AI_Data/exports/dropbox` filesystem against Dropbox paths                          | **Local machine only**       |
| 2 — Download     | `dbx.files_download_to_file()` → writes to `C:/AI_Data/exports/dropbox`                         | **Local machine only**       |
| 3 — Transfer     | `shutil.copy2()` → copies to `D:/AI_Data/dropbox_archive` with SHA256 spot-check                | **Local machine only**       |
| 4 — Delete       | `dbx.files_delete_v2()` → removes from Dropbox after verifying transfer manifest on local drive | Needs local manifest as gate |

**What the Streamlit UI actually does:**

- Stage 1 runs on Streamlit Cloud (API calls work fine)
- Stage 1's "Already on Computer" metric requires local path checks — this only works because Colin runs Streamlit locally or the Streamlit Cloud session has access to mounted paths (unclear, but the page was written expecting it to work)
- Stages 2-3 are rendered purely as terminal command snippets with `st.code()` — **no execution, just copy-paste instructions**
- Stage 4 (delete) is not exposed in the Streamlit page at all — CLI only

**Auth:** Dropbox uses `oauth2_refresh_token` + `app_key` + `app_secret` stored in `st.secrets["dropbox"]`. This is a standard OAuth2 refresh flow — fully usable from Vercel via env vars.

**Purpose:** Storage management / archival. The primary job is: _free up Dropbox cloud storage by identifying old files, downloading them to Colin's PC, copying to external drive, then deleting from Dropbox._ It is not primarily informational.

**Vercel feasibility breakdown:**

- Dropbox storage stats (used/quota): ✅ fully feasible on Vercel
- List of archiveable files by age: ✅ fully feasible on Vercel
- "Already local" count: ❌ not feasible — requires `C:/AI_Data` filesystem
- Download/Transfer/Delete execution: ❌ not feasible — all require local filesystem
- Command reference rendering: ✅ trivially feasible

### Options

| Option                                                                                                      | Feasibility                                             | Effort                       | What Colin gets                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| **A) Pure informational** — Dropbox API stats only (used GB, quota, archiveable count/size by age)          | Fully feasible                                          | ~1-2h (Dropbox OAuth wiring) | Dashboard tile showing storage health         |
| **B) Full server-side port**                                                                                | Not feasible — local filesystem required for stages 2-4 | Very high / impossible       | —                                             |
| **C) Deprecate** — local Python script is canonical, don't port                                             | Trivially feasible                                      | 0                            | Nothing in LepiOS, feature lost from web      |
| **D) Hybrid: informational + command reference** — API stats + rendered terminal commands with copy buttons | Fully feasible                                          | ~1.5-2h                      | Storage dashboard + launch-pad for local runs |

### Recommendation: **A+D hybrid — informational dashboard + command launch-pad**

**What to build:**

- Render Dropbox storage metrics via API: used GB, quota GB, % full, progress bar
- Render archiveable file count + size (files older than N days) via API — no local check, so "Already on Computer" column is removed
- Render Stages 2-4 as copyable terminal commands (exactly as Streamlit did, already the right design for local-execution operations)
- Clearly label the page as "Dashboard + Launch Pad — execution runs locally"

**Why not C (deprecate):**  
The Dropbox storage stats are genuinely useful cockpit data — knowing you're at 87% of quota is an at-a-glance signal that belongs in a command center. The API is already wired with OAuth credentials. Throwing away the informational value because the file-copy stages can't run on Vercel would be the wrong call.

**Why not full A (pure informational only):**  
Stages 2-4 as terminal command snippets adds zero implementation complexity but real workflow value — Colin can open `/dropbox-archiver`, see the storage situation, and immediately copy the right `python tools/dropbox_archiver.py --download --days 90` command without hunting for the right syntax. The Streamlit version did exactly this and it's correct design.

**What to drop from scope:**

- The "Already on Computer" metric (requires `C:/AI_Data` local path — not feasible from Vercel)
- Stage 4 (Delete) execution — never exposed in the Streamlit UI anyway, CLI-only
- The sidebar cutoff-days slider can remain (controls the API query for archiveable files)

**OAuth setup required:** Dropbox `app_key`, `app_secret`, and `oauth2_refresh_token` need to be added as Vercel env vars. They exist in Streamlit secrets — Colin needs to port them. This is the main implementation dependency, not the code itself.

**Colin's call:** ☐ A — Pure informational only &nbsp;&nbsp; ☐ C — Deprecate &nbsp;&nbsp; ☐ D — A+D hybrid (recommended) &nbsp;&nbsp; ☐ Other

---

## Approval gate

Once Colin marks decisions above, update `task_queue` accordingly:

```sql
-- Profile: if C (skip) — update scope, set approved
UPDATE task_queue SET status = 'approved',
  metadata = jsonb_set(metadata, '{module_prefs_decision}', '"skip"')
WHERE id = 'a88b0018-72fd-4e14-8d8f-815eb6eee2b9';

-- Dropbox: if A+D hybrid — set approved with scope note
UPDATE task_queue SET status = 'approved',
  metadata = jsonb_set(metadata, '{dropbox_scope}', '"informational_plus_command_ref"')
WHERE id = '8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47';
```

Both tasks require acceptance docs before builder handoff. The coordinator will need `source_content` in metadata (already patched by the `scripts/patch-task-source-content.ts` backfill in PR #32).
