# Sprint 3 — Chunk D Acceptance Criteria

> Buyback pricing: third exit option alongside Amazon FBA and eBay.
> On-demand at scan time — no extra API calls, just arithmetic.

---

## Why This Chunk Exists

The result card shows Amazon FBA profit and eBay listing comps. For books that fail
the Amazon FBA gate (profit < $3 or ROI < 50%), there is currently no alternative
exit signal. Buyback programs (e.g. Abebooks, ThriftBooks buylist, local resellers)
offer a fixed price per book — instant, certain, zero platform fees. A book that
fails FBA but clears $1.50 buyback on $0.25 cost is a viable pick if you have a
buyback outlet. This chunk surfaces that signal.

---

## Streamlit Baseline Note (§8.4 Check-Before-Build)

**`utils/sourcing.py`** — `calculate_all_profits()`:
```python
if settings["buyback_enabled"]:
    bp     = settings["buyback_price_per_book"]   # configurable, default $2.00
    profit = round(bp - cost, 2)
    results["Buyback"] = {
        "sale_price": bp,
        "fees":       0,           # no platform fees
        "cost":       cost,
        "profit":     profit,
        "margin":     round((profit / bp) * 100, 1) if bp > 0 else 0,
        "company":    settings["buyback_company"],
    }
```

**`pages/21_PageProfit.py`** scan headers: `"Buyback Price", "Buyback Profit"`.

**LepiOS differences from Streamlit:**
- Buyback price comes from env vars (`BUYBACK_PRICE_PER_BOOK`, `BUYBACK_COMPANY`),
  not a settings sheet. SPRINT5-GATE: migrate to per-user settings when multi-user
  auth lands (ARCHITECTURE.md §7.3).
- Buyback does NOT affect the buy/skip gate. Amazon FBA profit is still the sole gate.
  Consistent with eBay treatment (reference only). Streamlit allows buyback to flip
  the gate via `best_marketplace()`; LepiOS defers this until we have enough real
  scans to validate whether buyback flipping is reliable.

---

## Decision Gate: Reference Only

The existing buy/skip logic (`profit >= 3 AND roi >= 50`) is unchanged.
Buyback profit is displayed as a reference exit option — not an input to the gate.

**Rationale:** Buyback availability is operator-dependent (Colin may or may not have
an active buyback relationship). Putting it in the gate before it's validated against
real usage would produce misleading BUY signals.

---

## Config

```
BUYBACK_PRICE_PER_BOOK=2.00     # CAD, float — omit or set to 0 to disable
BUYBACK_COMPANY=                # optional display name, e.g. "AbeBooks"
```

When `BUYBACK_PRICE_PER_BOOK` is unset or `<= 0`: buyback is disabled, no row shown,
no columns written to `scan_results`.

---

## Calculation

```
buyback_profit = BUYBACK_PRICE_PER_BOOK - cost_paid
```

No fees. No shipping. Buyback price is what the company pays; cost is what Colin paid.
Same formula as Streamlit.

---

## API Change — `/api/scan` response

New field on the scan response (alongside existing `keepa`, `ebay`):

```json
"buyback": {
  "pricePerBook": 2.00,
  "profitCad": 1.75,
  "source": "BookScouter"
}
```

`null` when `BUYBACK_PRICE_PER_BOOK` is unset or 0. `profitCad` may be negative
(shown in the UI in critical colour — still useful to know you'd lose money).

---

## Database Schema Change — migration 0009

```sql
-- 0009_add_buyback_fields_to_scan_results.sql
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS buyback_price_cad  NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS buyback_profit_cad NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS buyback_source     TEXT;
  -- e.g. 'BookScouter', 'Ziffit', 'WeBuyBooks' — populated from BUYBACK_COMPANY env var.
  -- Null when buyback is disabled. Enables vendor-level analytics once multiple
  -- buyback programs are tracked.
```

All three nullable — null when buyback is disabled at scan time.

**`buyback_source` population:** written as the value of `BUYBACK_COMPANY` on every scan
where buyback is active. If `BUYBACK_COMPANY` is unset, writes `null` (not an empty string).

**⚠ Vendor ratification required:** The value of `BUYBACK_COMPANY` is what gets written to
`buyback_source` on every scan row. Before setting the env var in Vercel, confirm which
vendor the price represents (BookScouter, Ziffit, WeBuyBooks, etc.). I don't have this
from context — specify in your approval so I can hardcode the right label in the smoke-test
instructions.

---

## UI — Result Card

Add a "Buyback" row below the eBay row, only when `result.buyback` is non-null:

```
┌─────────────────────────────────────────┐
│ BUYBACK [company name if set]           │
│ $2.00/book · est. profit $1.75          │
└─────────────────────────────────────────┘
```

- Label: `BUYBACK` (or `BUYBACK — {company}` if `BUYBACK_COMPANY` is set)
- Profit colour: `var(--color-positive)` if ≥ $1, `var(--color-text-muted)` otherwise
- Same `cell` / `cellLabel` / `cellValue` style as the eBay row
- If `profitCad` is negative: show in `var(--color-critical)`

---

## Build Sequence

1. `supabase/migrations/0009_add_buyback_fields_to_scan_results.sql`
2. Update `app/api/scan/route.ts` — read env vars, calculate buyback, return in
   response, write to `scan_results`
3. Update `ScannerClient.tsx` — add `buyback` field to `ScanResult` interface,
   render buyback row
4. Unit tests for buyback calc (inline in scan route — no separate module needed
   for `price - cost`)
5. Deploy + smoke test with `BUYBACK_PRICE_PER_BOOK=2.00` set in Vercel env

---

## Pass Conditions

- [ ] When `BUYBACK_PRICE_PER_BOOK` is not set: no buyback row in UI, no buyback
      columns written to `scan_results`
- [ ] When set: buyback row appears in result card with correct price and profit
- [ ] `buyback_profit_cad = BUYBACK_PRICE_PER_BOOK - cost_paid` (verify with
      multiple cost values)
- [ ] Negative buyback profit displays in critical colour
- [ ] Buy/skip decision unchanged — a book that fails FBA gate still shows SKIP even
      if buyback profit is positive
- [ ] `scan_results` row contains `buyback_price_cad`, `buyback_profit_cad`, and `buyback_source`
- [ ] `buyback_source` matches the value of `BUYBACK_COMPANY` env var (not empty string)
- [ ] `npm test` passes

## Fail Conditions (stop and escalate)

- Buyback profit flips buy/skip decision (gate must stay Amazon FBA only)
- Buyback columns written as non-null when `BUYBACK_PRICE_PER_BOOK` is unset
- `buyback_source` written as empty string instead of null when `BUYBACK_COMPANY` is unset

---

## Out of Scope (Chunk D)

- Buyback affecting the buy/skip gate (deferred — needs real-scan validation)
- Per-user buyback settings (SPRINT5-GATE)
- Multiple buyback programs / price tiers
- Buyback company API integration (this is manual/fixed-price only)
- Hit list (Chunk E)
- Batch mode (Chunk F)
