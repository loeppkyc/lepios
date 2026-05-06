# Acceptance Doc — Monthly Expenses (gap-fill)

**Source:** `streamlit_app/pages/4_Monthly_Expenses.py` (~1039 LOC, P1 Med complexity)
**LepiOS target:** `app/(cockpit)/monthly-expenses/page.tsx` + recurring at `/recurring` (already shipped)
**APIs:** `/api/expenses` + `[id]` + `bulk` + `import` + `recurring/*` (already shipped)
**Status:** **~80% parity. 1 P1 question + small P2/P3 gap-fills.**

---

## What's already live

LepiOS Monthly Expenses is feature-rich and in some dimensions ahead of Streamlit:

- Month selector + add/edit/delete CRUD with inline edit UX
- Sort controls (newest, oldest, vendor A→Z, amount high→low) — same 4 options
- 7-rate Canadian tax dropdown (matches Streamlit), auto-computed tax + total
- 11 payment methods (matches Streamlit)
- Hubdoc flag (boolean column instead of Streamlit's "Y/N" string — cleaner)
- **Explicit `business_use_pct` column** (Streamlit encodes `[bus:N]` in Notes — LepiOS is cleaner)
- Frequency on add: one-time / monthly remainder / annual ÷12 (matches Streamlit)
- **Recurring template UI + idempotent generator** (Streamlit has none — LepiOS is ahead)
- **AI CSV import** via Claude Haiku for bulk statement parsing (Streamlit has none — LepiOS is ahead)
- Bulk endpoint accepting up to 500 rows
- Flash messages, loading + error + empty states

---

## Critical question first — is the Streamlit "P&L sync" a real gap?

The audit flagged Streamlit's `apply_to_amazon()` as a P1 gap: every expense write distributes the monthly total evenly across `📊 Amazon 2026` daily rows and updates Net Profit + Margin %.

**Why this might be a non-gap in LepiOS:**

In Streamlit, `📊 Amazon 2026` IS the P&L source — it's a flat sheet that needs writing into.

In LepiOS, `/api/pnl` and `/api/monthly-pnl` compute live from `business_expenses` + `amazon_settlements` every request. There's no flat sheet to write into. The "sync" is automatic — the next P&L query already reflects the new expense.

**Q1 — Confirm the P&L sync is a non-gap?** y / n

If **yes (non-gap):** drop from acceptance, ship as is.
If **no (still want it):** which artifact needs the materialized daily-distributed expense — a report, a chart, a CSV?

---

## What Streamlit has that LepiOS doesn't

| Streamlit feature                                                                                                          | LepiOS status                    | Severity                | Decision                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| P&L sync to Amazon sheet                                                                                                   | N/A in LepiOS (live computation) | **P1 → likely non-gap** | See Q1 above                                                           |
| Split payment (M1 + M2)                                                                                                    | Missing                          | **P2**                  | Edge case. Workaround: log as 2 expenses. Defer until requested.       |
| AI Expense Advisor (Claude YTD analysis: Quick Win Cuts, Subscriptions to Audit, USD Exposure, Category Ratios, One Thing) | Missing                          | **P3 — gap-fill**       | Useful insights, not blocking. ~3h port.                               |
| Household bills progress bar (Colin + Megan vs $5k target)                                                                 | Missing                          | **DEFER**               | Requires Megan personal expenses → out of scope until Life P&L Phase 2 |
| "Inventory — Other" category                                                                                               | Missing (LepiOS has 26 vs 27)    | **P3 — trivial**        | Add to enum. ~2 lines.                                                 |
| Re-apply to Amazon sheet button                                                                                            | N/A in LepiOS                    | **DROP**                | Tied to P&L sync — same fate as Q1                                     |

LepiOS extras (kept):

- Recurring template CRUD
- AI CSV import
- Explicit `business_use_pct` column
- Bulk import endpoint

---

## Acceptance criteria

**Conditional on Q1 answer.**

### If Q1 = "non-gap" (expected): minimal PR

**AC1 — Add "Inventory — Other" category**
Add to `lib/types/expenses.ts` `CATEGORIES` enum + DB CHECK constraint update if applicable.

**AC2 — AI Expense Advisor (P3, optional in this PR)**

- New route `/api/expenses/advisor?year=YYYY` — server reads YTD expenses, calls Claude Sonnet 4.6 with a structured prompt, returns JSON: `{ quickWinCuts: string[], subscriptionsToAudit: string[], usdExposure: string[], categoryRatios: string, oneThing: string }`
- New collapsible "AI Insights" card on Monthly Expenses page below the table
- Client-side memoization (don't re-call on every render)
- Caches latest call in `business_expenses_advisor_cache` table (key: `(user_id, year)`, value: JSON, generated_at) for 24h
- Tests: API returns valid shape, cache hit + miss paths

**Estimated build time:** ~30 min (AC1 alone) or ~3h (AC1 + AC2).

### If Q1 = "real gap" (unexpected):

Re-scope this doc once Colin describes which surface needs the materialized daily-distributed expense data. Likely a separate `/api/pnl/daily` view or scheduled rollup.

---

## Open questions for Colin

- **Q1 (blocking):** Is the Streamlit `apply_to_amazon()` P&L sync a non-gap given LepiOS computes P&L live? **y / n**
- **Q2:** Ship the AI Expense Advisor in this PR or defer to a separate doc? **ship / defer**
- **Q3:** Split payment support — needed now, or defer indefinitely? **defer / build**

---

## What Colin should answer

- Q1: y / n
- Q2: ship / defer
- Q3: defer / build

If Q1=y, Q2=defer, Q3=defer: this is a 30-minute PR (just the category add).
If Q1=y, Q2=ship, Q3=defer: ~3-hour PR.
