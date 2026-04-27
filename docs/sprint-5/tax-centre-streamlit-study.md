# Phase 1a Study — Tax Centre (6_Tax_Centre.py)

**task_id:** af44ba61-87d6-434e-801a-afef67de3f8c  
**coordinator:** coordinator sub-agent  
**date:** 2026-04-27  
**status:** PARTIAL — Streamlit source not accessible at `../streamlit_app/`; study derived from audit doc + existing LepiOS code only

---

## BLOCKER: Phase 1a Incomplete

The Streamlit source files are not accessible from this environment:
- Expected path: `/home/user/streamlit_app/pages/6_Tax_Centre.py` → **does not exist**
- Expected path: `/home/user/streamlit_app/pages/tax_centre/colin_tax.py` → **does not exist**
- Expected path: `/home/user/streamlit_app/pages/tax_centre/megan_tax.py` → **does not exist**

Phase 1b (Twin Q&A) also blocked: both `http://localhost:3000/api/twin/ask` and `https://lepios-one.vercel.app/api/twin/ask` are unreachable from this environment.

All domain questions must go to Colin.

---

## SCOPE DISCREPANCY — ESCALATION REQUIRED

**Task metadata claims:** 148 lines, complexity = "small"  
**Actual module (from `audits/streamlit-full-inventory.md`):** 8,142 lines across 3 files, complexity = Complex

| File | Lines | Role |
|------|-------|------|
| `pages/6_Tax_Centre.py` | 147 | Router / lazy-loader |
| `pages/tax_centre/colin_tax.py` | 6,922 | Colin's 13 tax sections |
| `pages/tax_centre/megan_tax.py` | 1,073 | Megan's 4 tax sections |
| **Total** | **8,142** | |

The 148-line task metadata refers only to the router file. The router is a navigation shell — it contains no business logic. Porting only the router produces a placeholder with no functionality.

**Decision required from Colin:** What scope are we targeting?

---

## What It Does (Audit-Derived)

Tax Centre is the consolidated Canadian tax hub for Colin and Megan's businesses. It lazy-loads 17 sections from two renderers.

**Colin sections (13):** Tax Checklist, GST Tracker, Tax Filing Prep, Journal Entries, Reconciliation, Tax Reconciliation, Mileage Log, Audit Pro, Accountant Review, Tax Return, Tax Forecast, GST Filing, Data Audit

**Megan sections (4):** Tax Checklist, Business & Expenses, Tax Return, Spousal Tax Optimizer

---

## Data Sources (Audit-Derived)

| Sheet | Used by |
|-------|---------|
| `📒 Business Transactions` | Reconciliation, GST Tracker, Paper Trail |
| `🏦 Statement Lines` | Reconciliation |
| `💰 Payout Register` | Tax Reconciliation |
| `📋 Tax Reconciliation 2025` | Tax Return, Tax Forecast |
| `🇨🇦 GST Annual Summary` | GST Tracker, GST Filing |
| `📋 Megan Business 2025` | Megan sections |
| `📓 QB Journal Log` | Journal Entries |
| `📊 Reconciliation Log` | Reconciliation |
| `📋 Tax Checklist` | Tax Checklist |
| `📊 Amazon 2025/2026` | Tax Reconciliation (revenue figures) |
| `🚗 MileIQ History` | Mileage Log |

**Data destinations:** journal entries, recon logs, sign-offs, checklist items, payout adds — writes across multiple sheets.

**External deps:**
- Anthropic Claude API (tax advice, T2125 filling guidance)
- `utils/data_audit` (8 integrity checks)
- `utils/auto_reconcile`

---

## Domain Rules (Known from Existing LepiOS Code)

From `lib/tax/sanity-check.ts` (already in LepiOS):

| Metric | Baseline | Ratio |
|--------|----------|-------|
| Total sales (2025) | ~$800,000 | — |
| GST net of ITCs | ~$20,000 | 2.50% of sales |
| CPP + income tax | ~$2,100 | 0.2625% of sales |

Drift threshold: 25% from baseline triggers a warning in morning digest.

From `4_Monthly_Expenses.py` audit (GST rates):
- Standard GST: **5%**
- Zero-rated categories: books, bank charges, insurance → **0% GST**

**Tax year in scope:** 2025 (Tax Reconciliation 2025, Amazon 2025 sheets)

---

## Existing LepiOS Tax Infrastructure (Check-Before-Build)

| File | Purpose |
|------|---------|
| `lib/tax/sanity-check.ts` | F18 ratio guard with 3 baselines + 25% drift threshold |
| `lib/harness/tax-sanity.ts` | Reads `tax_sanity_inputs` table → builds morning digest line |
| `tests/tax/sanity-check.test.ts` | Unit tests for sanity check logic |
| `tests/harness/tax-sanity.test.ts` | Unit tests for digest integration |

**No Supabase tax tables exist yet** — `tax_sanity_inputs` is referenced but not yet applied to production (no rows returned from query).

**No LepiOS UI page** for Tax Centre exists yet.

---

## Twin Q&A — blocked (both endpoints unreachable)

Pending questions (for Colin):

1. **"What are the most-used sections of the Tax Centre day-to-day? GST Tracker? Tax Checklist? Which 2-3 sections deliver the most value to Colin right now?"** — [twin: unreachable]
2. **"Is the 2025 tax year in scope, or is this being built for 2026 in-progress taxes?"** — [twin: unreachable]
3. **"Are the F18 baselines still correct: $800K total sales, $20K GST net of ITCs, $2.1K CPP+income tax?"** — [twin: unreachable]
4. **"Does the GST Annual Summary sheet already exist in production Sheets, or does it need to be created?"** — [twin: unreachable]
5. **"What is the T2125 form structure expected — auto-filled from Tax Reconciliation 2025 sheet, or does Colin enter figures manually?"** — [twin: unreachable]

---

## Pending Colin Questions

**SCOPE DECISION (blocking):**

Q1: The task says "148 lines / small complexity" but the actual module is 8,142 lines across 3 files (router + colin_tax.py 6,922 lines + megan_tax.py 1,073 lines), rated **Complex** in the Phase 2 audit. Which scope are we targeting?
  - (a) Navigation stub only — just the routing shell, no sections functional yet
  - (b) Specific high-value sections — which ones? (GST Tracker? Tax Checklist? T2125?)
  - (c) Full module — acknowledged as multi-sprint effort

Q2: Streamlit source files are not accessible at `../streamlit_app/` from the coordinator environment. Should they be made accessible, or should builder proceed from the audit doc + existing LepiOS code only?

Q3: Twin unreachable from coordinator environment. All domain questions escalating to Colin.

**TAX FIGURE GROUNDING (required before Phase 3, per task metadata):**

Q4: Are these F18 baselines still correct for the tax year in scope?
  - Total sales: ~$800,000
  - GST net of ITCs: ~$20,000 (2.50% of sales)
  - CPP + income tax: ~$2,100 (0.2625% of sales)

Q5: What tax year is this module being built for — 2025 filing, 2026 in-progress, or both?

Q6: Is Megan's portion (megan_tax.py, 1,073 lines) in scope for this sprint, or Colin only?
