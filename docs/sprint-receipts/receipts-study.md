# Receipts Feature — Streamlit Study

**Streamlit source:** `pages/12_Receipts.py` (2641 lines)
**Study date:** 2026-05-09
**Phase:** 1a — Streamlit study + 20% Better loop

---

## What it does

The Streamlit Receipts page is a Hubdoc-style receipt capture and bookkeeping tool with 7 tabs:

1. **Upload Receipt** — Single or batch upload of JPEG/PNG/PDF/HEIC receipt photos. Claude Vision (claude-sonnet-4-6) auto-extracts vendor, date, GST, total, line items. A fuzzy vendor-memory system maps messy OCR text to clean vendor names and auto-fills category from prior saves.

2. **Review Queue** — 3-panel Hubdoc-style layout (document list | receipt image | transaction details + match picker). Filters by Matched/Needs Review/All. Shows duplicate detection badges. Allows per-receipt matching to a Business Transaction.

3. **All Receipts** — Table with month/status/vendor/amount filters. Shows total spend, GST ITCs, match count. CSV export.

4. **Bookkeeper View** — Monthly accordion panels with clickable Drive links. YTD summary. Per-month category breakdowns. Designed to be shared with the bookkeeper.

5. **Email Import** — Scans Gmail for invoice/receipt attachments. Trusted senders auto-import; new merchants require review. Trust levels: `trusted`, `review`, `skip`. Auto-processes all pending with progress bar.

6. **Statement Reconciliation** — Color-coded (green/red/yellow) view of all Business Transactions for a month vs receipts on file. Bulk auto-match. "Month-End Checklist" shows classified statement lines without linked receipts (groups by vendor source like Walmart.ca, Amazon.ca).

7. **Hubdoc Archive** — Browses 2026 files in Dropbox `/Hubdoc` folder. Filters by vendor/amount/date. Downloads and displays images/PDFs inline.

---

## Data model (Streamlit)

**Google Sheets — "📸 Receipts" worksheet:**
| Column | Type | Notes |
|--------|------|-------|
| Upload Date | DATE | When saved |
| Receipt Date | DATE | From OCR or manual entry |
| Vendor | TEXT | Clean name |
| Pre-Tax ($) | NUMERIC | pretax = total / (1 + GST_RATE) |
| GST ($) | NUMERIC | 5% GST |
| Total ($) | NUMERIC | pretax + gst |
| Category | TEXT | One of 31 categories (incl. Personal— prefixed) |
| Drive URL | TEXT | Google Drive / Dropbox URL |
| Match Status | TEXT | "Matched" or "Unmatched" |
| Matched Txn Row | INT | Sheet row number of matched Business Transaction |
| Notes | TEXT | Free text; JSON blob if line_items present |

**Google Sheets — "🏷️ Vendor Rules" worksheet:**

- vendor_key (normalized, alphanumeric-only) → display name + category
- Learned per save, checked on every upload

**External storage:** Google Drive via service account (Streamlit), with Drive file URLs stored in the sheet. The Dropbox archive tab reads from `/Hubdoc` in Dropbox for legacy 2026 receipts.

---

## Domain rules embedded in Streamlit

1. **GST_RATE = 0.05** — All tax calculations use exactly 5% GST. No PST, no HST variation.
2. **Pre-tax auto-calculation:** `pretax = round(total / (1 + GST_RATE), 2)`, `gst = round(total - pretax, 2)`. If OCR provides explicit GST line, that overrides the calculated value.
3. **Category set has 31 entries** including `Personal—` prefixed categories for personal receipts. The LepiOS `expenses.ts` category set has only 20 business categories — it deliberately omits all Personal— categories.
4. **Vendor key normalization:** `vendor_key(vendor)` strips to alphanumeric lowercase (defined in `utils/__init__.py`). KNOWN_STORES dictionary maps 50+ common Canadian retail OCR strings to clean names + default categories.
5. **Matching tolerance:** `max(min(total * 0.15, 20.0), 2.0)` — sliding, 15% of total, clamped [$2, $20]. Date within ±10 days. Already-matched (Hubdoc=Y) transactions excluded.
6. **Match scoring:** `score = |amount_diff| * 10 + |day_diff|`. Vendor word-overlap bonus of -5 on score if words match. Auto-confirm threshold: score ≤ 1.0. Review threshold: ≤ 3.0. No match: > 3.0.
7. **Duplicate detection:** Same vendor + amount + date = possible duplicate. Shown in Review Queue with 📓 badge.
8. **Storage backend:** Streamlit uses Google Drive (via service account); legacy archive uses Dropbox. LepiOS uses Supabase Storage — already implemented in migration 0103.
9. **Email import trust levels:** `trusted` (auto-import), `review` (manual), `skip` (always ignore). Amazon FBA payment addresses always seeded as `skip`.
10. **Dedup key format:** `vendor_key|total.2f|date_str` — used to prevent double-matching in bulk auto-match.
11. **Matched transaction update:** Setting Hubdoc=Y on the matched Business Transaction AND appending `Receipt: {url}` to its Notes field.
12. **Line items storage:** When Claude extracts line_items, they are JSON-stringified into the Notes field: `{"user_notes": "...", "line_items": [...]}`. Max 10 items.

---

## Edge cases

- **OCR fallback:** If Claude Vision fails or API key absent, shows "Couldn't auto-read. Fill in vendor and total." No hard failure.
- **HEIC images:** `pillow_heif` converts to JPEG before sending to Claude. If library absent, HEIC unsupported.
- **File size check:** 20MB max upload; Claude Vision limit 4.5MB after compression. Images compressed to max 2500px, quality 88%, fallback to 2000px/82% if still over 4.5MB.
- **Total = 0 on batch:** Retry Claude button per-item if amount not extracted.
- **Personal vs Business toggle:** Category list filters to Personal— prefix on "Personal" selection, business categories otherwise.
- **Bulk match dedup:** `_matched_keys` set prevents the same receipt being matched twice in one bulk run.
- **Delete from Review Queue:** Direct Sheets row deletion — no soft delete.
- **Hubdoc archive months:** Only shows files with a 2026 date in the filename — filename format is `{vendor}_{YYYY-MM-DD}_{amount}.{ext}`.

---

## Fragile / improvable points

1. **No auth on Receipts page** — Streamlit app is auth-gated at the app level. Individual pages have no per-route auth checks.
2. **Google Sheets as backend** — every save is a row append; every load is a full sheet fetch (cached 15 min). N+1 pattern on match confirmation (separate calls to update receipt row and transaction row).
3. **Match by sheet row number** — `Matched Txn Row` stores the integer row number in the Google Sheet, which changes when rows are deleted. Fragile. LepiOS uses UUIDs — correct.
4. **No upload dedup at save time** — only warns user, doesn't hard-block. Easy to save duplicates if user dismisses warning.
5. **Email import requires local script** — `gmail_invoice_sync.py` runs as a subprocess via `subprocess.run()`. Not portable to a serverless/cloud environment.
6. **Dropbox Hubdoc tab** — reads Dropbox API live on every tab switch (cached 5 min). Not applicable to LepiOS.
7. **`match_status` stored as "Matched"/"Unmatched"** — capitalized strings. LepiOS already uses lowercase enum: `matched`, `review`, `unmatched` — correct improvement.
8. **The `upload_date` query bug:** The existing LepiOS GET `/api/receipts` queries `upload_date` not `receipt_date`. Should query `receipt_date` (with fallback to `upload_date`) since that's what the month filter should reflect.
9. **No `requireUser` on GET/DELETE routes** — raw auth.getUser() check without using requireUser helper. Violates F22 principle.
10. **62 `style=` violations in ReceiptsPage.tsx** — entire UI built with inline styles. Violates F20.

---

## Twin Q&A

Twin endpoint returned 401 — not accessible without credentials. All questions escalated to Colin or answered from context.

**Q: Should the receipts feature support Personal categories (Personal — Groceries etc.) in LepiOS?**
[twin: no corpus data — answered from context] The Streamlit version has 31 categories including Personal— prefixed ones. The LepiOS `expenses.ts` has 20 business-only categories. The receipts table doesn't distinguish. Decision: defer Personal categories to v1.1 — LepiOS is business-focused and the current UI needs completion first.

**Q: Is email import (Gmail scan) in scope for this port?**
[twin: no corpus data — answered from context] Email import requires gmail_invoice_sync.py as a subprocess — not portable to serverless. Out of scope for v1. The existing code has the infrastructure but the email tab is a no-op in LepiOS currently.

**Q: Should the Hubdoc archive tab be ported?**
[twin: no corpus data — answered from context] Hubdoc archive reads from Dropbox — completely different storage backend from LepiOS (Supabase Storage). Out of scope for v1.

---

## 20% Better

### Correctness improvements

- **Fix upload_date vs receipt_date query:** The GET route queries `upload_date` for month filtering. Should use `receipt_date` (fall back to `upload_date` if null) since receipts from December uploaded in January should appear in December, not January.
- **Add requireUser to all routes:** GET, DELETE, and the main POST route use raw `auth.getUser()` instead of `requireUser()`. This violates F22 and creates a subtle fail-open risk.

### Performance improvements

- **Server component data prefetch:** The current page is 100% client-side — fetches via `/api/receipts?month=`. A server component page could pre-fetch the current month's receipts and pass as props, eliminating the loading flash on first render.
- **Remove N+1 pattern:** Match confirmation currently requires updating receipt + expense in two separate API calls. The match route already does this atomically — good.

### UX improvements (20% Better)

- **Replace 62 inline styles with Tailwind classes** (F20 compliance) — the entire ReceiptsPage.tsx needs a rewrite using Tailwind utility classes only.
- **Add monthly spend summary strip** — show total spend, total GST ITCs, and matched% for the selected month at the top of the page, like the Bookkeeper View metrics.
- **Add bookkeeper-ready month summary** — the Bookkeeper View tab concept is valuable; integrate a condensed version into the main receipts list instead of a separate tab.
- **Improve scan UX** — show image preview alongside the OCR form (currently no preview in the review state). The Streamlit version shows image left + form right.
- **Add "Upload Date" column** — show when the receipt was logged vs when it occurred.

### Data model improvements

- **Add `ocr_source` and `ocr_confidence` columns** to `receipts` table — Streamlit tracks these in the local SQLite data layer. Useful for quality scoring and filtering.
- **Add `vendor_key` column** — normalized vendor for dedup and vendor memory lookups.

### Observability improvements

- **Log OCR events to `agent_events`** — track OCR success/failure rate per model. F18 requirement.
- **Track match rate** — % of receipts matched per month. Surface in morning_digest.

---

## What exists in LepiOS today

### Already built (Check-Before-Build findings)

- `supabase/migrations/0103_receipts.sql` — `receipts` table with correct schema + RLS + storage bucket. Applied to prod.
- `supabase/migrations/0102_business_expenses.sql` — `business_expenses` table. Applied to prod.
- `app/(cockpit)/receipts/page.tsx` — shell page, imports ReceiptsPage
- `app/(cockpit)/receipts/_components/ReceiptsPage.tsx` — full client component (980 lines), functional upload + OCR + list + match. **Has F20 violations (62 inline styles).**
- `app/api/receipts/route.ts` — GET (by month) + POST (upload + OCR save). **Missing requireUser on GET.**
- `app/api/receipts/scan/route.ts` — POST Claude Vision OCR. Has requireUser.
- `app/api/receipts/[id]/route.ts` — DELETE. **Missing requireUser (uses raw auth.getUser()).**
- `app/api/receipts/[id]/match/route.ts` — PATCH link/unlink. **Missing requireUser.**
- `lib/types/receipts.ts` — Receipt, OcrResult, MatchStatus types. Complete.
- `lib/types/expenses.ts` — CATEGORIES constant. Has 20 business categories (no Personal—).

### Missing / incomplete

1. **Auth hardening** — GET, DELETE, and PATCH routes don't use `requireUser()`. Violates F22.
2. **F20 violations** — ReceiptsPage.tsx has 62 inline `style={}` attributes. Must be rewritten with Tailwind.
3. **receipt_date query fix** — GET route filters by `upload_date` not `receipt_date`.
4. **No Bookkeeper View** — the monthly summary with GST totals and category breakdown exists in Streamlit but not in LepiOS.
5. **No spend summary strip** — no aggregate metrics at the top of the receipts list.
6. **No Statement Reconciliation view** — the color-coded transaction vs receipt view doesn't exist in LepiOS.
7. **No vendor memory** — LepiOS has no vendor → category lookup system.
8. **OCR model** — Streamlit uses claude-sonnet-4-6; LepiOS uses claude-haiku-4-5-20251001. Haiku is acceptable for cost, but the prompt is simpler and doesn't include line_items or the fallback sharpening/compression logic.
9. **Missing `ocr_source`/`ocr_confidence` columns** — not in the schema.
