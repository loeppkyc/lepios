# Sprint 3 — Chunk B Acceptance Criteria

> Keepa BSR integration. Adds sales velocity signals to the scan result card.
> SP-API remains authoritative for buy-box price and FBA fees.
> Keepa is enrichment only — scan must succeed even if Keepa is unreachable.

---

## Acceptance Criterion (one sentence)

After a successful ISBN scan, the result card displays a velocity badge (Hot / Warm / Slow / Unknown) derived from Keepa's `rank_drops_30` and `monthly_sold` fields, sourced via a single Keepa `/product?stats=90` call (~1 token); if Keepa fails or returns no data the scan still completes without error and shows "Velocity: Unknown".

---

## New Data Keepa Provides (beyond Chunk A SP-API)

| Field           | Source                   | Description                                               |
| --------------- | ------------------------ | --------------------------------------------------------- |
| `bsr_keepa`     | `stats.current[3]`       | Current BSR from Keepa (fallback if SP-API returned 0)    |
| `avg_rank_90d`  | `stats.avg[3]`           | 90-day average BSR                                        |
| `rank_drops_30` | `stats.salesRankDrops30` | # of BSR rank improvements last 30 days — raw sales proxy |
| `monthly_sold`  | `product.monthlySold`    | Keepa's estimated monthly units sold (-1 = unknown)       |

**What Keepa does NOT add in Chunk B:**

- Full BSR history / chart (deferred)
- Price history (deferred)
- Buy-box pricing (SP-API is authoritative — never override with Keepa)
- US domain comparison (Chunk C)

---

## Token Budget Rule (from Global CLAUDE.md F7)

**Always use `stats=90` only.** Never pass `history=1`, `days`, or `rating` on per-scan calls.
Cost: ~1 token per ASIN. One scan = one Keepa call = ~1 token. Acceptable.

If `KEEPA_API_KEY` is missing or Keepa returns non-200 → log the error, return `keepa: null` in the scan response, show "Velocity: Unknown" on the card. Do not fail the scan.

---

## Velocity Badge Logic

```
// TODO: tune thresholds against real sell-through data (Sprint 3+).
// The 8/4/1 cutoffs are a reasonable start but unverified against Colin's actual sourcing.
rank_drops_30 >= 8  → "Hot"    (green)
rank_drops_30 >= 4  → "Warm"   (yellow/amber)
rank_drops_30 >= 1  → "Slow"   (muted)
rank_drops_30 == 0  → "Slow"   (muted)
monthly_sold > 0 AND rank_drops_30 unknown → use monthly_sold ≥ 30 as "Warm" fallback
no keepa data       → "Unknown" (grey)
```

---

## Build Sequence

1. `supabase/migrations/0006_add_keepa_fields_to_scan_results.sql`
   — add `bsr INT`, `rank_drops_30 INT`, `monthly_sold INT`, `avg_rank_90d INT` columns (nullable)
2. `lib/keepa/client.ts` — `keepaFetch(asin, domain=6)` — raw GET with gzip decompress
3. `lib/keepa/product.ts` — `getKeepaProduct(asin)` → typed `KeepaProduct | null`
4. Update `app/api/scan/route.ts` — call `getKeepaProduct(asin)` in parallel with `getFbaFees`; add fields to DB insert + response
5. Update `ScannerClient.tsx` — show velocity badge in result card
6. Add `KEEPA_API_KEY` to lepios `.env.local` (copy from Streamlit secrets.toml `[keepa].api_key`)
7. Push `KEEPA_API_KEY` to Vercel via `printf "val" | vercel env add KEEPA_API_KEY production`
8. Write unit tests for `getKeepaProduct` (mock HTTP response)
9. Manual smoke test on live site

---

## Inputs / Outputs

**Route change (`app/api/scan/route.ts`):**

New fields in DB insert (`scan_results`):

```
bsr: catalog.bsr || keepaProduct?.bsr || null
rank_drops_30: keepaProduct?.rankDrops30 ?? null
monthly_sold: keepaProduct?.monthlySold ?? null
avg_rank_90d: keepaProduct?.avgRank90d ?? null
```

New fields in JSON response (added alongside existing Chunk A fields):

```json
{
  "keepa": {
    "bsr": 42000,
    "avgRank90d": 55000,
    "rankDrops30": 6,
    "monthlySold": 45,
    "velocityBadge": "Warm"
  }
}
```

`keepa` field is `null` when Keepa is unavailable.

---

## Database Migration

```sql
-- 0006_add_keepa_fields_to_scan_results.sql
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS bsr           INT,
  ADD COLUMN IF NOT EXISTS rank_drops_30 INT,
  ADD COLUMN IF NOT EXISTS monthly_sold  INT,
  ADD COLUMN IF NOT EXISTS avg_rank_90d  INT;
```

No new RLS policies needed — scan_results already has auth policy from 0004.

---

## Pass Conditions

All of the following must be true:

- [ ] Scanning a real book ISBN shows a velocity badge ("Hot", "Warm", "Slow", or "Unknown") on the result card
- [ ] `scan_results` row includes `rank_drops_30`, `monthly_sold` columns populated from Keepa (null if Keepa returned no data)
- [ ] Keepa token cost per scan ≤ 2 (verified by checking `tokensLeft` before and after a scan in Keepa dashboard — should drop by ~1)
- [ ] Scan succeeds normally when `KEEPA_API_KEY` is unset or when Keepa returns a non-200 (tested by temporarily passing a bad key)
- [ ] `npm test` passes (unit tests for `getKeepaProduct` with mocked response)
- [ ] Velocity badge shows "Unknown" (grey) when `keepa: null` in scan response

## Fail Conditions (stop and escalate)

- Keepa call adds > 3 tokens per scan
- Scan fails (500/error) when Keepa is unreachable
- Keepa buy-box or price data overwrites SP-API buy box price in the profit calc

---

## Out of Scope (Chunk B)

- BSR history chart
- Price history from Keepa
- Keepa-sourced pricing overriding SP-API (never)
- US domain Keepa call
- Batch Keepa calls for multiple ASINs (Chunk F)
