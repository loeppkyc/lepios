# Dropbox Archiver — Acceptance Doc

**Sprint:** 5 (parallel track — Streamlit module port)
**Chunk:** `dropbox-archiver`
**Coordinator task:** `8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47`
**Study doc:** `docs/sprint-5/dropbox-archiver-streamlit-study.md`
**Date:** 2026-05-01
**Cache-match:** DISABLED (Sprint 4 baseline carry-forward — explicit override in sprint-state.md)

---

## Scope

Port `97_Dropbox_Archiver.py` to LepiOS as a read-only information panel: (A) Dropbox
storage stats tile fetched via OAuth API (used GB, quota GB, usage %, root entry count,
oldest folder), and (D) a command reference section with copy-to-clipboard buttons for
the local Stage 2 (download) and Stage 3 (transfer) terminal commands.

**Acceptance criterion:** Colin can open `/dropbox`, see his current Dropbox storage
usage and oldest root folder in a stats tile, and click "Copy" next to each stage
command to get a ready-to-run terminal string — without navigating to Streamlit.

---

## Out of scope

- `already_local` (Already on Computer) metric — requires local filesystem scan (server-side impossible)
- Actual download/transfer execution (Stages 2–3 are local-only by design)
- Archiveable files recursive count (full Dropbox traversal — expensive; covered by root-level file counts)
- Historical storage trend chart (future; needs periodic data capture)
- Mobile offline usage
- Multi-account Dropbox support

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0041_register_dropbox_archiver_component.sql` | New — registers `harness:streamlit_rebuild_dropbox_archiver` in `harness_components` at 100% |
| `app/api/dropbox/audit/route.ts` | New — GET handler: refresh token exchange + space_usage + list_folder calls |
| `app/(cockpit)/dropbox/page.tsx` | New — server component: renders stats tile + command reference |
| `app/(cockpit)/dropbox/_components/CommandReference.tsx` | New — client component: copy-to-clipboard buttons, drive letter input |
| `app/(cockpit)/layout.tsx` | Update — add nav entry for `/dropbox` if nav list is explicit |
| `tests/dropbox-archiver.test.ts` | New — F21 acceptance tests (written before implementation) |

---

## Check-Before-Build findings

| Check | Result |
|-------|--------|
| Existing `/dropbox` page | Not found — build fresh |
| Existing `/api/dropbox/*` route | Not found — build fresh |
| Dropbox env vars (DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN) | DONE — verified present in Vercel env (task prerequisites) |
| `harness:streamlit_rebuild_dropbox_archiver` in harness_components | Not found — migration 0041 creates it |
| Prior `dropbox` imports in `lib/` | None — no existing Dropbox client code |
| Next migration number | 0041 ✓ (0040 is last; 0100_chunk_h_promote.sql uses separate numbering block) |

---

## External deps tested

| Dep | Status | Notes |
|-----|--------|-------|
| Dropbox OAuth2 refresh token flow | Verified per prerequisites | Token exchange confirmed 2026-04-27 |
| Dropbox REST API v2 `/users/get_space_usage` | Presumed live — same token | No direct test from coordinator env |
| Dropbox REST API v2 `/files/list_folder` | Presumed live — same token | No direct test from coordinator env |
| Twin endpoint | Unreachable from build env | All Phase 1b questions deferred to Colin |

---

## Schema spec

### Migration 0041

```sql
-- 0041_register_dropbox_archiver_component.sql
-- No table migration needed: Dropbox Archiver is a pure API + read-only page.
-- Only registers the harness component.

INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes, updated_at)
VALUES (
  'harness:streamlit_rebuild_dropbox_archiver',
  'Streamlit rebuild — Dropbox Archiver',
  1.0,
  100.0,
  'Tier 3 port of pages/97_Dropbox_Archiver.py. Read-only stats tile + command reference. No Supabase table.',
  now()
);
```

> **Safety Agent review:** Migration inserts a single row into `harness_components`. No table
> creation, no DROP, no RLS changes. Fully reversible (DELETE by id). No Colin approval
> required beyond acceptance doc review.

---

## API spec — `GET /api/dropbox/audit`

### Query params

| Param | Default | Notes |
|-------|---------|-------|
| `days` | `90` | Files older than this many days are considered archiveable; passed through to the response to drive Stage 2/3 commands |

### Auth flow (inside the route handler)

```typescript
// 1. Exchange refresh token for access token
const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
    client_id: process.env.DROPBOX_APP_KEY!,
    client_secret: process.env.DROPBOX_APP_SECRET!,
  }),
})
const { access_token } = await tokenRes.json()
```

### Dropbox API calls (parallel)

```typescript
const [spaceRes, folderRes] = await Promise.all([
  // Space usage
  fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: 'null',
  }),
  // Root folder listing (non-recursive — lightweight)
  fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '', recursive: false }),
  }),
])
```

### Response shape

```typescript
{
  used_bytes: number,
  quota_bytes: number,
  used_gb: number,         // used_bytes / 1024^3, 2 decimal places
  quota_gb: number,        // quota_bytes / 1024^3, 1 decimal place
  pct: number,             // (used_bytes / quota_bytes) * 100, 1 decimal place
  root_entry_count: number, // total items at Dropbox root
  oldest_folder: {
    name: string,
    path: string,
    client_modified: string, // ISO 8601
  } | null,
  days: number,            // echo the query param back (for command template rendering)
  fetched_at: string,      // ISO 8601 — for "last fetched" display
}
```

`oldest_folder` is the root-level entry with the oldest `client_modified` timestamp.
If root is empty, `oldest_folder` is `null`.

### Error handling

- Token exchange fails (bad credentials): return HTTP 502 with `{ error: "dropbox_auth_failed" }`
- Dropbox API 4xx/5xx: return HTTP 502 with `{ error: "dropbox_api_error", status: N }`
- Missing env vars: return HTTP 500 with `{ error: "missing_env_vars" }` (never expose which)

### F18 logging

```typescript
await supabaseServiceClient.from('agent_events').insert({
  domain: 'automation',
  action: 'dropbox_audit_run',
  actor: 'user',
  status: 'success',
  meta: { used_gb, quota_gb, pct, root_entry_count, days },
})
```

---

## Page spec

### Route

`app/(cockpit)/dropbox/page.tsx` → URL: `/dropbox`

### Server component data fetch

```typescript
// searchParams.days falls back to '90' if absent
const days = Number(searchParams?.days ?? '90')
const audit = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/dropbox/audit?days=${days}`, {
  cache: 'no-store',
})
const data = await audit.json()
```

### Stats tile (4 metrics)

| Metric | Value | Format |
|--------|-------|--------|
| Dropbox Used | `{used_gb} GB / {quota_gb} GB` | `X.XX GB / X.X GB` |
| Usage % | `{pct}%` | `XX.X%` with progress bar |
| Root Items | `{root_entry_count}` items | integer |
| Oldest Folder | `{oldest_folder.name}` | name + `(last modified {date})` |

Progress bar: `<Progress value={pct} className="mt-2" />` — capped at 100.

### Command reference section

Client component `CommandReference.tsx` receives `{ days, oldest_folder }` props.

#### Drive letter input
- Text input (1 char, uppercase), default `D`
  - **Coordinator assumed D per Streamlit hardcode.** Colin: please confirm at review (Q1).
- Reactive: as input changes, all Stage 3 command strings update live (client-side).

#### Stage 2 — Download
```
Copy button → command string:
cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --download --days {days}
```

#### Stage 3 — Transfer
```
Copy button → command string:
cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --transfer {driveLetter} --days {days}
```

#### Protected folders note
Static callout: `Protected: /Hubdoc/Uploads (never deleted automatically)`
- **Coordinator used only /Hubdoc/Uploads per Streamlit source.** Colin: confirm if others (Q2).

#### Last fetched
Show `Last fetched: {relative time}` below the stats tile using `fetched_at` from API response.

### Cutoff days input
- Optional `?days=N` query param drives both the API fetch and command strings.
- Add a simple number input (min 30, max 730, step 30) that navigates to `?days={N}` on change.
- Default shown: 90. Coordinator uses Streamlit default — Colin: confirm (Q4).

---

## F17 — Behavioral ingestion justification

Dropbox Archiver logs `dropbox_audit_run` events to `agent_events` (used_gb, pct, days).
Over time this builds a storage trend: "Dropbox was at 78% a month ago, now 83% — archiving
needed." The morning_digest can surface `action='dropbox_audit_run' ORDER BY occurred_at DESC
LIMIT 1` to show Colin's current storage level without opening LepiOS. Satisfies F17 minimum
bar: measurable, autonomous-queryable.

---

## F18 — Measurement + benchmark

| Metric | How to query | Benchmark |
|--------|-------------|-----------|
| Current Dropbox usage % | `SELECT meta->>'pct' FROM agent_events WHERE action='dropbox_audit_run' ORDER BY occurred_at DESC LIMIT 1` | < 80% = healthy |
| Audit frequency | `SELECT COUNT(*) FROM agent_events WHERE action='dropbox_audit_run' AND occurred_at > now() - interval '30 days'` | Should increase after each archiving cycle |
| Oldest folder age | Computed at render from `oldest_folder.client_modified` | If > 1 year old → archiving overdue |

---

## Grounding checkpoint

After builder ships and migration is applied:

1. `SELECT * FROM harness_components WHERE id = 'harness:streamlit_rebuild_dropbox_archiver'` — verify row exists with completion_pct = 100
2. Load `/dropbox` — verify page renders with stats tile and 4 metrics visible
3. Verify "Dropbox Used", "Usage %", "Root Items", "Oldest Folder" all show real values (not `—` or error)
4. Click "Copy" on the Stage 2 command — paste into a text editor and verify the correct command string appears with `--days 90`
5. Change drive letter input to `E` — verify Stage 3 command string updates live without page reload
6. `SELECT meta FROM agent_events WHERE action='dropbox_audit_run' ORDER BY occurred_at DESC LIMIT 1` — verify F18 event logged with `pct` and `days` fields

**NOT a grounding checkpoint:** tests pass. Tests verify code, not live API behavior.

---

## Kill signals

- Dropbox token exchange fails with 401 (refresh token revoked) → unblock by rotating refresh token in Vercel env; do NOT hardcode in code
- Migration 0041 conflicts with a concurrently applied migration → rename to next available number
- Page renders but API always returns 502 → diagnose Dropbox OAuth env vars in Vercel
- Colin says Dropbox Archiver is being retired → close task as won't-fix

---

## F20 compliance requirements

Builder acceptance tests MUST grep `app/(cockpit)/dropbox/` for `style=` and verify:

- No arbitrary values (hex colors, pixel values, string widths) in `style={}`
- CSS design-token vars (`var(--color-*)`, etc.) are allowed
- All layout via Tailwind utility classes

---

## Open questions — pending Colin confirmation

All four questions are from Twin Q&A (twin unreachable). Acceptance doc uses Streamlit-source
defaults where deterministic; Colin confirms at review.

| # | Question | Default used | Blocking? |
|---|----------|-------------|-----------|
| Q1 | Drive letter for Stage 3 transfer command? | `D` (Streamlit hardcode) | No — input with default |
| Q2 | Other protected folders besides `/Hubdoc/Uploads`? | Only `/Hubdoc/Uploads` (Streamlit source) | No — static callout, easy to add more |
| Q3 | How frequently is the archiver used? (informs whether to add "last run" tracker) | Not included in scope | No — out of scope for this doc |
| Q4 | Preferred default cutoff: 90 days or different? | 90 (Streamlit default) | No — input with default |

---

## META-C evaluation

**Cache-match DISABLED** — explicit override `cache_match_enabled: false` in sprint-state.md
(Sprint 4 baseline, rule 4 of Phase 0). Every acceptance doc escalates to Colin.

This doc is submitted to Colin for explicit approval before going to builder.

---

## Builder pre-flight notes

*(To be added by Colin at review if needed.)*

1. **Auth pattern** — Read `app/(cockpit)/money/page.tsx` or another cockpit server component for the correct Supabase auth-helpers pattern before writing `page.tsx`.
2. **Nav structure** — Read `app/(cockpit)/layout.tsx` to identify the nav list structure before adding the `/dropbox` entry.
3. **F21 — tests before code** — Write `tests/dropbox-archiver.test.ts` before implementing the route handler, page, or client component.
4. **F20 grep required** — After writing all TSX files under `app/(cockpit)/dropbox/`, grep for `style=` and verify no arbitrary values.
5. **Migration number** — Verify 0041 is still the next available number at build time. If taken, use the next available and update the acceptance doc migration reference accordingly.
6. **Env vars** — Read from `process.env.DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`. Do NOT hardcode. Do NOT log values. Return 500 on missing, not a 4xx that could expose env names.
