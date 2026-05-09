# Receipts Feature — Acceptance Doc

**Sprint:** receipts-port  
**Branch:** feat/receipts-port  
**Migration:** 0169_receipts_v2.sql  
**Study doc:** `docs/sprint-receipts/receipts-study.md`  
**Date:** 2026-05-09

---

## Scope

**One sentence:** Ship a complete, F20-compliant, F22-compliant Receipts page in LepiOS that ports the core Streamlit receipt capture, OCR, list, and matching workflow.

This sprint fixes all outstanding gaps identified in the Check-Before-Build audit:

1. Fix auth on all receipt API routes (F22 compliance)
2. Rewrite ReceiptsPage.tsx with Tailwind-only styling (F20 compliance)
3. Fix the `receipt_date` vs `upload_date` query bug
4. Add monthly spend summary strip (total spend, GST ITCs, match %)
5. Add Bookkeeper month view (accordion per month with Drive links + category breakdown)
6. Add `ocr_source` and `vendor_key` columns to `receipts` table (migration 0169)

---

## Acceptance criteria

**AC-1 (Auth — F22):** Every route under `app/api/receipts/**` uses `requireUser()` or `requireCronSecret()`. No bare `auth.getUser()` checks. Test: run `grep -r "auth.getUser" app/api/receipts/` returns zero results.

**AC-2 (Tailwind — F20):** `ReceiptsPage.tsx` and all sub-components contain zero `style={}` attributes. Test: `grep -c "style=" app/(cockpit)/receipts/_components/ReceiptsPage.tsx` returns 0.

**AC-3 (receipt_date query):** GET `/api/receipts?month=2025-12` returns receipts where `receipt_date` is in December 2025, falling back to `upload_date` only when `receipt_date` is null. Test: insert a receipt with receipt_date=2025-12-31 and upload_date=2026-01-02; it must appear in the December query, not January.

**AC-4 (Upload + OCR):** Upload a JPEG receipt → Claude Haiku extracts vendor/date/pretax/tax → form pre-fills → Save → receipt appears in month list. Test: manual smoke test with a real receipt photo.

**AC-5 (Match):** From the receipts list, click Link → select a business expense from the dropdown → click Link → receipt shows "Matched" status and the expense `hubdoc=true`. Test: verify via Supabase query.

**AC-6 (Delete):** Delete button removes the receipt row and deletes the storage file. Test: confirm receipt no longer appears in list and storage path is cleaned up.

**AC-7 (Monthly summary strip):** At the top of the receipts list for the selected month, show: total spend ($), total GST ITCs ($), matched count, unmatched count. Test: data must match a manual SQL count query.

**AC-8 (Migration applied):** Migration 0169 adds `ocr_source TEXT DEFAULT 'manual'` and `vendor_key TEXT DEFAULT ''` columns to `receipts` table. Test: `SELECT column_name FROM information_schema.columns WHERE table_name='receipts'` includes both columns.

---

## Out of scope

- Email import (Gmail scan) — requires `gmail_invoice_sync.py` subprocess, not portable to serverless. Defer to v1.1.
- Hubdoc archive tab — reads from Dropbox `/Hubdoc`. Different storage backend. Defer.
- Statement reconciliation view — valuable but a separate feature (requires `business_expenses` join + color-coded UI). Defer to sprint after this.
- Personal expense categories (Personal — Groceries etc.) — LepiOS is business-focused. Defer to v1.1.
- Vendor memory system (learned vendor → category) — useful but requires a separate `vendor_rules` table. Defer to v1.1.
- Batch upload — single-receipt upload is the MVP path. Defer.
- PDF support — only JPEG/PNG/WebP OCR for v1. PDF deferred.

---

## Files expected to change

```
supabase/migrations/0169_receipts_v2.sql           (new — add ocr_source + vendor_key columns)
.claude/migration-claims.json                        (claim 0169)
app/(cockpit)/receipts/_components/ReceiptsPage.tsx  (rewrite with Tailwind, add summary strip + bookkeeper view)
app/api/receipts/route.ts                            (add requireUser to GET, fix receipt_date query)
app/api/receipts/[id]/route.ts                       (replace raw auth check with requireUser)
app/api/receipts/[id]/match/route.ts                 (replace raw auth check with requireUser)
docs/sprint-receipts/receipts-study.md               (already written)
docs/sprint-receipts/receipts-acceptance.md          (this file)
```

---

## Check-Before-Build findings

**Exists and correct:**

- `receipts` table (migration 0103) — schema matches types, RLS enabled, storage bucket created. Applied to prod.
- `business_expenses` table (migration 0102) — FK relationship intact.
- `lib/types/receipts.ts` — Receipt, OcrResult, MatchStatus types complete.
- `app/api/receipts/scan/route.ts` — already uses `requireUser({ minRole: 'business' })`.
- `app/(cockpit)/receipts/page.tsx` — shell page wires to ReceiptsPage.
- Receipts in sidebar navigation (CockpitSidebar.tsx line 79).

**Exists but wrong:**

- `app/api/receipts/route.ts` GET — filters by `upload_date` not `receipt_date`. Also missing requireUser.
- `app/api/receipts/[id]/route.ts` — uses raw `auth.getUser()` instead of `requireUser()`.
- `app/api/receipts/[id]/match/route.ts` — uses raw `auth.getUser()` instead of `requireUser()`.
- `app/(cockpit)/receipts/_components/ReceiptsPage.tsx` — 62 `style={}` violations (F20). Fully functional otherwise.

**Does not exist (build new):**

- Migration 0169 (`ocr_source`, `vendor_key` columns)
- Monthly summary strip component
- Bookkeeper month view component

---

## External deps tested

- Supabase `receipts` table: verified exists via migration 0103 grep.
- Supabase `business_expenses` table: verified exists via migration 0102 grep.
- Supabase Storage bucket `receipts`: confirmed in migration 0103.
- `requireUser` helper: verified at `lib/auth/require-user.ts`.
- Anthropic Claude API: already used in `app/api/receipts/scan/route.ts`.
- App liveness: `GET https://lepios-one.vercel.app/api/health` → 200.

---

## Grounding checkpoint

**Primary:** Streamlit parity diff for a known-good period.

Steps:

1. Load the Streamlit Receipts page for the current month (2026-05 or most recent month with receipts).
2. Note: total count, total spend ($), total GST ($), matched count.
3. Load the LepiOS receipts page for the same month.
4. Compare the four metrics. Acceptable tolerance: counts match exactly; dollar amounts within $0.01 (floating point).
5. Pick 3 specific receipts from Streamlit (vendor, date, total). Confirm each appears in LepiOS with the same values.

**Pass criterion:** All 4 metrics match exactly + all 3 spot-checked receipts present with matching data.

**Note:** The existing `receipts` table in Supabase is the same one both the Streamlit action system (`accounting.receipt.save` dispatch) and LepiOS write to. If Streamlit has been saving receipts via its action system to Supabase, the data should already be in sync. If not (Streamlit only writes to Google Sheets), the receipts table will have only LepiOS-entered data.

**Fallback grounding:** If Supabase receipts table is empty (Streamlit data only in Sheets), grounding checkpoint is: upload 3 real receipts via the LepiOS upload flow, confirm each appears correctly in the list with correct amounts and categories.

---

## Kill signals

- Auth fix causes a regression in any other route (run full test suite).
- Tailwind rewrite breaks the upload/scan/save flow.
- The `receipt_date` query fix causes receipts to disappear from the current month view.

---

## Cached-principle decisions

**Decision: Use Haiku not Sonnet for OCR (cost)**
Principle F7 (Keepa token guidance analog) — use cheaper model for bulk/repeated operations. Haiku is the right choice for OCR scanning in a potentially high-frequency feature. Not cached — consistent with existing scan route choice.

**Decision: Defer email import**
Principle 17 (Accuracy Zone / defer non-MVP) — Gmail subprocess pattern is not portable. No user cost to deferral since the tab never worked in LepiOS anyway.

**Decision: No new `vendor_rules` table this sprint**
Principle 17 + Check-Before-Build — building a full vendor memory system is a separate chunk. Add the `vendor_key` column now (free, additive, reversible) so the data is captured for when vendor memory is built.

---

## Open questions

None blocking — twin unavailable, all questions resolved from Streamlit source study.

---

## F17 — Behavioral ingestion justification

Receipts feature feeds the behavioral ingestion spec through:

- **Spending pattern signal** — vendor + category + amount + date per receipt is high-quality spend data. Supports path probability for "Colin spent at Costco → likely restocking inventory" patterns.
- **Tax readiness signal** — GST ITCs tracked per receipt feeds the tax center module.
- **Receipt match rate** — unmatched receipts signal incomplete bookkeeping. Morning digest can surface this.

---

## F18 — Measurement + benchmark

**Metrics to capture (via `agent_events` table):**

- OCR success rate (events: `receipt.ocr.success` / `receipt.ocr.failed`)
- Receipt save rate (events: `receipt.saved`)
- Match rate per month (% of receipts matched)
- Average time-to-match (receipt_date → matched_at, deferred — needs `matched_at` column)

**Benchmark:**

- Streamlit baseline: query the Google Sheets "📸 Receipts" tab row count for 2025 as total volume reference.
- Match rate target: ≥ 80% of receipts matched by month-end (LepiOS should match or exceed Streamlit's manual process).

**Surfacing path:** Morning digest "Receipts" section: "X receipts in Y — Z% matched, $N GST ITCs."

---

## Numeric field definition (receipt financials)

| Field        | Source                                       | Pending handling                                    | Bookkeeper target                       |
| ------------ | -------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `pretax`     | OCR extracted or `total / 1.05`              | Not applicable (receipt is a point-in-time capture) | Pre-Tax column in bookkeeper CSV export |
| `tax_amount` | OCR explicit GST line or `total - pretax`    | Not applicable                                      | GST (ITCs) column                       |
| `total`      | OCR `total_paid` field (grand total charged) | Not applicable                                      | Total ($) column                        |

---

## Done state

A passing run looks like:

1. `git grep "style=" app/(cockpit)/receipts/_components/ReceiptsPage.tsx` → 0 results
2. `git grep "auth.getUser" app/api/receipts/` → 0 results
3. CI passes (no TypeScript errors, no lint errors)
4. Migration 0169 in `.claude/migration-claims.json` as claimed, file exists
5. Grounding checkpoint passes (see above)
6. Deployed to Vercel — `/receipts` loads without error
