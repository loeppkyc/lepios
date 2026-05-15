# T-003 Receipts — Phase 1a Study Doc

**Task:** 91adca3c-06a5-4b69-8d9e-dd4e51b2a224  
**Author:** Coordinator  
**Date:** 2026-05-14  
**Sources read:** `streamlit_app/Pages/12_Receipts.py` (~2400 lines), `streamlit_app/utils/gmail.py`, `streamlit_app/utils/email_invoices.py`, `docs/leverage-targets.md` (T-003 section)

---

## Phase 1a — Streamlit Source Study

### Storage Layer

Google Sheets is the database. Two primary worksheets:

- **`📸 Receipts`** — one row per receipt. Columns: Upload Date, Receipt Date, Vendor, Pre-Tax ($), GST ($), Total ($), Category, Drive URL, Match Status, Matched Txn Row, Notes
- **`📧 Email Invoices`** — one row per Gmail attachment. Columns: Import Date, Email Date, From, Subject, Attachment Name, Drive URL, Message ID, Status, Notes

Image files stored in Google Drive (URL written to Drive URL column). No Supabase or local DB backing the primary data — Google Sheets is the source of truth. A best-effort local SQLite `data_layer` write exists but is secondary.

Cache: 15-minute TTL via `@st.cache_data(ttl=900)`. All sheet reads hit cache; any mutation calls `clear_all_caches()` then `st.rerun()`.

### OCR Pipeline

**Image upload path:**

1. User uploads jpg/png/pdf/heic via `st.file_uploader`
2. `_compress_image(image_bytes)` — resizes to max 2500px on longest side, JPEG quality 88, applies 1.3× unsharp mask sharpening
3. `ocr_receipt(image_bytes, media_type)` — calls `claude-sonnet-4-6` via Anthropic SDK
   - `max_tokens=300`, `temperature=0` (not set explicitly, default)
   - System prompt instructs structured JSON extraction: `{vendor, date, gst, total_paid, suggested_category, line_items[]}`
   - Response parsed as JSON; falls back to regex on parse failure
4. **PDF path:** `ocr_pdf_invoice(pdf_bytes)` — uses Claude document API (`type: "document"`) with same model, same output schema
5. **HEIC path:** `pillow_heif` converts to PIL Image before compression. Import guarded — silently skips on Streamlit Cloud where `pillow_heif` may be absent

**Vendor memory:**

- `KNOWN_STORES` — hardcoded dict of ~50 vendors to categories (e.g. `Amazon → Office Supplies`, `Costco → Supplies`)
- `🏷️ Vendor Rules` sheet — user-trained vendor→category overrides, loaded on each scan. Row format: vendor_keyword, category

### Match Logic

`find_matches(receipt_row, transactions_df)` scores receipt against every row in "📒 Business Transactions" sheet:

- **Amount tolerance:** `max(min(total * 0.15, 20.0), 2.0)` — i.e., ±15% capped at $20, minimum $2
- **Date window:** ±10 calendar days
- **Vendor bonus:** word overlap between receipt vendor and transaction description reduces score (lower = better match)
- Returns top 5 matches sorted by score ascending

Bulk match thresholds (used in Reconcile tab and `bulk_auto_match_receipts()`):

- score ≤ 1.0 → auto-confirm match
- score 1.0–3.0 → needs human review
- score > 3.0 → no match found

When a match is confirmed, the Receipts sheet row gets `Match Status = Matched`, `Matched Txn Row = <row_number>`, and the Business Transactions sheet row gets `Hubdoc = Y` written back.

### Gmail Scanner

`streamlit_app/utils/gmail_invoice_sync.py` is an **external Python script** — it is NOT a server-side process. It runs:

- Manually from the Email Import tab via `subprocess.run()`
- Via Windows Task Scheduler (weekly cadence, configured by Colin locally)

It does **not** run on Streamlit Cloud. Any deployment to Streamlit Community Cloud breaks this entirely unless the user is running from a local machine.

OAuth2 flow: `google-auth` / `googleapiclient`. Credentials from `.streamlit/secrets.toml [gmail]` section. Scope: `gmail.readonly`. On Streamlit Cloud, `token.json` cannot be persisted — first-run OAuth flow requires a browser, which breaks the script.

`scan_invoices(service, after_date="2026/01/01")`:

- Searches Gmail for emails matching `after:2026/01/01 has:attachment (invoice OR receipt OR statement)`
- Trust levels per sender domain: `trusted` (auto-import), `review` (flag for human), `skip` (ignore)
- Downloads PDF/image attachments, saves to Drive, calls OCR, writes row to "📧 Email Invoices" sheet
- Dedup check: checks `Message ID` column in sheet before importing (prevents re-import on re-run)

`process_email_invoice()` in `email_invoices.py`:

- Downloads attachment → OCR → `guess_category()` (keyword-based) → writes to Receipts sheet
- Status values: `New` / `Imported` / `Skipped`

### UI — 7 Tabs

1. **Upload** — Single upload (drag & drop, immediate OCR + match), Batch upload (process multiple, queue for review)
2. **Review Queue** — 3-panel Hubdoc-style: receipt image (left), OCR data (center), transaction matches (right). User confirms or skips each.
3. **All Receipts** — Full table view, filter by month/category/match status, download CSV
4. **Bookkeeper View** — Monthly summary table with Drive links, subtotals per category
5. **Email Import** — "Scan Gmail Now" button (runs the external script), shows Email Invoices sheet rows, import-to-receipts button per row
6. **Reconcile** — Month selector. Shows receipt rows color-coded: 🟢 matched / 🔴 missing (in transactions but no receipt) / 🟡 unlinked receipt (receipt exists, no matching txn) / ⚪ personal-ignored. Bulk auto-match button at top.
7. **Hubdoc Archive** — Historical import view

### Fragile Points

| Issue                                          | Impact                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Google Sheets as DB                            | Slow reads (>1s), 15-min stale cache, no indexing, concurrent writes unsafe |
| Gmail sync is local-only script                | Breaks on any server deployment; weekly cadence vs ideal daily              |
| `claude-sonnet-4-6` for 300-token OCR          | ~5–10× more expensive than Haiku for same quality task                      |
| Line items stored as JSON blob in Notes column | Not queryable; no reporting across line items across time                   |
| No dedup at Sheets level on message_id         | Possible duplicate rows if script runs twice in same window                 |
| HEIC import guard is silent                    | No user error if pillow_heif missing on Cloud                               |
| Match tolerance 15%                            | False-positives on large amounts ($500 receipt matches $574 txn)            |
| No confidence score in UI                      | User can't assess match quality; borderline matches look same as perfect    |
| `Matched Txn Row` is a row number              | Breaks on any sheet sort/insert; unstable reference                         |

---

## Phase 1b — T-003 Spec (from docs/leverage-targets.md)

**Done state:** `/receipts` cockpit page showing 90-day view

**Tables required:**

- `receipt_lines`: `vendor`, `date`, `line_items[]`, `total`, `tax`, `source_email_id`, `reconciled_bool`
- (implicit) `receipt_matches`: links receipt to bank/CC transaction

**Scanner:** Daily Gmail scanner (server-side cron, not weekly local script)

**OCR:** Vision API for non-text receipts (images with no extractable text)

**Reconciliation:** Match receipts against bank/CC transactions

**Metric:** Reconciliation rate  
**Benchmark:** ≥95% auto-matched within 7 days  
**Surface:** `/receipts` cockpit page + `morning_digest`

---

## Phase 1c — 20% Better Than Streamlit

| Improvement           | Streamlit                                          | LepiOS                                                                                                 |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Storage**           | Google Sheets (~1s reads, no indexes, brittle)     | Supabase `receipt_lines` + `receipt_matches` — indexed, queryable, sub-100ms                           |
| **Gmail scanner**     | Local Python script, weekly, breaks on server      | Vercel cron (daily), server-side, no local dependency                                                  |
| **OCR model**         | `claude-sonnet-4-6` (expensive for 300-token task) | `claude-haiku-4-5-20251001` — same quality, ~10× cheaper. Sonnet only for complex PDFs                 |
| **Line items**        | JSON blob in Notes column — not queryable          | `jsonb` column on `receipt_lines` — queryable with `->` operators, aggregatable                        |
| **Dedup**             | Message ID checked in Sheet (manual scan)          | DB UNIQUE constraint on `source_email_id` — guaranteed at insert, no scan needed                       |
| **Match quality**     | No score exposed; match is binary confirmed/not    | `match_confidence` float on `receipt_matches` — surfaced in UI, drives auto-threshold                  |
| **Source tracking**   | Upload or Gmail only                               | `source` enum: `gmail` / `upload` / `camera`. Camera path designed into schema from day 1              |
| **Reconcile status**  | Color-coded only in Reconcile tab                  | Inline on every receipt row throughout the app                                                         |
| **Match tolerance**   | Fixed 15%                                          | Tiered by amount: ≤$50 → ±$3 flat; $50–$500 → ±10%; >$500 → ±5% (reduces large-amount false positives) |
| **HEIC support**      | Silent fail on Cloud                               | Server-side sharp/libvips conversion — no client-side library required                                 |
| **Morning digest**    | Not present                                        | Reconciliation rate surfaced: `X% auto-matched (last 7 days), Y unmatched receipts`                    |
| **Bookkeeper export** | Drive links in Streamlit tab                       | CSV export with vendor, date, amount, category, match_status, transaction_id columns                   |

**F17 behavioral ingestion signal:** Receipt vendor + category pairs feed the `knowledge` table as `receipt_vendor → category` rules. Over time, the twin can answer "where does Colin spend on X?" from actual receipt data.

**F18 metrics:** `receipt_lines` rows inserted/day, `receipt_matches` rows with `match_confidence > 0.8` / day, reconciliation rate (7-day rolling window). All logged via `agent_events` or computed from table counts.
