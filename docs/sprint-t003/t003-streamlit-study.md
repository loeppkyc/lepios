# T-003 — Receipts (Camera + Vision OCR + Reconciliation)
# Phase 1a Study Doc

Coordinator: autonomous (task 91adca3c)
Date: 2026-05-10
Leverage target: T-003 in `docs/leverage-targets.md`
Task: `task_queue` id `91adca3c-06a5-4b69-8d9e-dd4e51b2a224`

---

## Done-State Contract (from leverage-targets.md)

```
/receipts renders last 90 days of Amazon + non-Amazon receipts pulled from daily Gmail
scanner, parsed into receipt_lines table (vendor, date, line_items[], total, tax,
source_email_id, reconciled_bool). Reconciliation runs against bank/CC transactions,
surfaces unmatched in cockpit. Sortable/filterable by vendor, date, amount, reconciled
status. Bulk-reconcile UI for clearing matched.

metric: reconciliation rate
benchmark: ≥95% auto-matched within 7 days of receipt arrival
surface: cockpit nav → /receipts, morning_digest: "X new receipts, Y unreconciled"
```

---

## Streamlit Baseline

The Streamlit OS directory is not accessible from the coordinator cloud sandbox.
However, the Sprint 5 gmail-scanner study (`docs/sprint-5/gmail-scanner-study.md`)
already captured the full Streamlit `utils/gmail.py` (458 lines) analysis. Key findings
carried forward from that study:

- **Auth:** OAuth2 refresh_token flow → `GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN`
- **Scan:** Two-pass Gmail query (keyword + known-sender), dedup by message_id
- **KNOWN_INVOICE_SENDERS:** 17 domains (seeded into `gmail_known_senders`)
- **KNOWN_INLINE_SENDERS:** 40 domains (seeded into `gmail_known_senders`)
- **Extraction:** Streamlit had NO structured extraction — it listed emails for Colin to
  review manually. The `receipt_lines` concept (parsed vendor/total/tax/line_items) is
  **net-new capability** not present in Streamlit. This is a pure improvement, not a port.

---

## Check-Before-Build — What Already Exists

This is a critical section. T-003 covers ground that has been substantially built.

### Fully built (no gaps)

**1. Camera/file OCR pipeline (`/receipts` page)**

- `app/(cockpit)/receipts/page.tsx` + `_components/ReceiptsPage.tsx` (957 lines)
- Drag-drop + camera capture → POST `/api/receipts/scan` → Claude Vision OCR
- Review form: date, vendor, category, pre-tax, tax, notes
- Receipt list with month filter, match status (matched/review/unmatched)
- Manual expense linking via inline MatchPicker
- Bookkeeper view grouped by month with category breakdown
- Monthly summary strip: Total Spend, GST ITCs, Matched, Unmatched
- Delete + Unlink actions
- Uses Tailwind utility classes throughout (F20 compliant)

**2. Receipts API routes**

- `GET /api/receipts?month=YYYY-MM` — month-scoped query
- `POST /api/receipts` — creates receipt + optional business_expense auto-creation
- `GET/DELETE /api/receipts/[id]` — individual receipt CRUD
- `PATCH /api/receipts/[id]/match` — link/unlink to expense
- `GET /api/receipts/[id]/image` — serve from Supabase Storage
- `POST /api/receipts/scan` — Claude Vision OCR endpoint

**3. `receipts` table** (migration 0103 + 0169)

```
id, upload_date, receipt_date, vendor, pretax, tax_amount, total, category,
storage_path, match_status, matched_expense_id, notes, created_at, updated_at,
ocr_source (manual|claude_vision|email_import), vendor_key
```

RLS: authenticated users only. Storage bucket: `receipts`.

**4. Gmail scanner infrastructure** (Sprint 5, commit 8b34b33, migration 0022 — awaiting production grounding)

- `lib/gmail/client.ts` — OAuth2 auth, `createGmailService()`
- `lib/gmail/scan.ts` — two-pass scan, filterNewMessages, insertMessages
- `lib/gmail/senders.ts` — KNOWN_INVOICE/INLINE_SENDERS constants
- `lib/gmail/classifiers/types.ts` — shared KnownSender type
- `lib/gmail/classifiers/statement-arrivals.ts` — classifies bank statement emails
- `lib/gmail/classifiers/invoice.ts` — classifies invoice emails (PDF attachments)
- `lib/gmail/classifiers/receipt.ts` — **classifies inline receipt emails**, stores body_text
- `lib/gmail/classifiers/learn-senders.ts` — auto-learns new sender domains
- `app/api/cron/gmail-scan/route.ts` — hourly cron, F22-compliant

**5. Gmail classifier tables** (migrations 0022, 0055, 0058)

```
gmail_known_senders    — trusted/review/ignore sender domains
gmail_messages         — dedup store for all scanned messages
gmail_statement_arrivals — classified bank statement emails
gmail_invoice_classifications — invoice emails with attachment_name, confidence
gmail_receipt_classifications — inline receipt emails with body_text (up to 4000 chars)
gmail_daily_scan_runs  — scan run metadata
```

**6. Reconciliation UI** (`/reconciliation` — "Paper Trail")

- `app/(cockpit)/reconciliation/_components/ReconciliationPage.tsx`
- Auto-match button → POST `/api/reconciliation/auto-match`
- Unmatched receipts list with candidate expense suggestions + confidence score
- Expenses missing receipts list
- Manual "Link" action per receipt

**⚠️ F20 violation:** `ReconciliationPage.tsx` uses inline `style={}` props throughout
(~40 instances). Must be refactored to Tailwind utility classes before T-003 can ship.
This is in scope for the reconciliation chunk.

**7. Bank/CC transaction tables**

```
bank_imports — batch import records (source_file, source_account, period, status)
pending_transactions — individual bank CSV rows (txn_date, description, vendor_extracted,
                        amount_signed, is_debit, suggested_expense_account, confidence,
                        status, je_id)
transactions — ledger transactions (txn_date, vendor, vendor_key, pre_tax_cad, gst_cad,
                total_cad, category, payment_method, receipt_id, hubdoc_status)
```

The `transactions` table has `receipt_id UUID` FK → `receipts(id)` — this is the natural
reconciliation target. The `pending_transactions` table is a staging layer for bank CSV
imports. Bank/CC reconciliation in T-003 almost certainly means linking `receipts` rows
to `transactions` rows via `transactions.receipt_id`.

---

### What is NOT yet built (gaps vs T-003 done_state)

**Gap A: Gmail extraction pipeline** (highest priority gap)

`gmail_receipt_classifications.body_text` contains up to 4000 chars of email body text
(receipts from Amazon, Shopify, etc.). This text has NOT been parsed into structured
receipt fields. There is no pipeline that:
1. Reads `body_text` from `gmail_receipt_classifications`
2. Extracts vendor, total, tax, line_items[] via Claude text API or regex
3. Inserts rows into `receipts` with `ocr_source='email_import'`

This is the core missing piece of T-003.

**Gap B: `source_email_id` on receipts table**

The `receipts` table has no `source_email_id` column linking back to
`gmail_messages.message_id`. Without this, email-imported receipts can't be traced back
to their source email for audit/review.

**Gap C: `line_items[]` storage**

T-003's done_state specifies `line_items[]` as a column. The existing `receipts` table
has no array column. Whether this is a JSONB column on `receipts` or a separate
`receipt_line_items` table is an open design question.

**Gap D: 90-day rolling view with sort/filter**

Current `/api/receipts` only supports `?month=YYYY-MM` filtering. T-003 wants:
- Last 90 days (default view, not month-by-month)
- Filter by: vendor, date range, amount range, reconciled status
- Sort by: vendor, date, amount, reconciled status

**Gap E: Bank/CC reconciliation against `transactions`**

The existing `/reconciliation` page matches `receipts` → `business_expenses`.
T-003 wants matching against `transactions.receipt_id`. This is architecturally different:
- Current: receipt → expense (bookkeeping linkage)
- T-003: receipt → bank transaction (bank statement reconciliation)

Whether these should be unified or kept separate is an open design question.

**Gap F: Bulk-reconcile UI**

No bulk-clear-matched action exists. The current UI matches one at a time.

**Gap G: morning_digest line**

`lib/orchestrator/digest.ts` has no receipts-related digest line. Need to add:
"X new receipts, Y unreconciled" sourced from `receipts` table.

---

## Domain Rules Found (carry forward to acceptance doc)

1. `ocr_source` enum is locked: `('manual', 'claude_vision', 'email_import')`. Gmail-extracted
   receipts MUST use `'email_import'`.
2. `match_status` enum: `('matched', 'review', 'unmatched')`. Auto-matched with high confidence
   → `'matched'`. Low confidence suggestion → `'review'`. No match → `'unmatched'`.
3. `vendor_key` = `vendor.toLowerCase().replace(/[^a-z0-9]/g, '')` — apply to email-extracted
   receipts too for vendor dedup.
4. `receipts` table RLS: authenticated users full CRUD. Email-import pipeline uses service_role
   (same as gmail-scanner cron).
5. Amazon seller disbursement emails (subject: "your payment is on the way") must be filtered
   OUT — they are income, not expense receipts. This rule is already in `receipt.ts:AMAZON_INCOME_RE`.
6. Promo/newsletter emails must be filtered OUT — `PROMO_SUBJECT_RE` in `receipt.ts`.
7. Body text < 100 chars → skip (not a real receipt). Already in `classifyReceipt()`.

---

## Edge Cases (from existing code + domain knowledge)

1. **Same receipt in camera + Gmail**: A receipt uploaded via camera AND received via Gmail
   should NOT create two `receipts` rows. Dedup strategy needed (amount + vendor + date
   window matching).
2. **Amazon order confirmation vs Amazon receipt**: Amazon sends order confirmations AND
   separate ship confirmation emails. Only the order confirmation with total is a receipt.
3. **Multi-vendor Amazon orders**: Amazon order emails can contain multiple merchants. The
   `line_items[]` concept handles this.
4. **Currency**: `receipts` table uses numeric without explicit currency. T-003 is Canadian
   context; assume CAD. Non-CAD receipts (rare) should be flagged in notes.
5. **Duplicate email IDs**: `gmail_messages.message_id` has UNIQUE constraint — idempotent
   Gmail scan is correct. But the extraction pipeline must also be idempotent (re-processing
   same `message_id` must not create duplicate receipts rows).

---

## Twin Q&A — blocked (endpoint unreachable)

All 4 twin Q&A calls failed: "Host not in allowlist" from coordinator sandbox.
The cloud coordinator sandbox cannot reach `lepios-one.vercel.app`.

## Pending Colin Questions

1. **receipt_lines table vs receipts extension:** Does T-003's `receipt_lines` (vendor, date,
   line_items[], total, tax, source_email_id, reconciled_bool) mean: (a) a new table named
   `receipt_lines`, OR (b) extending the existing `receipts` table with `source_email_id` and
   `line_items JSONB` columns? The existing `receipts.ocr_source = 'email_import'` suggests
   option (b), but the done_state names it `receipt_lines`.

2. **Bank/CC reconciliation target:** "Reconciliation against bank/CC transactions" — does this
   mean linking `receipts` to `transactions.receipt_id` (which has a FK ready), or something
   else? The `transactions` table already has `receipt_id UUID → receipts(id)`.

3. **Camera OCR completeness:** Is the existing camera OCR `/receipts` page (ReceiptsPage.tsx)
   considered complete/shipped for T-003? Or does it need changes (e.g., 90-day view, sort/filter)
   before T-003 is declared done?

4. **Extraction method:** For turning `gmail_receipt_classifications.body_text` into structured
   fields (vendor, total, tax, line_items[]), should this use:
   (a) Claude text API (accurate but has per-call cost), or
   (b) Rule-based regex (free but brittle for varied email formats)?

---

## 20% Better Opportunities (Phase 1c)

| Category | Streamlit gap | LepiOS v1 improvement |
|----------|--------------|----------------------|
| **Correctness** | Streamlit had no extraction — manual review only | Automated extraction via Claude text API gives structured fields without manual review |
| **Performance** | N/A (no extraction) | Batch extraction: process multiple receipt body_texts in one Claude API call (context: up to 10 receipts per call) |
| **UX** | N/A (no UI equivalent) | 90-day rolling view vs month-by-month gives better trend visibility |
| **Extensibility** | Flat domain list, no confidence | `gmail_known_senders.trust_level` → confidence level → auto-trust after N correct extractions |
| **Data model** | No source traceability | `source_email_id` links receipt back to Gmail message for audit |
| **Observability** | No metrics | `agent_events` rows per extraction run: count extracted, confidence distribution, failure rate |

**Proposed 20% Better improvements (no domain-semantic changes, no Colin escalation needed):**
1. Batch Claude extraction (10 receipts per API call, not 1)
2. `source_email_id` on receipts table (additive column)
3. 90-day rolling window as default API param (additive query param)
4. Idempotent extraction check before processing (prevents duplicate receipts from re-runs)

**Proposed 20% Better requiring Colin input:**
- `line_items JSONB` vs `receipt_line_items` table — depends on Q1 above
- Reconciliation target (`transactions` vs new concept) — depends on Q2 above

---

## Proposed Chunk Decomposition

T-003 is a multi-chunk feature. Proposed order (dependency-first):

| Chunk | Name | Scope | Dependency |
|-------|------|-------|------------|
| T003-A | Gmail extraction pipeline | Add `source_email_id`/`line_items` to receipts; extraction cron | Sprint 5 gmail-scanner grounded |
| T003-B | `/receipts` 90-day view + filters | Expand API + update UI | T003-A |
| T003-C | Bank/CC reconciliation | Link receipts → transactions; reconciliation UI refactor (F20 fix) | T003-A |
| T003-D | morning_digest line | Add "X new receipts, Y unreconciled" to digest | T003-A |

**Pre-condition:** Sprint 5 gmail-scanner chunk must be grounded (env vars set, migration 0022
applied to production, cron verified) before T003-A can ship meaningfully.

---

## Kill Signals for T-003

- Gmail extraction accuracy < 80% (too many wrong vendors/amounts requiring manual correction)
- Claude text API cost > $5/month for extraction (volume too low to justify)
- Reconciliation auto-match rate < 50% (bank/CC transactions too different from receipts)
