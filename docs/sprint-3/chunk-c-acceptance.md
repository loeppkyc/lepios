# Sprint 3 — Chunk C Acceptance Criteria

> eBay active listing comps. Browse API only. EBAY_CA. Used condition.
> "Sold comps" are not available — the Finding API was sunset Jan 31, 2025.
> Marketplace Insights (sold data) returns 403 — requires special eBay entitlement not in our plan.
> This chunk surfaces active asking prices only. That is the honest data available.

---

## Acceptance Criterion (one sentence)

Given a successful ISBN scan, the system fetches up to 20 used-condition active eBay.ca listings via the Browse API (ISBN query first; title keyword fallback if ISBN returns 0), computes median / low / high asking price and listing count, estimates eBay reference profit, displays the result as "eBay CA · N listed · median $X.XX" on the result card, writes three new columns to `scan_results`, and degrades gracefully to "No eBay data" if the Browse API is unconfigured or returns 0 results — without affecting the Amazon buy/skip decision.

---

## API Grounding

**eBay Finding API:** DEAD. Sunset Jan 31, 2025. All endpoints return HTTP 500.
Do not reference or call `svcs.ebay.com/services/search/FindingService/v1` anywhere in this chunk.

**eBay Browse API:** Works. OAuth client-credentials grant using `EBAY_APP_ID` + `EBAY_CERT_ID`.
Token TTL: 7,200s. Cache module-level (same pattern as SP-API LWA in `lib/amazon/client.ts`).
Endpoint: `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
Marketplace header: `X-EBAY-C-MARKETPLACE-ID: EBAY_CA`

**eBay Marketplace Insights (sold comps):** 403 Forbidden. Not accessible. Not attempted in this chunk.

---

## Lookup Strategy

1. **ISBN query** — `q={isbn}&category_ids=267&filter=conditions:{USED}&limit=20`
2. **Title keyword fallback** — fires if ISBN query returns 0 items.
   Query: `q={title_first_60_chars}&category_ids=267&filter=conditions:{USED}&limit=20`
   Logged to `agent_events.meta` as `"ebay_fallback_reason": "isbn_no_results"`.

Category 267 = eBay Books. Condition filter `conditions:{USED}` matches: Like New, Very Good, Good, Acceptable.

---

## Decision Gate Rule

eBay median is **reference only**. It does NOT influence the buy/skip decision.

The buy/skip gate stays anchored exclusively on Amazon CA profit/ROI from Chunk A:

```
// eBay median is active listing prices (asking prices), not sold comps.
// Not used as a buy/skip gate until we have real sell-through data to validate the signal.
```

This comment must appear adjacent to the decision logic in `app/api/scan/route.ts`.

---

## UI Label Rule

The result card must make "listing" vs "sold" unambiguous at all times. Required format:

```
eBay CA · {N} listed · median ${X.XX}
```

Examples:

- `eBay CA · 20 listed · median $16.20`
- `eBay CA · 3 listed · median $8.50`
- `eBay CA · No data`

**Never** render any of the following — they imply sold data we do not have:

- "eBay $16.20"
- "eBay comp"
- "eBay sold"
- "eBay avg"

The word "listed" or "listings" or "asking" must be visible in the label.

---

## Fee Calculation (ported from Streamlit `utils/ebay.py`)

```
// Assumes $5 shipping charged to buyer = $5 shipping cost to seller (breakeven on shipping).
// FVF applies to total incl. shipping per eBay managed payments.
final_value_fee = (median_listing_price + 5.00) * 0.1325   // 13.25% FVF for books, Canada managed payments
per_order_fee   = 0.30
total_fees      = final_value_fee + per_order_fee

ebay_profit = median_listing_price - total_fees - 5.00 - cost_paid
```

Shipping assumption: `$5.00` charged to buyer, `$5.00` cost to seller — breakeven on shipping.
FVF base is `item_price + $5.00` (eBay takes 13.25% of the full amount the buyer pays, including shipping).

**Why not $0.00:** Setting shipping_charged to 0 lowers the FVF base, lowers total fees, and inflates estimated eBay profit. That is optimistic, not conservative. Use $5.00 on both sides.

---

## Build Sequence

1. `supabase/migrations/0007_add_ebay_fields_to_scan_results.sql`
2. `lib/ebay/client.ts` — OAuth token exchange + module-level cache + `ebayFetch()`
3. `lib/ebay/listings.ts` — `getEbayListings(isbn, titleFallback?)` → typed `EbayListings | null`
4. `lib/ebay/fees.ts` — `estimateEbayFees(price)` + `estimateEbayProfit(price, cost)` (pure math, no API)
5. Update `app/api/scan/route.ts` — call `getEbayListings` in parallel with Keepa + FBA fees; add decision-gate comment; write new columns; log fallback to agent_events
6. Update `ScannerClient.tsx` — add eBay comp row with required label format
7. Add `EBAY_APP_ID` + `EBAY_CERT_ID` to `.env.local` (copy from Streamlit secrets.toml)
8. Push both vars to Vercel via `printf` (not `echo` — trailing `\n` corrupts OAuth header)
9. Unit tests for `getEbayListings` (mock fetch) + `estimateEbayFees` (pure math)
10. Manual smoke test on live site

---

## New Files

```
lib/ebay/
  client.ts     — OAuth token cache + ebayFetch()
  listings.ts   — getEbayListings() — Browse API search + ISBN/keyword logic
  fees.ts       — estimateEbayFees() + estimateEbayProfit() (no API calls)
```

---

## Database Migration — 0007

```sql
-- Chunk C: eBay active listing comp fields
-- "listing" not "sold" — these are active asking prices via Browse API (Finding API sunset Jan 2025)
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS ebay_listing_median_cad  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ebay_listing_count       INT,
  ADD COLUMN IF NOT EXISTS ebay_profit_cad          NUMERIC(10,2);
```

No new RLS policies needed — existing authenticated policy on `scan_results` covers these columns.

---

## Inputs / Outputs

**`getEbayListings(isbn, titleFallback)` return type:**

```typescript
interface EbayListings {
  medianCad: number
  lowCad: number
  highCad: number
  count: number
  fallbackUsed: boolean // true when title keyword query was used instead of ISBN
}
```

**New scan route response fields** (added to existing Chunk A+B response):

```json
{
  "ebay": {
    "medianCad": 16.2,
    "lowCad": 10.95,
    "highCad": 35.0,
    "count": 20,
    "profit": 7.43,
    "fallbackUsed": false
  }
}
```

`ebay` is `null` when Browse API is unconfigured or returns 0 results.

**New `scan_results` DB fields:**

```
ebay_listing_median_cad: medianCad | null
ebay_listing_count:      count | null
ebay_profit_cad:         estimated eBay profit | null
```

**New `agent_events.meta` fields (added to the existing scan event):**

```json
{
  "keepa_tokens_left": 849,
  "ebay_listing_count": 20,
  "ebay_fallback_reason": "isbn_no_results" // only present when fallback fired
}
```

---

## Rate-Limit Analysis

|                   |                                                |
| ----------------- | ---------------------------------------------- |
| **Daily limit**   | 5,000 calls/day/app (Browse API standard tier) |
| **Per scan**      | 1 call (token cached, 2h TTL)                  |
| **100 scans/day** | 100 calls → 2% of daily quota                  |
| **Risk**          | Negligible at single-user volume               |

---

## Pass Conditions

All of the following must be true:

- [ ] Scanning a real ISBN returns `"eBay CA · N listed · median $X.XX"` on the result card
- [ ] Label never says "sold", "comp", or "avg" — only "listed" / "listings" / "asking"
- [ ] `scan_results` row contains `ebay_listing_median_cad`, `ebay_listing_count`, `ebay_profit_cad`
- [ ] eBay profit does NOT change the buy/skip badge — decision gate is Amazon-only
- [ ] Decision gate comment is present in `route.ts` adjacent to the `getDecision()` call
- [ ] When ISBN query returns 0 results and title fallback fires, `agent_events.meta` contains `"ebay_fallback_reason": "isbn_no_results"`
- [ ] Scan completes normally when `EBAY_APP_ID` is unset (tested by temporarily removing the var) — result card shows "No eBay data", no 500 error
- [ ] Scan completes normally when Browse API returns 0 listings
- [ ] `npm test` passes (unit tests for `getEbayListings` mock + `estimateEbayFees` math)

## Fail Conditions (stop and escalate)

- Browse API returns prices in USD instead of CAD — `X-EBAY-C-MARKETPLACE-ID: EBAY_CA` must be set
- eBay profit influences buy/skip badge in any code path
- Result card renders any variant of "sold" or "comp" as the primary label

---

## Out of Scope (Chunk C)

- eBay Finding API (dead — do not attempt to revive)
- eBay Marketplace Insights / sold comps (403 — requires special entitlement)
- eBay.com US domain
- eBay listing creation / Trading API
- Buyback pricing (Chunk D)
- Hit list / watch decision (Chunk E)
- Batch mode (Chunk F)
- Shipping cost tuning (hardcoded $5.00 in Chunk C)
