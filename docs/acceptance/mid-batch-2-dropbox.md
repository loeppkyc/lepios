# Acceptance Doc — Dropbox Archiver (MID batch 2)

**Streamlit source:** `pages/97_Dropbox_Archiver.py` (141 lines)
**LepiOS route:** `/dropbox-archiver` → `app/(cockpit)/dropbox-archiver/`
**Branch:** `feat/mid-batch-profile`
**Migration:** 0184 — `dropbox_audit_runs` table

## Streamlit study

3-stage pipeline:

- **Stage 1 (Audit)** — Calls `dropbox_archiver.audit(older_than_days)` Python function. Returns `{used_gb, quota_gb, pct, archiveable_total, already_local, need_download, need_download_bytes, files[]}`. Renders 4 metrics + progress bar.
- **Stage 2 (Download)** — Shows terminal command: `python tools/dropbox_archiver.py --download --days N`. Info-only; no server-side action.
- **Stage 3 (Transfer)** — Shows terminal command: `python tools/dropbox_archiver.py --transfer D --days N`. Info-only; no server-side action.

Settings: `cutoff_days` slider (30–730, default 90).

## LepiOS implementation

Stage 1 API route calls Dropbox SDK. Stages 2-3 remain terminal instructions.

- **Stage 1** → POST `/api/dropbox-archiver` `{ cutoff_days }` → server-side Dropbox API call via `DROPBOX_ACCESS_TOKEN` env var → persists result to `dropbox_audit_runs` → returns run row
- **Stage 2** — static code block (no change from Streamlit)
- **Stage 3** — static code block (no change from Streamlit)

## 20% improvements

- **Persist last audit** — `dropbox_audit_runs` table stores each audit; page loads last run on mount so you see current state without re-running the Dropbox API call
- **Stale indicator** — if last run > 24h old, show amber "Last audited X hours ago — re-run to refresh"

## Schema (migration 0184)

```sql
CREATE TABLE public.dropbox_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cutoff_days int NOT NULL DEFAULT 90,
  used_gb numeric(8,3), quota_gb numeric(8,3), pct_used numeric(5,2),
  archiveable_total int, already_local int, need_download int, need_download_gb numeric(8,3),
  ran_at timestamptz NOT NULL DEFAULT now()
);
```

## Env var required

`DROPBOX_ACCESS_TOKEN` — long-lived token from Dropbox app console. If absent, Stage 1 returns `{ error: 'DROPBOX_ACCESS_TOKEN not configured' }` and the UI shows a setup instructions card instead of the audit button.

## Files

```
app/(cockpit)/dropbox-archiver/page.tsx
app/(cockpit)/dropbox-archiver/_components/DropboxArchiverPage.tsx
app/api/dropbox-archiver/route.ts
supabase/migrations/0184_dropbox_audit_runs.sql
```

## Acceptance criteria

- [ ] Page loads and shows last audit result if `dropbox_audit_runs` has a row for this user
- [ ] "Run Audit" button POSTs to `/api/dropbox-archiver`, saves result, updates UI
- [ ] Stale indicator appears if last run > 24h
- [ ] If `DROPBOX_ACCESS_TOKEN` absent, shows setup card (not a broken button)
- [ ] Stages 2 & 3 show correct terminal commands with active cutoff_days value
- [ ] No `style={}` (F20), migration 0184 applies cleanly

## F17 signal

Low — maintenance/utility page. No behavioral signal.

## F18 metric

`dropbox_audit_runs` IS the metric table. Surface: "How much Dropbox storage do I have left?" → query latest run. Benchmark: Dropbox API call < 5s (their typical latency for listing).
