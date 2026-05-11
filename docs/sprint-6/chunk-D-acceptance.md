# Sprint 6 — Chunk D: FBA Batch Manager

**Status:** APPROVED — Colin explicit delegation 2026-05-10
**Migration claimed:** 0198
**Branch:** feat/sprint6-chunk-D-fba-batches
**Depends on:** Chunk A (amazon_listings table must exist before this migration applies)

## Scope

Add a Batch Manager — a `/batches` cockpit page where Colin creates named batches (e.g. "May10-GW"), adds scan results to them, and tracks which items are pending → listed → shipped. The "Add to Batch" button appears on the scan card after a listing is created.

**Acceptance criterion:** Colin can (a) create a batch named "Test Batch", (b) after listing a book via Chunk A's "List on Amazon" panel, click "Add to Batch" to add it, (c) navigate to `/batches` and see the batch with the listed item, showing its SKU and status.

## Out of scope

- FBA inbound shipment creation (requires seller approval of SP-API inbound flows — future sprint)
- Label generation (PDF FNSKU labels — future sprint)
- Carrier tracking numbers
- Repricing

## Files expected to change

- NEW: `supabase/migrations/20260510_0198_fba_batches.sql`
- NEW: `app/api/batches/route.ts` (GET list + POST create)
- NEW: `app/api/batches/[id]/route.ts` (GET detail + DELETE)
- NEW: `app/api/batches/[id]/items/route.ts` (POST add item + GET list)
- NEW: `app/(cockpit)/batches/page.tsx`
- NEW: `app/(cockpit)/batches/_components/BatchesClient.tsx`
- NEW: `app/(cockpit)/batches/[id]/page.tsx`
- NEW: `app/(cockpit)/batches/[id]/_components/BatchDetailClient.tsx`
- EDIT: `app/(cockpit)/scan/_components/ScannerClient.tsx` (add "Add to Batch" button)

## Check-Before-Build findings

- `amazon_listings` table created by Chunk A (migration 0197) — this migration MUST run after 0197. The FK `fba_batch_items.amazon_listing_id → amazon_listings.id` is optional (nullable) to allow adding un-listed items too.
- No existing `/batches` route or `fba_batches` table.
- `ScannerClient.tsx` already has `listState` and `listedSku` state (from Chunk A) — "Add to Batch" button appears when `listState === 'done'`.

## Migration SQL (0198)

```sql
-- Must run after 0197 (amazon_listings must exist)
CREATE TABLE IF NOT EXISTS fba_batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SPRINT5-GATE: replace person_handle with profiles FK
  person_handle text NOT NULL DEFAULT 'colin',
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'shipped', 'closed')),
  source text,  -- e.g. 'GoodWill', 'Thrift', 'Estate'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fba_batch_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES fba_batches(id) ON DELETE CASCADE,
  scan_result_id uuid REFERENCES scan_results(id) ON DELETE SET NULL,
  amazon_listing_id uuid REFERENCES amazon_listings(id) ON DELETE SET NULL,
  sku text,  -- copied from amazon_listings.sku at time of add
  asin text NOT NULL,
  isbn text,
  title text,
  condition_code text,
  list_price_cad numeric(10,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'listed', 'shipped')),
  added_at timestamptz DEFAULT now()
);

CREATE INDEX idx_fba_batch_items_batch ON fba_batch_items(batch_id);
CREATE INDEX idx_fba_batches_person ON fba_batches(person_handle);

GRANT INSERT, UPDATE, DELETE ON fba_batches TO service_role;
GRANT INSERT, UPDATE, DELETE ON fba_batch_items TO service_role;
```

## API route specs

### GET /api/batches
Returns array of open batches with item count.
```sql
SELECT b.id, b.name, b.status, b.source, b.created_at,
       COUNT(i.id) as item_count
FROM fba_batches b
LEFT JOIN fba_batch_items i ON i.batch_id = b.id
WHERE b.person_handle = 'colin' AND b.status = 'open'
GROUP BY b.id
ORDER BY b.created_at DESC
```

### POST /api/batches
Body: `{ name: string (1-80 chars), source?: string (optional) }`
Inserts into `fba_batches`. Returns new batch row.

### GET /api/batches/[id]/items
Returns all items in the batch with their status.

### POST /api/batches/[id]/items
Body:
```typescript
{
  scan_result_id?: string  // uuid
  amazon_listing_id?: string  // uuid — from Chunk A's list response
  sku?: string
  asin: string
  isbn?: string
  title?: string
  condition_code?: string
  list_price_cad?: number
}
```
Status defaults to 'listed' if `amazon_listing_id` is provided, 'pending' otherwise.

## ScannerClient.tsx changes

After the "List on Amazon" done state (`listState === 'done'`), add an "Add to Batch" button section:

State:
```typescript
type BatchAddState = 'idle' | 'open' | 'saving' | 'saved'
const [batchAddState, setBatchAddState] = useState<BatchAddState>('idle')
const [batches, setBatches] = useState<{id: string, name: string}[]>([])
const [batchesLoaded, setBatchesLoaded] = useState(false)
const [savedToBatch, setSavedToBatch] = useState<string | null>(null)
const [batchAddError, setBatchAddError] = useState<string | null>(null)
const [listedListingId, setListedListingId] = useState<string | null>(null)  // set when listing succeeds
```

`listedListingId` is set when the listing API returns `{ listingId }` — update `handleListNow` to capture this.

**idle state** (shown when `listState === 'done'`): "Add to Batch" button (surface-2).
**open state**: Dropdown to select existing batch OR "New batch…" option.
**saving state**: "Adding…" disabled.
**saved state**: "Added to {batchName}" in muted green.

Fetch batches from `GET /api/batches` on first open (lazy, like hit-lists pattern).

Reset batchAddState to 'idle' on each new scan.

## BatchesClient spec

Two-panel layout:
- Left: list of open batches (name, item count, created date, source). Clicking a batch navigates to `/batches/{id}`.
- "New Batch" button opens an inline form (name + optional source field).

## BatchDetailClient spec

Shows batch name + status at top. Table of items: SKU, ISBN, title (40 chars), condition, price, status badge. "Back to Batches" link.

## Tests

Write `tests/fba-batches-api.test.ts`:
- POST /api/batches creates a batch (mock Supabase insert)
- POST /api/batches/[id]/items sets status='listed' when amazon_listing_id provided
- POST /api/batches/[id]/items sets status='pending' when no amazon_listing_id

## Grounding checkpoint

1. Navigate to `/batches` — page loads, shows "No open batches" or existing batches.
2. Create a new batch named "Test Batch".
3. Go to `/scan`, scan a book, list it via "List on Amazon", then click "Add to Batch" → select "Test Batch" → confirm "Added to Test Batch".
4. Navigate to `/batches` → click "Test Batch" → see the item with status "listed" and the SKU.
5. `SELECT * FROM fba_batch_items WHERE batch_id = '<test batch id>'` returns 1 row.

## Kill signals

- Migration 0198 fails because `amazon_listings` table doesn't exist → Chunk A must deploy first. If A is not merged, abort D and report blocked.
- FK constraint errors on insert → check column names match migration exactly.
