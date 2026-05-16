# E4 — /diet InventoryTab: Three-Bucket Summary

**Tier:** E  
**task_id:** 2a374e67-3b80-4ed2-9e25-2b9a34c1bb21  
**Audited:** 2026-05-16 by coordinator

---

## Audit Findings

The `/diet` InventoryTab **is substantially built** (not starting from zero):

| Component | Status |
|---|---|
| `app/(cockpit)/diet/_components/InventoryTab.tsx` | ✅ Full CRUD UI — add form, expiration alerts, flat table |
| `app/api/diet/inventory/route.ts` | ✅ POST (add item) |
| `app/api/diet/inventory/[id]/route.ts` | ✅ PATCH (status/qty/expires/notes) + DELETE |
| `supabase/migrations/0154_grocery_inventory.sql` | ✅ `grocery_inventory` table live in production |
| `lib/diet/queries.ts` → `fetchDietBundle` | ✅ Loads inventory server-side via App Router |
| `lib/diet/helpers.ts` — `expiringSoon`, `alreadyExpired` | ✅ Pure helpers, tested |
| `lib/diet/types.ts` — `InventoryRow`, `INVENTORY_STATUSES`, `INVENTORY_CATEGORIES` | ✅ Complete |

**What is missing:** the "three-bucket summary."

The current UI shows all inventory items in a single flat table ordered by `purchased_on DESC`. There is no visual grouping or count summary by status. The statuses are `On hand`, `Low`, `Out`, `Expired` (4 values — "Expired" is already surfaced in the expiration alerts section, leaving 3 active buckets).

**Pre-existing F20 note:** The entire diet module uses `style={}` inline attributes. This predates F20 enforcement. Out of scope for this chunk — do not touch.

---

## Scope

Add a three-bucket status summary to the existing `InventoryTab` component.

**Acceptance criterion:** Above the inventory table, a summary bar shows three stat tiles:

```
On hand (N)  |  Low (N)  |  Out (N)
```

Where N is the count of non-Expired items in each status bucket. Items with status `Expired` are excluded from the bucket counts (they already appear in the Expiration Alerts section).

---

## Out of Scope

- Changing the table layout (keep flat table with all items, sorted by purchase date)
- Grouping table rows by status (flat table is sufficient for now)
- Adding inline style cleanup / F20 migration (pre-existing, separate task)
- Any schema change (no migration needed)
- Category-based grouping (a future enhancement)

---

## Files Expected to Change

- `app/(cockpit)/diet/_components/InventoryTab.tsx` — add status count summary bar above the table

No other files.

---

## Check-Before-Build Findings

- `InventoryTab.tsx` exists — **beef up**, do not replace
- Status constants already in `lib/diet/types.ts` — import `INVENTORY_STATUSES`
- No helper needed: `inventory.filter(r => r.status === 'On hand').length` is sufficient inline

---

## External Deps Tested

None. Pure client-side computation from the `inventory` prop already passed to the component.

---

## Grounding Checkpoint

Colin navigates to `/diet` (Inventory tab). Verifies the summary bar shows three tiles with correct counts. DB escape hatch: `SELECT status, COUNT(*) FROM grocery_inventory GROUP BY status ORDER BY status;` and compare counts to UI.

---

## Kill Signals

- Colin looks at the tab and says "the table is enough, don't bother" → close task as-is

---

## Cached-Principle Decisions

- **Architecture Rule 1 (Beef-Up what exists):** InventoryTab is 80% done; adding the summary bar is a direct beef-up. No new file, no new abstraction.
- **Reversibility:** a 5-line UI addition. Revert cost: trivial.

---

## Open Questions

1. Should the summary tiles use the Design Council pill/card style, or simple stat numbers? (Suggesting: match the expiration alert card style — `cardStyle` from `DietCommon.tsx`)
2. Should "Low" items be visually highlighted (yellow/warning color) in the summary tile?
