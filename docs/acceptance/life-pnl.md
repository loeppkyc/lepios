# Acceptance Doc — Life P&L (gap-fill, multi-phase)

**Source:** `streamlit_app/pages/1_Life_PL.py` (~355 LOC) + `streamlit_app/utils/life_pl.py` (data aggregator)
**LepiOS target:** `app/(cockpit)/life-pnl/page.tsx` + `_components/LifePnlPage.tsx` (already shipped, ~35% parity)
**API:** `app/api/pnl/route.ts` (already shipped)
**Status:** **BLOCKED on Colin's scope decision (Q0). Multi-phase work; one of the 5 docs that can't ship in a single sprint.**

---

## The blocking question

The Streamlit Life P&L is a **personal-finance command center**, not a business view. It pulls from 13 different Google Sheets:

| Source                                   | What it provides                          |
| ---------------------------------------- | ----------------------------------------- |
| `📊 Amazon` + `💰 Payout Register`       | Amazon revenue + COGS                     |
| `📈 Trading Journal`                     | Trading P&L                               |
| `🎰 Bets`                                | Betting P&L                               |
| `🧹 Cleaning Clients`                    | Cleaning revenue (Megan's business)       |
| `📒 Business Transactions`               | Business OpEx + loan repayments           |
| `🏦 Statement Lines` + `📸 Receipts`     | Colin's personal expenses                 |
| Colin Masterfile `Megan Expenses {year}` | Megan's personal expenses + child benefit |
| `⭐ Cora Activities`                     | Cora activities cost                      |
| `🛡️ Insurance Policies`                  | Insurance premiums (normalized)           |
| `🔁 Subscriptions`                       | Subscriptions (normalized)                |
| `⚡ Utility Tracker`                     | Utilities                                 |

Plus a 2026 tax forecast engine (federal/AB brackets, CPP self-employed, BPA credits).

LepiOS Life P&L currently shows **only Amazon revenue + business expenses** — that's why it's at ~35% parity.

**Q0 — what is LepiOS Life P&L meant to be?**

- **Option A — Business P&L only:** drop the "Life" framing; this becomes a renamed "Business P&L" page. Add tax forecast engine + loan repayment split. ~70% parity at full scope; **2-3 weeks of work**.
- **Option B — Personal finance hub (matches Streamlit):** port all 13 source modules first (Trading Journal, Sports Betting, Cleaning, personal expenses, Megan Masterfile, Cora, Insurance, Subscriptions, Utilities), then aggregate. **6-9 weeks of work** (the 4-phase plan from the audit).
- **Option C — Hybrid:** keep "Life" framing, port only the cheap-to-port sources first (Subscriptions, Utilities, Insurance — these are simple CRUD modules), defer Trading/Betting/Megan to later phases. **~3-4 weeks** for usable Phase 1.

This question gates everything else. **No code ships from this doc until Colin picks A/B/C.**

---

## What's already live

| Feature                                                            | Status |
| ------------------------------------------------------------------ | ------ |
| Annual P&L by month: Revenue, COGS, Gross Profit, OpEx, Net Profit | ✅     |
| Year selector (current + 3 prior)                                  | ✅     |
| Expense category rollup with bar chart                             | ✅     |
| Loading/empty states                                               | ✅     |

Data sources currently wired: `amazon_settlements`, `business_expenses`. Nothing else.

---

## Acceptance criteria — Phase 1 (assuming Q0 = Option A or C)

**Phase 1 = unblock the basics regardless of which path Colin picks.** These are P1 items needed in either A or C scope.

### AC1 — Loan repayment classification (P1)

Streamlit splits loan repayments out of OpEx because they're balance-sheet movements, not P&L expenses. LepiOS lumps them in.

**Approach:**

Option A: Add a `expense_kind` enum column to `business_expenses` (`opex` | `cogs` | `loan_principal` | `loan_interest`). Default `opex`. Backfill existing rows by category match (e.g., "BDC Loan", "Tesla Loan" → `loan_principal`; LepiOS doesn't currently track interest separately, defer that).

Option B: Add a `is_loan_repayment` boolean. Simpler, less expressive.

**Pick A.** Migration:

```sql
CREATE TYPE expense_kind AS ENUM ('opex', 'cogs', 'loan_principal', 'loan_interest');
ALTER TABLE business_expenses ADD COLUMN kind expense_kind NOT NULL DEFAULT 'opex';
-- Backfill: set kind based on category
```

Update `/api/pnl` to return `operating_delta = revenue − (expenses where kind ∈ {'opex','cogs'})` separately from `total_delta = revenue − all expenses`.

Show both on the Life P&L page: "Operating P&L" and "Cash P&L (incl. debt repayments)".

### AC2 — Tax forecast engine (P1)

Port Streamlit's `_est_tax()` into `lib/tax/forecast.ts`:

```ts
// Federal brackets (2025/26)
const FED = [(57375, 0.15), (57375, 0.205), (63088, 0.26), (75769, 0.29), (Infinity, 0.33)]
// Alberta brackets
const AB = [(148269, 0.1), (29538, 0.12), (59075, 0.13), (118150, 0.14), (Infinity, 0.15)]
// CPP self-employed: 11.9% on $3,500–$73,200, plus 4% on $73,200–$84,200
// BPA credits: $15,705 × 15% federal, $21,885 × 10% Alberta
```

New endpoint `GET /api/pnl/tax-forecast?year=YYYY` — returns:

```ts
{
  ;(projectedAnnualIncome,
    federalTax,
    albertaTax,
    cpp,
    bpaCredits,
    totalTax,
    quarterlyInstalment,
    monthlySetAside,
    effectiveRate)
}
```

Projection method: YTD operating income ÷ months_elapsed × 12.

UI: collapsible "2026 Tax Forecast" card on Life P&L page (off by default, matching Streamlit). Match Streamlit's bracket-by-bracket display so Colin can audit.

### AC3 — Current month projection (P2)

Streamlit pro-rates the current month: `value × days_elapsed / days_in_month`, except for Business OpEx (actuals only — contains one-time CRA payments) and Loan Repayments (actuals only).

Add a "Current Month Projection" card:

- Recorded so far + projected total + variance vs prior month
- Pro-rate revenue and OpEx-recurring; do not pro-rate one-time entries

This requires tagging recurring vs one-time entries — could leverage existing `recurring_template_id` FK on `business_expenses` (rows linked to a template = recurring; null = one-time).

### AC4 — Monthly trend chart (P3, optional)

Bar chart: revenue vs expenses per month. Line chart: net profit trend. Recharts via shadcn/ui Chart, matching `AmazonDailyChart.tsx` pattern.

---

## Acceptance criteria — Phase 2+ (if Q0 = Option B or C)

These require building source modules first. Each becomes its own acceptance doc:

- `acceptance/personal-expenses-hub.md` — ports Streamlit's `25_Personal_Expenses.py` (Colin + Megan personal spending)
- `acceptance/trading-journal.md` — ports `2_Trading_Journal.py` (so Trading P&L can flow into Life P&L)
- `acceptance/sports-betting.md` — ports `3_Sports_Betting.py`
- `acceptance/cleaning-clients.md` — Megan's cleaning business CRUD
- `acceptance/subscriptions.md` — recurring services tracker
- `acceptance/utilities.md` — utility bill tracker
- `acceptance/insurance.md` — insurance policy tracker

Once the source modules exist, Life P&L Phase 2 aggregates them via a new `other_income` and `personal_expenses` rollup.

---

## Open questions for Colin

- **Q0 (BLOCKING):** A (Business P&L only, ~3 weeks), B (full personal hub, 6-9 weeks), or C (hybrid, ~3-4 weeks for Phase 1)?
- **Q1 (only if Q0 = A or C):** Confirm tax forecast bracket constants are still valid for 2025/26 tax year?
- **Q2:** "Operating delta" exclusion — agree that loan _principal_ is excluded (Streamlit behavior), but loan _interest_ is an operating expense and stays in OpEx? **y / n**
- **Q3:** Megan's child benefit — does it belong in Life P&L (household income) or only in personal hub? **life-pnl / personal-only**

---

## Estimated build time

- **Phase 1 (AC1 + AC2 + AC3):** ~10–15 hours = 2 builder windows
- **Phase 1 + AC4:** ~15–18 hours
- **Phase 2 (Option B/C personal hub):** sized in dependent acceptance docs

---

## What Colin should answer

- Q0: A / B / C — **required before any code ships**
- Q1: confirm 2025/26 brackets? y / n
- Q2: loan principal excluded, interest in OpEx? y / n
- Q3: child benefit location? life-pnl / personal-only
