# Sprint 3 — Chunk E.4 Acceptance Criteria

> Save-from-scan-card: add the scanned ISBN to any existing hit list (or a new one) without re-running the scan.

---

## Design Decisions (locked)

- **Single button on the result card.** "Save to list" appears after a successful scan, regardless of BUY/SKIP decision. User decides what to track.
- **Fetch lists on-demand.** Lists are fetched the first time the save panel opens — not on scanner load. One extra GET per save action, not per page load.
- **Existing POST /api/hit-lists/[id]/items.** No new endpoint. `{ isbns: [isbn] }`. Idempotency already handled by the upsert (adding a duplicate is a no-op).
- **New list inline.** If user picks "New list…", a name input appears. One click creates the list and saves the ISBN in sequence.
- **Item status = 'pending'.** The scan already exists in scan_results; the hit_list_item is a tracking entry for future sourcing decisions. scan_result_id linkage is BACKLOG-8.
- **No re-scan.** The scan result on screen is the signal; saving just records the ISBN.

---

## API — no changes needed

All required endpoints exist:
- `GET /api/hit-lists` — fetch all lists (id, name)
- `POST /api/hit-lists` — create list `{ name }`
- `POST /api/hit-lists/[id]/items` — add `{ isbns: [isbn] }`, idempotent

---

## UI — ScannerClient.tsx only

### After successful scan: "Save to list" button

Appears below the result card. One button:

```
[Save to list]
```

### On click: inline save panel

```
Save to list:
[dropdown: — pick a list —  ▾]    [Cancel]
```

Dropdown options:
- Each existing list by name
- `— New list… —` at the bottom

### On list selected: immediate save

Saves silently, shows confirmation inline:

```
✓ Saved to "Pallet #12"
```

### On "New list…": inline name input

```
New list name: [____________]   [Create & save]   [Cancel]
```

Enter or button → creates list → adds ISBN → shows confirmation.

### Error state

```
Save failed — [error message]
```

---

## Pass Conditions

- [ ] "Save to list" button appears after any successful scan
- [ ] Lists load on panel open (not on page load)
- [ ] Selecting existing list: ISBN saved, "Saved to X" shown
- [ ] "New list…": creates list, saves ISBN, shows confirmation
- [ ] Duplicate save (ISBN already in list): succeeds silently (upsert is idempotent)
- [ ] Cancel returns to idle state
- [ ] `npm test` passes

## Fail Conditions

- Re-running the scan on save
- Creating a new list endpoint or modifying existing API routes
- Loading all lists on scanner mount (must be lazy)

---

## Out of Scope (E.4)

- scan_result_id linkage on save (BACKLOG-8)
- Per-item scan data in the hit list view (BACKLOG-8)
- Confirmation before overwriting a duplicate
