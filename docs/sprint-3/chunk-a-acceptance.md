# Sprint 3 — Chunk A Acceptance Criteria

> Amazon CA scan → profit → save. SP-API only. No Keepa, no eBay, no Buyback.

---

## Credential Gate

**Status: PASSED — 2026-04-18**

SP-API credentials (from Streamlit `secrets.toml`, now written to `lepios/.env.local`) tested live:

- LWA token exchange: ✓
- `GetMarketplaceParticipations` call: ✓ (Amazon.ca confirmed in response)
- Seller ID: `A2MBPL1EOSSBIE`

---

## Acceptance Criterion (one sentence)

Given a valid ISBN (or ASIN) and a cost-paid amount entered on the `/scan` page, the system fetches the Amazon CA used buy-box price and FBA fees via SP-API, calculates profit, displays the result inline, and writes one row to `scan_results` and one event to `agent_events` — all within one page interaction with no manual refresh.

---

## Inputs

| Input              | Type          | Source     | Validation                                    |
| ------------------ | ------------- | ---------- | --------------------------------------------- |
| ISBN-10 or ISBN-13 | text field    | User entry | Must be 10 or 13 digits; strip hyphens/spaces |
| Cost paid (CAD)    | numeric field | User entry | Must be > 0 and ≤ 999.99                      |

ASIN lookup is handled internally (SP-API `searchCatalogItems` by ISBN). Not user-entered.

---

## Process Steps (must succeed for pass)

1. ISBN entered → SP-API call: `searchCatalogItems` → resolve ASIN
2. ASIN → SP-API call: `getCompetitivePricing` → used buy-box price (CAD)
3. ASIN + weight estimate → SP-API call: `getMyFeesEstimate` → FBA fees (CAD)
4. Profit calc: `profit = buy_box_price - fba_fees - cost_paid` (all CAD)
5. ROI calc: `roi_pct = (profit / cost_paid) * 100`
6. Write to `scan_results` (see schema below)
7. Write to `agent_events` (see schema below)
8. Display result card: title, ASIN, buy-box price, fees, profit, ROI, pass/fail vs $3.00 min-profit gate

---

## Outputs

### Displayed on screen (pass condition)

- Book title (from SP-API catalog item)
- ASIN
- Amazon CA used buy-box price (CAD)
- FBA fees (CAD)
- Cost paid (CAD, echoed)
- **Profit (CAD)** — highlighted green if ≥ $3.00, red if < $3.00
- **ROI (%)** — highlighted green if ≥ 50%, red otherwise
- Decision badge: `BUY` / `SKIP` (based on min_profit=$3.00 and max_roi=50% gates from Streamlit baseline `sourcing.py:DEFAULT_SETTINGS`)

### Written to `scan_results`

One row per scan:

```
isbn, asin, title, cost_paid_cad, buy_box_price_cad, fba_fees_cad,
profit_cad, roi_pct, decision, person_handle='colin', recorded_at
```

### Written to `agent_events`

One event per scan:

```
domain='pageprofit', action='scan', actor='user',
status='success'|'error',
input_summary='ISBN: {isbn}, cost: ${cost}',
output_summary='ASIN: {asin}, profit: ${profit}, decision: {decision}',
meta={ isbn, asin, buy_box_price_cad, fba_fees_cad, profit_cad, roi_pct }
```

---

## Pass Conditions

All of the following must be true for Chunk A to be marked done:

- [ ] Entering a real ISBN (e.g., `9780735211292` — Atomic Habits, confirmed on Amazon CA) returns a result within 10 seconds
  - Note: `9780307888037` (The Road, US edition) returns 0 results on Amazon CA — US ISBNs without CA listings are expected to return 404, not a bug
- [ ] Profit calculation matches: `buy_box - fba_fees - cost_paid` (verified manually against Streamlit baseline result for same ISBN)
- [ ] `scan_results` row written to Supabase — verifiable via Supabase table editor
- [ ] `agent_events` row written to Supabase — verifiable via Supabase table editor
- [ ] Invalid ISBN (e.g., `123`) shows a validation error, writes no DB rows
- [ ] SP-API error (e.g., ASIN not found) shows a user-facing error message, writes one `agent_events` row with `status='error'`
- [ ] No Amazon US pricing, no Keepa data, no eBay data shown or fetched
- [ ] `npm test` passes (unit tests for profit calc, ISBN validation)

## Fail Conditions (stop and escalate)

- SP-API returns a 401 or 403 — credential rotation needed before proceeding
- No buy-box price found for a real ISBN with active Amazon CA listings — may indicate marketplace scoping error in SP-API call
- Profit calc result diverges from Streamlit baseline by > $0.10 for same inputs

---

## Out of Scope (explicitly excluded from Chunk A)

- Amazon US pricing (Sprint 3 exclusion — Colin instruction 2026-04-18)
- Keepa BSR / rank (Chunk B)
- eBay comps (Chunk C)
- Buyback pricing (Chunk D)
- Hit list save/manage (Chunk E)
- Batch mode (Chunk F)
- Barcode camera input — ISBN text entry only in Chunk A
- products table lookup/cache — ASIN resolved fresh from SP-API every scan in Chunk A

---

## Minimum Schema (Chunk A only)

> Grounded in: `audits/data-report.md` (products §3.4, agent_events §3.10) and `audits/00-inventory.md` (scan_results §4).
> Full `products` table deferred — Chunk A does not persist a `products` row. Lookup is stateless (ISBN → ASIN → price on every scan). Products table ships in Chunk B or C when caching becomes load-bearing.

### `scan_results`

```sql
CREATE TABLE public.scan_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_handle   TEXT NOT NULL DEFAULT 'colin',
    isbn            TEXT,
    asin            TEXT,
    title           TEXT,
    cost_paid_cad   NUMERIC(10,2) NOT NULL,
    buy_box_price_cad NUMERIC(10,2),
    fba_fees_cad    NUMERIC(10,2),
    profit_cad      NUMERIC(10,2),
    roi_pct         NUMERIC(6,2),
    decision        TEXT CHECK (decision IN ('buy','skip','watch')),
    marketplace     TEXT NOT NULL DEFAULT 'amazon_ca',
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.scan_results (person_handle, recorded_at DESC);
CREATE INDEX ON public.scan_results (asin);

ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_results_authenticated" ON public.scan_results
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

### `agent_events`

```sql
CREATE TABLE public.agent_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    domain          TEXT NOT NULL,
    action          TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    status          TEXT DEFAULT 'success' CHECK (status IN ('success','error','warning')),
    input_summary   TEXT,
    output_summary  TEXT,
    error_message   TEXT,
    duration_ms     INTEGER,
    session_id      TEXT,
    tags            JSONB,
    meta            JSONB
);

CREATE INDEX ON public.agent_events (occurred_at);
CREATE INDEX ON public.agent_events (domain, action);
CREATE INDEX ON public.agent_events (status);

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_events_authenticated" ON public.agent_events
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

> `agent_events` schema grounded in `audits/data-report.md:641–672`. Stripped `tokens_used`, `model`, `confidence` fields as not load-bearing for Chunk A — can be added when Ollama consumption layer activates.

---

## Migration Numbering

Next migration after `0003_add_win_prob_pct_to_bets.sql`:

- `0004_add_scan_results.sql`
- `0005_add_agent_events.sql`

---

## Build Sequence (after Colin approval)

1. Write migrations `0004` and `0005` — apply via `supabase db push` or Supabase MCP
2. Write `lib/amazon/spapi.ts` — LWA token exchange + `searchCatalogItems` + `getCompetitivePricing` + `getMyFeesEstimate`
3. Write `lib/profit/calculator.ts` — `calculateAmazonCaProfit(buyBox, fees, cost)` + decision gates
4. Write `app/api/scan/route.ts` — POST handler: validate → SP-API → calc → write DB → return result
5. Write `app/(cockpit)/scan/page.tsx` — ISBN + cost form, result card display
6. Write unit tests for `lib/profit/calculator.ts`
7. Manual pass/fail verification against acceptance conditions above
