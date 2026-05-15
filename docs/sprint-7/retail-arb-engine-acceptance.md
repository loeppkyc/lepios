# Acceptance Doc — Retail Arb Engine Tab
**Task ID:** 3a13fc07-2db6-4d0e-a245-4397a5c0978c  
**Sprint:** 7 (task-queue autonomous pickup)  
**Chunk:** arb-engine  
**Written:** 2026-05-15  
**Status:** awaiting-colin-approval

---

## Scope

Add an "Arb Engine" tab to `RetailHQPage` that takes retail deals (manual entry or imported from the Deals tab), looks up each on Amazon CA, calculates profit and ROI, and ranks results by a composite score (ROI × Keepa velocity).

**Acceptance criterion:** Colin can enter a list of retail deals (name + retail price, with optional UPC), click "Run Scan", and receive a ranked table of results with profit, ROI, Keepa velocity badge, and BUY/SKIP decision — all within 30 seconds for a batch of ≤20 items.

---

## Out of scope

- Purchase History tab (separate S chunk)
- Dashboard store cards grid (separate S chunk)
- Price URL auto-monitor (separate M chunk)
- Telegram arb scan integration (future — requires harness wiring)
- `retail_arb_scans` DB table / scan history persistence (v2 — use agent_events for F18 metrics only in v1)
- Multi-marketplace (eBay arb) — Amazon CA only in v1

---

## Files expected to change

| File | Change |
|---|---|
| `lib/amazon/pricing.ts` | Add `getNewBuyBox(asin)` — new condition buy box (analogous to `getUsedBuyBox`) |
| `lib/amazon/catalog.ts` | Add `findAsinByKeywords(query: string)` — generic keyword search; add `findAsinByUpc(upc: string)` — EAN identifier lookup |
| `lib/amazon/fees.ts` | Add optional `options?: { bookMode?: boolean }` param to `getFbaFees()` — passes `false` from arb engine to bypass book correction |
| `app/api/retail/arb-scan/route.ts` | New POST route — batch arb scan |
| `app/(cockpit)/retail-hq/_components/ArbEngineTab.tsx` | New component — arb engine UI |
| `app/(cockpit)/retail-hq/_components/RetailHQPage.tsx` | Add "Arb Engine" `TabsTrigger` + `TabsContent` |

**No schema migration.** No new Supabase tables for v1.

---

## Check-Before-Build findings

| What | Exists? | Action |
|---|---|---|
| `getUsedBuyBox()` | ✓ `lib/amazon/pricing.ts:19` | Mirror for new condition — 5 lines |
| `getFbaFees()` | ✓ `lib/amazon/fees.ts:18` | Add `bookMode` flag — 3 lines change |
| `calcProfit()`, `calcRoi()`, `getDecision()` | ✓ `lib/profit/calculator.ts` | Reuse as-is |
| `getKeepaProduct()` | ✓ `lib/keepa/product.ts` | Reuse as-is |
| `spFetch()` | ✓ `lib/amazon/client.ts` | Reuse as-is |
| `findAsin()` (ISBN-only) | ✓ `lib/amazon/catalog.ts:15` | Mirror for UPC + keyword — ~20 lines each |
| Arb Engine API route | ✗ | Build new `app/api/retail/arb-scan/route.ts` |
| ArbEngineTab component | ✗ | Build new component |

GitHub prior art: SP-API catalog search by identifiers is documented. No open-source TypeScript arb engine libraries. **Verdict: Build-new** for the UI + API route; **Beef-Up** existing Amazon lib functions.

---

## External deps tested

| Dep | Status | Notes |
|---|---|---|
| `GET /api/keepa/deals` | ✓ Live | Uses `KEEPA_API_KEY` env var |
| SP-API `spApiConfigured()` | ✓ Live | Used in PageProfit — same credentials |
| SP-API `/catalog/2022-04-01/items` | ✓ Live | Used in `findAsin()` today |
| SP-API `/products/pricing/v0/competitivePrice` | ✓ Live | Used in `getUsedBuyBox()` today |
| SP-API `/products/fees/v0/items/{asin}/feesEstimate` | ✓ Live | Used in `getFbaFees()` today |
| Keepa product API | ✓ Live | Used in `getKeepaProduct()` today |

No new external deps required.

---

## API route spec: `POST /api/retail/arb-scan`

**Auth:** Session user (Supabase auth — same as all cockpit routes)

**Request body:**
```typescript
{
  items: Array<{
    name: string        // product name (required)
    retail_price: number  // CAD retail cost (required)
    upc?: string        // UPC/barcode (optional; improves ASIN match precision)
  }>
  // Optional scan settings (falls back to scanner_settings row for colin, then defaults)
  min_roi_pct?: number  // default: 15 (retail arb, not 50 like books)
  min_profit_cad?: number  // default: 3.00
}
```

**Processing (per item, all items in parallel via Promise.allSettled):**
1. ASIN lookup: if `upc` provided → `findAsinByUpc(upc)`; else → `findAsinByKeywords(name)` 
2. If no ASIN: return `{ status: 'no_match', ...input }`
3. In parallel: `getNewBuyBox(asin)` + `getFbaFees(asin, estimatedPrice, { bookMode: false })` + `getKeepaProduct(asin)`
4. If no new buy box: return `{ status: 'no_new_listing', asin, ...input }`
5. Calculate: `profit = calcProfit(buyBox, fees, retailPrice)`, `roi = calcRoi(profit, retailPrice)`
6. Score: `score = roi * velocityMultiplier` where `velocityMultiplier = Math.min(2, 1 + (keepa?.rankDrops30 ?? 0) / 50)`
7. Decision: `getDecision(profit, roi, keepa?.bsr, scanSettings)` but with min_roi_pct=15 default
8. Return per-item result + log to agent_events

**Response:**
```typescript
{
  results: Array<{
    name: string
    retail_price: number
    upc?: string
    status: 'buy' | 'skip' | 'no_match' | 'no_new_listing'
    asin?: string
    title?: string
    imageUrl?: string
    buy_box_new?: number   // Amazon CA new buy box price (CAD)
    fba_fees?: number
    profit?: number
    roi_pct?: number
    score?: number
    bsr?: number
    keepa?: { rankDrops30: number; monthlySold: number; velocityBadge: string } | null
  }>
  scanned_at: string   // ISO timestamp
  duration_ms: number
}
```

**F18 metrics logged to agent_events:**
```
domain: 'retail'
action: 'arb_scan'
meta: { batch_size, matched_count, buy_count, avg_roi_pct, duration_ms, items_with_upc }
```

---

## Component spec: `ArbEngineTab`

**State:**
- `items: Array<{ name: string; retail_price: string; upc: string }>` — input rows
- `results: ArbScanResult[] | null`
- `loading: boolean`
- `error: string | null`

**UI layout:**
1. Input section: table of rows (name, retail price, UPC). "Add row" button. "Import from Deals" button (populates from current Flipp deals in parent state — passed as prop).
2. "Run Arb Scan" button (disabled while loading, requires SP-API configured)
3. Results section: sorted by `score` descending, showing:
   - Color-coded BUY (green) / SKIP (red) badge
   - Product name + ASIN link
   - Retail price | Buy box | Fees | Profit | ROI | Score
   - Keepa velocity badge (from `getKeepaProduct` result)
   - Status badge for `no_match` / `no_new_listing`

**Design Council compliance (F20):**
- Use `shadcn/ui` `Table`, `Badge`, `Button`, `Input` components
- No inline `style={}` attributes
- LepiOS CSS vars for colors: `var(--color-pillar-money)` for profit, standard green/red classes
- No ad-hoc CSS files

---

## Grounding checkpoint

After build, Colin runs:
1. Enter 3–5 real Flipp deals with known retail prices into the Arb Engine tab
2. Click "Run Scan"
3. Verify: results appear within 30s, profit/ROI figures are plausible (non-zero, non-negative for known good deals)
4. Verify: at least one item shows a valid ASIN and Amazon CA buy box price
5. Check agent_events: `SELECT meta FROM agent_events WHERE action='arb_scan' ORDER BY occurred_at DESC LIMIT 1` — expect `batch_size > 0`, `matched_count >= 1`

Note: SP-API must be configured (`SP_API_CLIENT_ID`, `SP_API_CLIENT_SECRET`, `SP_API_REFRESH_TOKEN` in Vercel env). If not configured, route returns 503 with `{ error: 'SP-API credentials not configured' }` — this is the correct fail-open behaviour (same as PageProfit scan).

---

## Kill signals

- SP-API keyword search returns too many false-positive ASINs (wrong products) → escalate; may need UPC-only mode
- `getNewBuyBox()` returns null for >80% of items (product has no new Amazon listing) → scope is wrong, retail arb not viable here
- FBA fees behave incorrectly for non-book categories → fix the `bookMode` flag scope

---

## Cached-principle decisions

None auto-proceeded. This doc goes to Colin for explicit approval (task is XL, new terrain for non-book SP-API usage pattern).

---

## Open questions

1. **ROI threshold:** Suggesting 15% minimum for retail arb (vs 50% for books). Confirm or override?
2. **Persistence:** v1 uses agent_events only. Should scan results also write to a `retail_arb_scans` table for history? (Would need migration — recommend deferring to v2 with Purchase History tab)
3. **"Import from Deals" scope:** Should the Arb Engine's "Import from Deals" button pre-populate from Flipp deals already shown in the Deals tab? Or is a separate input-only form preferred?

---

## F17 — Behavioral ingestion justification

The Arb Engine is a decision-support module. Each scan result (buy/skip decision + outcome) is a candidate signal for the path-probability engine: "Colin was shown deal X with ROI Y — did he buy? what was the actual outcome?" The `agent_events` log captures the scan context; a future purchase-history tab captures the outcome. Together they form a closed loop for deal quality prediction.

## F18 — Measurement + benchmark

| Metric | Captured in | Benchmark |
|---|---|---|
| Scan batch size | `agent_events.meta.batch_size` | — |
| ASIN match rate | `agent_events.meta.matched_count / batch_size` | > 80% (below = keyword search too noisy) |
| Buy rate | `agent_events.meta.buy_count / matched_count` | Calibrate over first 10 scans |
| Average ROI (matched items) | `agent_events.meta.avg_roi_pct` | > 15% = viable deal flow |
| Scan latency | `agent_events.meta.duration_ms` | < 30,000ms for 20 items |
| Surfacing path | `/retail-hq` Arb Engine tab results | Colin can query: "last arb scan hit rate" via agent_events |

---

## F24 — Migration GRANT requirement

No migration. No new tables. Not applicable.
