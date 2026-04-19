# Sprint 3 — Chunk E.1 Acceptance Criteria

> Hit list: create a named list, add ISBNs. Persistence only. No scanning.
> The phone-to-computer grounding moment is E.2. This chunk builds the floor it stands on.

---

## Why This Chunk Exists

The scan card is ephemeral — scan a barcode, read the result, move on. Books worth revisiting
(sourcing trip leftovers, pallet holds, library sale previews) have nowhere to land. The hit list
is a persistent ISBN queue: add while in the field, enrich later at a desk.

E.1 ships the schema and the create/populate surface. Nothing else.

---

## Streamlit Baseline Note (§8.4 Check-Before-Build)

**`pages/21_PageProfit.py`** — Hit Lists tab:
- Create list: name input + ISBNs textarea (one per line)
- Select list from dropdown
- Batch scan pending ISBNs
- Delete list

**`utils/sourcing.py`** — `HITLIST_HEADERS`:
```python
["List Name", "ISBN", "Added Date", "Status", "Title",
 "Best Profit", "Best Marketplace", "Decision"]
```

**LepiOS differences from Streamlit:**

- Streamlit stores all lists flat in one Google Sheet tab. LepiOS uses two Supabase tables
  (`hit_lists` + `hit_list_items`) — normalized, indexed, join-capable.
- Streamlit duplicates Title/Best Profit/Best Marketplace/Decision into the hit list row.
  LepiOS does not — `hit_list_items` holds `scan_result_id FK → scan_results(id)` instead.
  View queries join on that FK. No data duplicated, no migration debt as marketplaces evolve.
- `cost_paid_cad` is nullable at add time. Entered at batch scan time (E.3) when the book
  is in hand. In the field at a pallet you don't know cost yet.

---

## Schema — migration 0010

```sql
-- 0010_add_hit_lists.sql

CREATE TABLE public.hit_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle TEXT NOT NULL DEFAULT 'colin',  -- SPRINT5-GATE: replace with profiles FK + RLS
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hit_list_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hit_list_id    UUID NOT NULL REFERENCES public.hit_lists(id) ON DELETE CASCADE,
  isbn           TEXT NOT NULL,
  cost_paid_cad  NUMERIC(8,2),                  -- nullable; populated at batch scan time (E.3)
  status         TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'scanned' | 'skipped'
  scan_result_id UUID REFERENCES public.scan_results(id) ON DELETE SET NULL,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at     TIMESTAMPTZ,
  UNIQUE (hit_list_id, isbn)
);

-- Indexes
CREATE INDEX ON public.hit_list_items (hit_list_id, status);
CREATE INDEX ON public.hit_list_items (scan_result_id);

-- RLS
ALTER TABLE public.hit_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hit_list_items ENABLE ROW LEVEL SECURITY;

-- SPRINT5-GATE: policy currently allows any authenticated user read/write access
-- (fine for single-operator today). Tighten to profiles.id when multi-user auth
-- lands per ARCHITECTURE.md §7.3 hard gate.
CREATE POLICY "hit_lists_authenticated" ON public.hit_lists
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "hit_list_items_authenticated" ON public.hit_list_items
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

`scan_result_id ON DELETE SET NULL`: if a scan_results row is ever deleted, the hit list item
survives with `status` intact — it just loses the cached enrichment and can be rescanned.

---

## API Routes

### `GET /api/hit-lists`

Returns all lists for `person_handle = 'colin'`, ordered by `created_at DESC`.

```json
[
  { "id": "uuid", "name": "March Pallet", "created_at": "2026-04-20T...", "item_count": 12 }
]
```

`item_count` is a count subquery — no separate call needed in the UI.

---

### `POST /api/hit-lists`

Create a new list.

Request:
```json
{ "name": "March Pallet" }
```

Response `201`:
```json
{ "id": "uuid", "name": "March Pallet", "created_at": "..." }
```

Validation: `name` required, non-empty, max 80 chars. Returns `400` with `{ "error": "..." }` otherwise.

Duplicate names: allowed. Two lists can share a name (user's problem to disambiguate by date).

---

### `POST /api/hit-lists/[id]/items`

Add ISBNs to an existing list. Idempotent on `(hit_list_id, isbn)` — duplicate ISBNs silently ignored (UNIQUE constraint + upsert).

Request:
```json
{ "isbns": ["9780062316097", "9780385490818"] }
```

Response `200`:
```json
{ "added": 2, "skipped": 0 }
```

- `added`: rows inserted
- `skipped`: ISBNs already present in the list (deduped silently)
- Max 200 ISBNs per request. Returns `400` if exceeded.
- ISBNs are stored as-is (string). No ISBN validation in E.1 — that happens at scan time (E.3).

---

## UI — `/hit-lists`

New route: `app/(cockpit)/hit-lists/page.tsx`

Auth guard: same pattern as `/scan` — redirect to `/login` if no session.

### Layout (single page, two panels)

```
┌─────────────────────────────────────────┐
│ HIT LISTS                               │
├─────────────────────────────────────────┤
│ + New list          [name input] [Add]  │
├─────────────────────────────────────────┤
│ Select list: [dropdown ▼]               │
├─────────────────────────────────────────┤
│ Add ISBNs:                              │
│ ┌────────────────────────────────────┐  │
│ │ 9780062316097                      │  │
│ │ 9780385490818                      │  │
│ └────────────────────────────────────┘  │
│ [Add to list]   2 added, 0 skipped      │
└─────────────────────────────────────────┘
```

- "New list" input: creates list on submit, auto-selects it in the dropdown
- Dropdown: shows `name (N items)` for each list, ordered newest first
- ISBNs textarea: one per line, blank lines ignored, leading/trailing whitespace stripped
- Confirmation message: inline after "Add to list" press — `{added} added, {skipped} already in list`
- No navigation away — user stays on the page to add more

### Cockpit nav

Add "Hit Lists" link to the cockpit nav alongside Scan. Position: after Scan.

---

## Build Sequence

1. `supabase/migrations/0010_add_hit_lists.sql` — apply via Supabase MCP
2. `app/api/hit-lists/route.ts` — GET (list all) + POST (create)
3. `app/api/hit-lists/[id]/items/route.ts` — POST (add ISBNs)
4. `app/(cockpit)/hit-lists/page.tsx` + `_components/HitListClient.tsx`
5. Add nav link
6. Unit tests for API route validation (name length, ISBN count limit)
7. Smoke test: create list, add ISBNs, verify rows in Supabase

---

## Pass Conditions

- [ ] `GET /api/hit-lists` returns empty array for fresh user
- [ ] `POST /api/hit-lists` with valid name: creates row, returns 201 with id
- [ ] `POST /api/hit-lists` with empty name: returns 400
- [ ] `POST /api/hit-lists` with name > 80 chars: returns 400
- [ ] `POST /api/hit-lists/[id]/items` with 2 ISBNs: returns `{ added: 2, skipped: 0 }`
- [ ] Re-posting the same ISBNs: returns `{ added: 0, skipped: 2 }` (no duplicate rows)
- [ ] `POST /api/hit-lists/[id]/items` with 201 ISBNs: returns 400
- [ ] `/hit-lists` page: unauthenticated request redirects to `/login`
- [ ] Create list → auto-appears in dropdown
- [ ] Add ISBNs → confirmation count shown inline
- [ ] `hit_list_items` rows: `status = 'pending'`, `cost_paid_cad = null`, `scan_result_id = null`
- [ ] `npm test` passes

## Fail Conditions (stop and escalate)

- Duplicate ISBNs inserted (UNIQUE constraint must hold)
- `cost_paid_cad`, `scan_result_id`, or `scanned_at` written as non-null at add time
- Any scan logic triggered from E.1 UI
- Auth bypass: unauthenticated request reaches any hit-list API route

---

## Out of Scope (Chunk E.1)

- View / browse list items (E.2)
- Delete list or delete item (E.2)
- Batch scan (E.3)
- Cost entry (E.3 — at scan time)
- "Save to list" from scan result card (E.4)
- ISBN validation (E.3 — at scan time, before Keepa call)
- Sorting, filtering, export
