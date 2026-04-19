# Sprint 3 — Chunk E.2 Acceptance Criteria

> Hit list: view items, delete item, delete list. No scanning.
> E.1 built the floor. E.2 makes it navigable.

---

## Why This Chunk Exists

E.1 lets you add ISBNs. E.2 lets you see what's in a list and clean it up — remove a
duplicate, delete a dead list, verify the queue before heading into E.3 batch scan.

---

## Streamlit Baseline Note (§8.4 Check-Before-Build)

**`pages/21_PageProfit.py`** — list view section (lines ~2873–2974):
- 3-column metrics: Total ISBNs / Pending / Scanned
- Expander: "Full List" — `st.dataframe` of all items
- Delete list button: deletes all rows for that list name, reruns

**LepiOS differences from Streamlit:**
- Streamlit metrics include Scanned count (from batch scan). LepiOS E.2 has no scan data yet
  — show Total / Pending only. Scanned/Skipped counts come in E.3 when items are actually scanned.
- Streamlit delete is a single button (no confirm). LepiOS uses `window.confirm` before list
  delete (data loss is permanent; items are the whole point of the list).
- Individual item delete: not in Streamlit (flat sheet made row-delete awkward). LepiOS
  has normalized rows so per-item delete is trivial — include it in E.2.
- `cost_paid_cad` is null at this stage — do not show it in the item list. Will appear in E.3.

---

## No New Migration

All tables from 0010 are sufficient. E.2 adds API routes and extends the UI only.

---

## API Routes

### `GET /api/hit-lists/[id]/items`

Returns all items for a list, ordered by `added_at ASC`.

Auth: same pattern — 401 if no session.

Response `200`:
```json
[
  {
    "id": "uuid",
    "isbn": "9780062316097",
    "status": "pending",
    "added_at": "2026-04-20T..."
  }
]
```

Only expose fields relevant to E.2: `id`, `isbn`, `status`, `added_at`.
`cost_paid_cad` and `scan_result_id` are withheld — not useful until E.3.

Returns `404` if list not found or doesn't belong to `person_handle = 'colin'`.

---

### `DELETE /api/hit-lists/[id]`

Deletes a hit list. `ON DELETE CASCADE` handles items automatically.

Auth: 401 if no session. 404 if list not found.

Response `200`: `{ "deleted": true }`

---

### `DELETE /api/hit-lists/[id]/items/[itemId]`

Deletes one item from a list.

Auth: 401 if no session. 404 if item not found or doesn't belong to this list.

Response `200`: `{ "deleted": true }`

---

## UI — `/hit-lists` (extend HitListClient)

Same page — extend `HitListClient.tsx` to show items when a list is selected.

### Item list panel (below ISBN textarea, above Add button row)

Appears as soon as a list is selected and items exist.

```
┌─────────────────────────────────────────┐
│ APRIL PALLET  ·  3 ISBNs  ·  3 pending │
│                            [Delete list]│
├─────────────────────────────────────────┤
│ 9780062316097   pending   Apr 20  [×]   │
│ 9780385490818   pending   Apr 20  [×]   │
│ 9780307888037   pending   Apr 20  [×]   │
└─────────────────────────────────────────┘
```

- Header row: list name · item count · pending count · "Delete list" button (right-aligned)
- Item rows: isbn | status pill | date (MMM DD) | ×-delete button
- "Delete list" button: calls `window.confirm("Delete [name] and all [N] ISBNs?")` → DELETE /api/hit-lists/[id] → remove from dropdown, auto-select next list (or clear if none)
- × button: DELETE /api/hit-lists/[id]/items/[itemId] → remove row from UI immediately
- Status pill: `pending` in muted style; `scanned` in positive; `skipped` in disabled. E.2 will only ever show `pending` but the pill logic can be written once.
- Empty state: "No items yet. Add ISBNs above."
- Items fetch: triggered on (a) list select change, (b) after successful "Add to list", (c) after item delete

### Item count in dropdown

Already handled by E.1's `item_count` from the GET /api/hit-lists subquery. Refreshed after item delete.

---

## Build Sequence

1. `app/api/hit-lists/[id]/route.ts` — GET items + DELETE list (two methods, one file)
2. `app/api/hit-lists/[id]/items/[itemId]/route.ts` — DELETE item
3. Extend `HitListClient.tsx` — add item fetch, item list panel, delete handlers
4. Unit tests: DELETE route validation (list ownership check, item ownership check)
5. Smoke test: view items, delete one item, delete list

---

## Pass Conditions

- [ ] `GET /api/hit-lists/[id]/items` returns items array ordered `added_at ASC`
- [ ] `GET /api/hit-lists/[id]/items` returns `[]` for list with no items
- [ ] `GET /api/hit-lists/[id]/items` returns 404 for unknown list id
- [ ] `DELETE /api/hit-lists/[id]` removes list + cascades items
- [ ] `DELETE /api/hit-lists/[id]` returns 404 for unknown list id
- [ ] `DELETE /api/hit-lists/[id]/items/[itemId]` removes one item, list survives
- [ ] `DELETE /api/hit-lists/[id]/items/[itemId]` returns 404 for unknown item id
- [ ] Unauthenticated requests to all three routes return 401
- [ ] Select list → items appear in panel
- [ ] Add ISBNs → items panel refreshes with new rows
- [ ] × delete item → row removed immediately, dropdown count updates
- [ ] Delete list → list removed from dropdown, next list auto-selected (or panel cleared)
- [ ] `window.confirm` shown before list delete
- [ ] `npm test` passes

## Fail Conditions (stop and escalate)

- List delete without confirm prompt
- DELETE /api/hit-lists/[id] deletes a list owned by a different `person_handle`
- Item delete removes items from a different list
- `cost_paid_cad` or `scan_result_id` shown in item list UI (E.3 fields, not yet)

---

## Out of Scope (Chunk E.2)

- Batch scan (E.3)
- Cost entry (E.3)
- "Save to list" from scan card (E.4)
- ISBN validation
- Sorting / filtering items
- Bulk item delete (select-all)
- Rename list
