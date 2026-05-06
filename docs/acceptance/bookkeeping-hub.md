# Acceptance Doc — Bookkeeping Hub (gap-fill)

**Source:** `streamlit_app/pages/8_Bookkeeping_Hub.py` (~687 LOC, P1 Med complexity)
**LepiOS target:** `app/(cockpit)/bookkeeping-hub/page.tsx` + `_components/BookkeepingHubPage.tsx` (already shipped)
**APIs:** `/api/bookkeeping/{summary,history,export}` (already shipped)
**Adjacent (separate concerns):** `/gst-return`, `/bookkeeping/reconcile`, `/bookkeeping/qb-export`
**Status:** **~75% parity after re-framing GST gaps. 3 small gap-fills + 1 question.**

---

## Reframing the GST audit finding

The initial gap audit flagged the GST tracker as severely under-powered (no collected GST estimate, no inventory ITC slider, no net GST owing).

**This is partially false.** LepiOS has a separate `/gst-return` page with full T106/T109 math:

- Line 101 (revenue from settlements bucketed by `period_end_at`)
- Line 105 (GST collected — calculated from settlements, with ~9% blended effective rate from filed 2024-05→2025-04 return)
- Line 106 (ITCs from `business_expenses.tax_amount`, excluding `ZERO_GST_CATEGORIES`)
- Line 109 (net tax owing/refundable)
- Quarterly + annual periods

So the Bookkeeping Hub's GST card is **intentionally a snapshot** with the engine on `/gst-return`. That's a reasonable separation.

**Real remaining GST gap:** **Inventory ITC estimation** is missing from both pages. Streamlit has a slider for "taxable COGS %" that estimates additional ITCs from inventory purchases. LepiOS has no equivalent on either page.

---

## What's already live in Bookkeeping Hub

- YTD Summary metrics: Expenses count, Pre-Tax, GST Paid, Business Portion (4 cards)
- **Historical bar chart 2020 → current** (LepiOS extra — Streamlit doesn't have this)
- Month-by-month table (Month, # Exp, Pre-Tax, GST Paid, Business, Missing Receipts) with YTD footer
- Expenses by Category table (sorted by Pre-Tax desc)
- Missing receipts section with red badge + "Show all N" toggle
- CSV export with 3 sections: Full Ledger, Category Summary, GST Summary

---

## Real gaps (post-reframe)

| Streamlit feature                                     | LepiOS status                            | Severity          | Decision                                                                                 |
| ----------------------------------------------------- | ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Monthly P&L CSV section in export                     | Missing                                  | **P1 — gap-fill** | Accountants need month-by-month revenue vs expenses for T2125.                           |
| Missing receipts month filter                         | Missing                                  | **P2 — gap-fill** | LepiOS shows all missing at once. Adding a filter is ~10 LOC.                            |
| Missing receipts CSV download                         | Missing                                  | **P2 — gap-fill** | Currently filtered missing receipts must be visually scanned.                            |
| Notes field in missing receipts UI                    | Missing (in API but not rendered)        | **P3 — trivial**  | Add column to render. ~5 LOC.                                                            |
| Inventory ITC estimation (slider)                     | Missing on both BK-Hub and `/gst-return` | **P2**            | Decide: where does this live? See Q1.                                                    |
| Sync Bank Statements (PDF → Claude → Statement Lines) | Out of scope                             | **DEFER**         | This is the `/bookkeeping/reconcile` concern; Streamlit conflates them. Don't port here. |
| YTD Revenue metric on Dashboard                       | Missing                                  | **P3 — optional** | Could pull from `amazon_settlements` to show total income alongside expenses.            |
| Combined "all reports" CSV                            | Already covered                          | **WONTFIX**       | LepiOS export already has 3 sections in 1 CSV.                                           |

LepiOS extras (kept):

- Historical bar chart 2020+
- Business portion column (`business_use_pct`)
- More detailed category ledger table

---

## Acceptance criteria

### AC1 — Monthly P&L section in CSV export (P1)

Update `app/api/bookkeeping/export/route.ts` to add a 4th section:

```
MONTHLY P&L SUMMARY
Month,Revenue,Expenses,Net Profit
2026-01,$X.XX,$Y.YY,$Z.ZZ
...
TOTAL,...
```

- **Revenue per month:** sum of `amazon_settlements.net_payout` where `period_end_at` falls in that month
- **Expenses per month:** sum of `business_expenses.pretax` where `date` falls in that month
- **Net Profit:** Revenue − Expenses

### AC2 — Missing receipts: month filter + CSV download (P2)

In `BookkeepingHubPage.tsx` Missing Receipts section:

- Add a month dropdown ("All months", "Jan", ..., "Dec") — filter client-side from existing `missingReceiptExpenses[]`
- Add "Download list" button → CSV with columns: Date, Vendor, Category, Pre-Tax, GST, Total, Payment Method, Notes
- Notes column added to UI table (data already in API response, just not rendered)

### AC3 — Inventory ITC estimation (P2, conditional on Q1)

**Q1 — where does this live?**

- **Option A:** On `/gst-return` (more natural — it's a tax calculation)
- **Option B:** On Bookkeeping Hub (matches Streamlit placement)

If A (recommended):

- Add input on `/gst-return`: "Taxable COGS %" (slider, default 0)
- Source COGS from existing `cogs_per_asin_view` × period units sold from `orders` table; or simpler: use `business_expenses` rows where category contains "Inventory" as the COGS proxy
- Compute additional ITCs = COGS × taxable_pct × 0.05
- Display as a separate line on the GST return: "Estimated inventory ITCs (informational, requires accountant review)"
- Don't include in final Line 106 — keep advisory only

### AC4 — YTD Revenue metric (P3, optional)

Add a 5th KPI card to BookkeepingHubPage YTD strip: "Revenue (settlements)". Pulls from `amazon_settlements`. Same year filter as expenses.

---

## Open questions for Colin

- **Q1 (drives AC3):** Inventory ITC estimation on `/gst-return` (Option A, recommended) or on Bookkeeping Hub (Option B, matches Streamlit)?
- **Q2:** Ship AC4 (YTD Revenue metric) in this PR? **y / n** (default: skip)
- **Q3:** Sync Bank Statements feature — keep deferred to `/bookkeeping/reconcile`, or want a separate acceptance doc for it? **defer / new doc**

---

## Estimated build time

- AC1 (Monthly P&L CSV): **~1.5h**
- AC2 (Missing receipts filter + CSV): **~1h**
- AC3 (Inventory ITC, Option A on `/gst-return`): **~2h**
- AC4 (YTD Revenue, optional): **~30 min**

**Total if all four:** ~5 hours. AC1+AC2 alone: ~2.5h.

---

## What Colin should answer

- Q1: A / B
- Q2: y / n
- Q3: defer / new doc
