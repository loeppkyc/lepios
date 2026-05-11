# Sprint 6 — Chunk A: List on Amazon

**Status:** APPROVED — Colin explicit delegation 2026-05-10
**Migration claimed:** 0197
**Branch:** feat/sprint6-chunk-A-list-on-amazon

## Scope

Add a "List on Amazon" inline panel to the scan result card that sends the book to Amazon CA FBA inventory via SP-API ListingsItems v2021-08-01 PUT + PATCH, and records the result in a new `amazon_listings` table.

**Acceptance criterion:** After scanning any book with a BUY decision, pressing "List on Amazon", selecting a condition, confirming the price, and clicking "List Now" results in the book appearing in Amazon Seller Central → Manage Inventory (FBA) within 15 minutes. The `amazon_listings` table gains one row with `sp_api_status = 'ACCEPTED'`.

## Out of scope

- eBay listing creation
- FBA shipment creation (Chunk D)
- AI condition grading
- Batch listing (one at a time only in this chunk)
- Repricing / min-max price automation

## Files expected to change

- NEW: `supabase/migrations/20260510_0197_amazon_listings.sql`
- NEW: `lib/amazon/listings.ts`
- NEW: `app/api/scan/[id]/list/route.ts`
- EDIT: `app/(cockpit)/scan/_components/ScannerClient.tsx`
- EDIT: `.env.example` (add AMAZON_SELLER_ID)

## Check-Before-Build findings

- `lib/amazon/client.ts` has `spFetch(path, {method, params, body})` — handles SigV4 + LWA + retry. PUT and PATCH are supported via `options.method`. Use this, do not write a new HTTP client.
- `lib/amazon/` has no `listings.ts` — create fresh.
- `app/api/scan/[id]/route/route.ts` exists (routing endpoint) — use as pattern for new `list/route.ts` sibling.
- `AMAZON_SELLER_ID` is NOT in `.env.example` — add it. Read `process.env.AMAZON_SELLER_ID` in the new lib. Return 503 `{ error: "AMAZON_SELLER_ID not configured" }` if absent.
- `MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'` is used in `app/api/scan/route.ts` — import or redeclare in listings.ts.
- `ScannerClient.tsx` has `scanResultId: string | null` in the `ScanResult` interface and `result.scanResultId` in the routing handler — use this to call the new API endpoint.

## External deps

- SP-API ListingsItems v2021-08-01 — uses existing `spFetch` (same auth). Endpoint path: `/listings/2021-08-01/items/{sellerId}/{sku}`. Colin's seller account is authorized for Canada (A2EUQ1WTGCTBG2). No new auth required.
- Seller ID reads from `process.env.AMAZON_SELLER_ID`. This env var must be added to Vercel by Colin after deploy — note this clearly in the handoff report's `grounding_checkpoint_required`.

## Migration SQL (0197)

```sql
CREATE TABLE IF NOT EXISTS amazon_listings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SPRINT5-GATE: replace person_handle with profiles FK
  person_handle text NOT NULL DEFAULT 'colin',
  scan_result_id uuid REFERENCES scan_results(id) ON DELETE SET NULL,
  sku text NOT NULL UNIQUE,
  asin text NOT NULL,
  isbn text,
  title text,
  condition_code text NOT NULL CHECK (condition_code IN ('like_new','very_good','used_good','acceptable')),
  condition_note text CHECK (char_length(condition_note) <= 1000),
  list_price_cad numeric(10,2) NOT NULL CHECK (list_price_cad > 0),
  sp_api_status text, -- ACCEPTED | VALID | INVALID | ERROR
  sp_api_issues jsonb,
  listed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_amazon_listings_scan_result ON amazon_listings(scan_result_id);
CREATE INDEX idx_amazon_listings_asin ON amazon_listings(asin);
CREATE INDEX idx_amazon_listings_person ON amazon_listings(person_handle);

GRANT INSERT, UPDATE, DELETE ON amazon_listings TO service_role;
```

## lib/amazon/listings.ts — exact spec

```typescript
const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
const LISTINGS_VERSION = '2021-08-01'

export type ConditionCode = 'like_new' | 'very_good' | 'used_good' | 'acceptable'

export interface ListingResult {
  sku: string
  status: 'ACCEPTED' | 'VALID' | 'INVALID' | 'ERROR'
  issues: unknown[]
}

// generateSku: "BK-" + YYYYMMDDHHMMSS (UTC). Unique per listing.
export function generateSku(): string { ... }

export function sellerConfigured(): boolean {
  return Boolean(process.env.AMAZON_SELLER_ID)
}

export async function createAmazonListing(
  asin: string,
  conditionCode: ConditionCode,
  conditionNote: string,
  listPriceCad: number,
): Promise<ListingResult> { ... }
```

**SP-API PUT body:**
```json
{
  "productType": "PRODUCT",
  "requirements": "LISTING_OFFER_ONLY",
  "attributes": {
    "condition_type": [{"value": "{conditionCode}", "marketplace_id": "A2EUQ1WTGCTBG2"}],
    "condition_note": [{"value": "{conditionNote}", "marketplace_id": "A2EUQ1WTGCTBG2"}],
    "list_price": [{"value": {listPriceCad}, "currency": "CAD", "marketplace_id": "A2EUQ1WTGCTBG2"}],
    "fulfillment_availability": [{"fulfillment_channel_code": "AMAZON_NA", "quantity": 1, "marketplace_id": "A2EUQ1WTGCTBG2"}],
    "purchasable_offer": [{"marketplace_id": "A2EUQ1WTGCTBG2", "our_price": [{"schedule": [{"value_with_tax": {listPriceCad}}]}]}]
  }
}
```

**SP-API PUT URL:** `PUT /listings/${LISTINGS_VERSION}/items/${sellerId}/${sku}?marketplaceIds=${MARKETPLACE_CA}&issueLocale=en_CA`

**SP-API PATCH body** (sent immediately after PUT to ensure price is applied — Amazon sometimes ignores price on initial PUT):
```json
{
  "productType": "PRODUCT",
  "patches": [
    {
      "op": "replace",
      "path": "/attributes/purchasable_offer",
      "value": [{"marketplace_id": "A2EUQ1WTGCTBG2", "our_price": [{"schedule": [{"value_with_tax": {listPriceCad}}]}]}]
    }
  ]
}
```

**SP-API PATCH URL:** `PATCH /listings/${LISTINGS_VERSION}/items/${sellerId}/${sku}?marketplaceIds=${MARKETPLACE_CA}&issueLocale=en_CA`

**Status from PUT response:** read `submissionResponse.status` (ACCEPTED | VALID | INVALID). PATCH result is informational; don't fail the listing if PATCH returns VALID.

If PUT returns INVALID, log `sp_api_issues` from response and return `{ status: 'INVALID', issues }` — the API route writes this to the DB and returns it to the UI.

## API route spec: POST /api/scan/[id]/list/route.ts

```typescript
// Request body schema (zod):
const ListBody = z.object({
  condition_code: z.enum(['like_new', 'very_good', 'used_good', 'acceptable']),
  list_price_cad: z.number().positive().max(9999.99),
  condition_note: z.string().max(1000).optional().default(''),
})

// Route logic:
// 1. Auth check (supabase.auth.getUser)
// 2. Check sellerConfigured() — 503 if not
// 3. Fetch scan_result by id — 404 if not found or person_handle != 'colin'
// 4. Generate SKU via generateSku()
// 5. Call createAmazonListing(asin, conditionCode, conditionNote, listPriceCad)
// 6. Insert into amazon_listings (regardless of sp_api_status — always record what happened)
// 7. Return JSON with { sku, sp_api_status, sp_api_issues, listingId }
// 8. HTTP 201 on ACCEPTED/VALID, 422 on INVALID, 500 on ERROR
```

## ScannerClient.tsx changes

Add listing state machine after the save-to-list block. New state type:
```typescript
type ListState = 'idle' | 'open' | 'submitting' | 'done' | 'error'
```

State vars:
```typescript
const [listState, setListState] = useState<ListState>('idle')
const [listCondition, setListCondition] = useState<ConditionCode>('like_new')
const [listPrice, setListPrice] = useState('') // pre-filled from result.buyBoxPrice
const [listNote, setListNote] = useState('Like New Condition. 100% Satisfaction Guaranteed.')
const [listedSku, setListedSku] = useState<string | null>(null)
const [listError, setListError] = useState<string | null>(null)
```

UI location: After the save-to-list block, before the DebugSection. Shown whenever `result` is set.

**idle state:** "List on Amazon" button (surface-2 background, full-width).
**open state:** Inline form:
- Condition select: Like New / Very Good / Good / Acceptable (mapped to condition codes)
- Price field: number input, pre-filled with `result.buyBoxPrice.toFixed(2)`, label "List Price (CAD)"
- Note textarea: pre-filled with "Like New Condition. 100% Satisfaction Guaranteed." (user can edit, maxLength 1000)
- "List Now" button (gold) + "Cancel" button
**submitting state:** "Listing…" disabled button
**done state:** Green text "Listed as {listedSku} on Amazon CA"
**error state:** Red text showing the error

Reset listing state to 'idle' on each new scan (add to the existing reset block in handleScan).

## Condition label → code mapping (UI display)

| Display | condition_code |
|---------|---------------|
| Like New | like_new |
| Very Good | very_good |
| Good | used_good |
| Acceptable | acceptable |

## Tests

Write `tests/amazon-listings.test.ts`:
- `generateSku()` returns a string matching `/^BK-\d{14}$/`
- `sellerConfigured()` returns false when AMAZON_SELLER_ID is undefined
- Mock `spFetch` and test `createAmazonListing` returns `{ status: 'ACCEPTED', issues: [] }` on successful PUT

## Grounding checkpoint

1. **Colin must add `AMAZON_SELLER_ID` to Vercel env** (can be found in Seller Central → Account Info → Merchant Token, or from any SP-API GetMarketplaceParticipations response). Without this, the "List Now" button returns 503.
2. After adding env var, scan any book (e.g. ISBN 9780307887436), route GO, click "List on Amazon", select condition, confirm price, click "List Now".
3. Verify Seller Central → Manage Inventory shows the book as "Active" (FBA) within 15 minutes.
4. Verify `SELECT sku, sp_api_status FROM amazon_listings ORDER BY listed_at DESC LIMIT 1` shows `sp_api_status = 'ACCEPTED'`.

## Kill signals

- SP-API returns 403 or authentication error on PUT → AMAZON_SELLER_ID is wrong or SP-API credentials are stale. Don't adjust, escalate.
- SP-API returns INVALID consistently → product type PRODUCT is not allowed for books on this account; would need to change to BOOKS product type. Escalate.
