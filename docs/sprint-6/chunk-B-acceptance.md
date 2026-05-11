# Sprint 6 — Chunk B: eBay Sold Comps

**Status:** APPROVED — Colin explicit delegation 2026-05-10
**Migration:** none
**Branch:** feat/sprint6-chunk-B-ebay-sold-comps

## Scope

Add eBay sold comps (completed listings) to the scan result — a second eBay row below the existing active listings row, showing how many copies actually sold and at what price. This replaces the "asking price only" limitation and gives a real sell-through signal.

**Acceptance criterion:** After scanning a book, the scan card shows two eBay rows: "eBay CA — active" (existing) and "eBay CA — sold (30d)" (new), with count and average sold price. The sold data comes from the eBay Finding API `findCompletedItems` call.

## Out of scope

- eBay listing creation
- Multi-site eBay (US, UK) — Canada only
- Caching sold comps to DB

## Files expected to change

- NEW: `lib/ebay/finding.ts`
- EDIT: `app/api/scan/route.ts` (add sold comps call in Promise.all)
- EDIT: `app/(cockpit)/scan/_components/ScannerClient.tsx` (add sold row)

## Check-Before-Build findings

- `lib/ebay/client.ts` uses Browse API with OAuth (EBAY_APP_ID + EBAY_CERT_ID). Sold comps require the **Finding API** — completely different endpoint, uses App ID in a query param (no OAuth needed).
- `EBAY_APP_ID` is already in `.env.example`. No new env vars needed.
- `lib/ebay/listings.ts` exists for active listings — do NOT modify this file; add a new `lib/ebay/finding.ts` for sold comps.
- `app/api/scan/route.ts` already calls `getEbayListings` in `Promise.all` — add `getSoldComps` to the same Promise.all block.
- `ScannerClient.tsx` already has an `EbayData` interface and an eBay row — extend both.

## Finding API spec

**Base URL:** `https://svcs.ebay.com/services/search/FindingService/v1`

**Required headers:**
```
X-EBAY-SOA-OPERATION-NAME: findCompletedItems
X-EBAY-SOA-SECURITY-APPNAME: {process.env.EBAY_APP_ID}
X-EBAY-SOA-RESPONSE-DATA-FORMAT: JSON
X-EBAY-SOA-SERVICE-VERSION: 1.13.0
```

**Query params:**
```
keywords={isbn}
categoryId=267               // Books
itemFilter(0).name=SoldItemsOnly
itemFilter(0).value=true
itemFilter(1).name=ListingType
itemFilter(1).value=FixedPrice
itemFilter(2).name=Condition
itemFilter(2).value=Used
outputSelector=SellingStatus
paginationInput.entriesPerPage=20
```

**Fallback:** if ISBN returns 0 results, retry with `keywords={titleFallback.slice(0,60)}`

**Response parse:** `findCompletedItemsResponse[0].searchResult[0].item[0..N]`
Each item: `item.sellingStatus[0].currentPrice[0].__value__` (price as string)

**Return type:**
```typescript
export interface EbaySoldComps {
  avgSoldCad: number
  lowSoldCad: number
  highSoldCad: number
  soldCount: number
  fallbackUsed: boolean
}
```

Return `null` if EBAY_APP_ID not set, API errors, or zero results.

## lib/ebay/finding.ts — exact spec

```typescript
const FINDING_BASE = 'https://svcs.ebay.com/services/search/FindingService/v1'

function findingConfigured(): boolean {
  return Boolean(process.env.EBAY_APP_ID)
}

async function findingFetch(params: Record<string, string>): Promise<unknown> {
  // Build URL with all params as query params
  // Set headers as above
  // Return res.json() or throw on non-200
}

export async function getSoldComps(
  isbn: string,
  titleFallback?: string
): Promise<{ comps: EbaySoldComps | null; fallbackReason: string | null }>
```

## API route changes (app/api/scan/route.ts)

In the `Promise.all` block (Step 3), add `getSoldComps(isbn, catalog.title || undefined)` alongside `getEbayListings`.

Add to the response JSON:
```typescript
ebaySold: soldComps ? {
  avgSoldCad: soldComps.avgSoldCad,
  lowSoldCad: soldComps.lowSoldCad,
  highSoldCad: soldComps.highSoldCad,
  soldCount: soldComps.soldCount,
  fallbackUsed: soldComps.fallbackUsed,
} : null
```

Do NOT add `ebaySold` to the `scan_results` DB insert (no schema change in this chunk).

## ScannerClient.tsx changes

Extend `ScanResult` interface:
```typescript
ebaySold: {
  avgSoldCad: number
  lowSoldCad: number
  highSoldCad: number
  soldCount: number
  fallbackUsed: boolean
} | null
```

Add a second eBay cell below the existing eBay cell:
```
Label: "eBay CA (sold 30d)"
Content: "{soldCount} sold · avg ${avgSoldCad.toFixed(2)}"
Sub-content if soldCount > 0: low–high range
Fallback: "No sold data" in disabled color
```

Label the existing eBay cell as "eBay CA (active)" to distinguish.

## Tests

Write `tests/ebay-finding.test.ts`:
- `getSoldComps` returns `null` when EBAY_APP_ID is undefined
- Mock `fetch` to return a valid Finding API response — verify avg/low/high parsing
- Mock `fetch` to return 0 results — verify fallback trigger

## Grounding checkpoint

After scanning any ISBN (e.g. 9780307887436):
- Scan result card shows two eBay rows: "eBay CA (active)" and "eBay CA (sold 30d)"
- If sold count = 0, the row shows "No sold data" — this is acceptable for low-selling books
- Open devtools → Network → filter `/api/scan` → response body contains `ebaySold` field (even if null)

## Kill signals

- Finding API returns 403 or invalid-app-id → EBAY_APP_ID is wrong. Check env var.
- Finding API rate limit hit consistently → reduce `entriesPerPage` to 10.
