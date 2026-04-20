# Sprint 3 — Chunk E.3 Acceptance Criteria

> Batch scan: scan all pending ISBNs in a hit list at a single cost, results inline.

---

## Design Decisions (locked)

- **Single cost for the batch.** Entered once, applied to every scan. Matches Streamlit. Cost at a pallet is one price.
- **Client-side sequential loop.** Client iterates pending items, calls /api/scan per ISBN. Avoids long-running server jobs; matches SP-API/Keepa rate limits.
- **Failed scans stay 'pending'.** Transient errors (no ASIN, no buy box) leave the item re-tryable. Only successful scans → status='scanned'.
- **Amazon CA profit is the sole buy/skip gate.** Same as /scan. Buyback and eBay are reference only.
- **hit_list_item_id plumbing via /api/scan.** Minimal change: add optional field to scan body; scan route updates hit_list_items after writing to scan_results.

---

## Schema — no new migration needed.

`hit_list_items` already has `status`, `scan_result_id`, `scanned_at`, `cost_paid_cad` from 0010.

---

## API Change — `/api/scan`

Add optional field to the request body schema:

```ts
hit_list_item_id?: string  // UUID — if provided, link scan result back to hit list item
```

After inserting to `scan_results`:
- Change insert to `.select('id').single()` to get the new row's UUID
- If `hit_list_item_id` present: update `hit_list_items` set `status='scanned'`, `scan_result_id=<id>`, `scanned_at=now()`, `cost_paid_cad=cost_paid`
- Add `scanResultId` to the response JSON

No change to validation, buy/skip gate, or response shape for existing callers — fully additive.

---

## UI — `/hit-lists` (extend HitListClient)

### Batch scan trigger

When `pendingCount > 0` in the item panel header, show a button:

```
[Batch scan 3 pending]
```

Clicking expands a cost row inline:

```
Cost paid (CAD): [0.25 input]   [Start scan]   [Cancel]
```

### Scanning state

Replace the cost row with progress while scanning:

```
Scanning 2 of 3…
```

### Results table (appears progressively as each scan completes)

```
┌──────────────────┬──────────────────────┬────────┬──────┐
│ ISBN             │ Title                │ Profit │      │
├──────────────────┼──────────────────────┼────────┼──────┤
│ 9780062316097    │ Sapiens (truncated…) │ $4.12  │ BUY  │
│ 9780385490818    │ On Writing           │ $1.20  │ SKIP │
│ 9780307888037    │ — no listing found   │ —      │ —    │
└──────────────────┴──────────────────────┴────────┴──────┘
```

- Results appear one by one as each scan resolves
- BUY in positive color; SKIP in muted; error row in disabled color
- After all done: items panel refreshes (pending items show 'scanned', failed stay 'pending')
- Summary line: "3 scanned · 1 BUY · 2 SKIP" (excludes errors)

---

## Pass Conditions

- [ ] `hit_list_item_id` in scan body: item row updated (status=scanned, scan_result_id, scanned_at, cost_paid_cad)
- [ ] `hit_list_item_id` absent: scan route unchanged (backward compat)
- [ ] Failed scan (no ASIN): item stays 'pending', error shown in results
- [ ] "Batch scan N pending" button: only shows when pendingCount > 0
- [ ] Cost input defaults to 0.25
- [ ] Progress counter increments after each scan
- [ ] Results appear progressively (not all at end)
- [ ] After batch: item panel refreshes — scanned items show status='scanned'
- [ ] `npm test` passes

## Fail Conditions

- Buyback or eBay flipping buy/skip gate
- `hit_list_item_id` update runs before scan_results insert completes
- Already-scanned items included in the batch (only 'pending' items scanned)

---

## Out of Scope (E.3)

- Per-ISBN cost entry
- Parallel scanning
- Re-scan scanned items
- "Save to list" from scan card (E.4)
- Streaming/SSE progress
