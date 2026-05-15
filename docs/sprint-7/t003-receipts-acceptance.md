# T-003 Receipts — Acceptance Doc

**Task ID:** 91adca3c-06a5-4b69-8d9e-dd4e51b2a224  
**Sprint:** 7  
**Status:** awaiting_builder_assignment — Colin must review before build starts (email + Vision API costs involved)  
**Coordinator:** harness/task-91adca3c-receipts-coordinator  
**Study doc:** [docs/sprint-7/t003-receipts-study.md](t003-receipts-study.md)  
**Date:** 2026-05-14

---

## 1 — Overview

Port the Streamlit receipts module (`12_Receipts.py`) to LepiOS as a `/receipts` cockpit page backed by Supabase. Replace Google Sheets storage with structured Supabase tables, replace the local Windows Task Scheduler Gmail script with a server-side Vercel cron, replace `claude-sonnet-4-6` OCR with `claude-haiku-4-5-20251001`, and surface match confidence inline throughout the UI.

**Done state:** `/receipts` page shows a 90-day scrollable receipt list. Each row shows vendor, date, total, category, match status, and confidence score. Gmail scanner runs daily automatically. Reconciliation rate ≥95% auto-matched within 7 days (benchmark).

---

## 2 — GitHub Prior Art

Searched: receipt OCR Next.js, Gmail API receipt parser, receipt reconciliation open source

| Repo / Library                                           | Verdict                        | Reason                                                             |
| -------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `vercel/ai`                                              | Reference                      | Streaming Anthropic SDK usage patterns                             |
| `googleapis/google-api-nodejs-client`                    | Wrap                           | Gmail API v1 Node.js client — use directly                         |
| `lovell/sharp`                                           | Wrap                           | Server-side image resize/convert — replaces `pillow_heif` for HEIC |
| `mozilla/pdf.js`                                         | Reference only                 | PDF rendering; we send PDFs directly to Claude document API        |
| `receipts-parser` (npm)                                  | Skip                           | Regex-only, no Vision fallback, last updated 2021                  |
| No complete receipt→transaction reconciliation OSS found | Build-new for reconcile engine | The matching + dedup + Supabase integration is custom              |

**Verdict:** Wrap Gmail Node.js client + Sharp. Build-new for receipt_lines storage, OCR pipeline, and reconciliation engine. No OSS library covers the full flow.

---

## 3 — Schema

### 3.1 `receipt_lines` table

```sql
CREATE TABLE public.receipt_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  receipt_date      date NOT NULL,
  vendor            text NOT NULL,
  pre_tax           numeric(10,2),
  tax               numeric(10,2),
  total             numeric(10,2) NOT NULL,
  category          text,
  line_items        jsonb DEFAULT '[]'::jsonb,
  source            text NOT NULL CHECK (source IN ('gmail','upload','camera')),
  source_email_id   text UNIQUE,           -- Gmail message ID; NULL for upload/camera
  drive_url         text,                  -- Google Drive link to original image/PDF
  ocr_model         text,                  -- 'haiku' | 'sonnet' | 'regex'
  ocr_raw           jsonb,                 -- full JSON returned by OCR call
  reconciled        boolean NOT NULL DEFAULT false,
  notes             text
);

GRANT INSERT, UPDATE, DELETE ON public.receipt_lines TO service_role;

ALTER TABLE public.receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON public.receipt_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**`source_email_id` UNIQUE constraint** prevents duplicate Gmail imports at DB level — no pre-scan required.

**`line_items` jsonb schema** (per element):

```json
{ "description": "string", "amount": 0.0, "qty": 1 }
```

### 3.2 `receipt_matches` table

```sql
CREATE TABLE public.receipt_matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  receipt_id        uuid NOT NULL REFERENCES public.receipt_lines(id) ON DELETE CASCADE,
  transaction_id    uuid NOT NULL REFERENCES public.bank_transactions(id),
  match_confidence  numeric(5,4) NOT NULL,  -- 0.0000 – 1.0000
  auto_confirmed    boolean NOT NULL DEFAULT false,
  confirmed_at      timestamptz,
  confirmed_by      text DEFAULT 'system'
);

GRANT INSERT, UPDATE, DELETE ON public.receipt_matches TO service_role;

ALTER TABLE public.receipt_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON public.receipt_matches
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX receipt_matches_receipt_unique ON public.receipt_matches(receipt_id);
-- One confirmed match per receipt; multiple candidates allowed before confirmation
```

> **Note:** If `bank_transactions` table does not exist when this migration runs, `transaction_id` FK must be deferred. Coordinator to check schema before migration is authored. If absent: store `transaction_id` as `text` with a comment referencing the pending bank_transactions migration.

---

## 4 — Gmail Scanner (Vercel Cron)

### Route

`POST /api/receipts/gmail-scan` — protected by `requireCronSecret(request)` from `lib/auth/cron-secret.ts` (F22).

**Cron schedule:** `0 9 * * *` (9:00 AM UTC = 3:00 AM MDT) — daily, after overnight bank feeds settle.

### Scan logic

1. Read Gmail OAuth credentials from `harness_config` table (`gmail_client_id`, `gmail_client_secret`, `gmail_refresh_token`). Never `process.env` for cross-boundary values (S-L1 pattern).
2. Call Gmail API `users.messages.list` with query: `after:{yesterday_date} has:attachment (invoice OR receipt OR statement OR order)`.
3. For each message:
   a. Check `receipt_lines.source_email_id = message.id` — skip if exists (dedup).
   b. Download first PDF or image attachment (prefer PDF if both present).
   c. Run OCR pipeline (§5).
   d. INSERT into `receipt_lines` with `source = 'gmail'`, `source_email_id = message.id`.
   e. Run match pipeline (§6) — auto-confirm if confidence ≥ 0.92.
4. Log `agent_events` row: `domain='receipts'`, `action='gmail_scan'`, `meta={scanned, imported, skipped, errors}`.
5. Call `POST /api/harness/notifications-drain` to flush any digest alerts.

### Trust levels (domain-based)

| Domain pattern                               | Behaviour                                           |
| -------------------------------------------- | --------------------------------------------------- |
| `amazon.com`, `amazon.ca`                    | trusted — auto-import                               |
| `costco.ca`, `canadiantire.ca`, `staples.ca` | trusted — auto-import                               |
| Any `.gov` or `.gov.ca`                      | skip                                                |
| Everything else                              | review — import with `reconciled=false`, flag in UI |

Trust list stored in `harness_config` key `gmail_trusted_domains` (JSON array) and `gmail_skip_domains`. Editable without a deploy.

---

## 5 — OCR Pipeline

### Decision tree

```
attachment type?
  ├── PDF → Claude document API (haiku), returns JSON
  ├── image (jpg/png/webp/heic) →
  │     server-side sharp resize (max 2500px, quality 88)
  │     → attempt regex extraction (vendor, date, total, GST patterns)
  │     → if regex confidence < 0.7 → Claude Vision API (haiku)
  │     → returns JSON
  └── other (zip, doc, etc.) → skip
```

### Claude API call (haiku)

Model: `claude-haiku-4-5-20251001`  
Max tokens: 400  
System: structured JSON extraction prompt (vendor, date, gst, total_paid, suggested_category, line_items[]).

Fallback to `claude-sonnet-4-6` only if haiku returns a JSON parse error twice (retry on same image).

Record `ocr_model` on `receipt_lines`: `'haiku'`, `'sonnet'`, or `'regex'` (if regex extraction succeeded without Vision call).

### Amount tolerance tiers

| Receipt total | Tolerance   |
| ------------- | ----------- |
| ≤ $50         | ±$3.00 flat |
| $50.01 – $500 | ±10%        |
| > $500        | ±5%         |

These replace the Streamlit flat 15% tolerance (reduces false-positives on large-amount receipts).

---

## 6 — Reconciliation Engine

### Match scoring

`match_score(receipt, transaction)` → float 0.0–1.0 (higher = better):

```
base = amount_match_score(receipt.total, txn.amount, tolerance_tier)  # 0.0–0.6
date_delta = abs(receipt.receipt_date - txn.date).days
date_score = max(0, (10 - date_delta) / 10) * 0.3               # 0.0–0.3
vendor_score = vendor_overlap(receipt.vendor, txn.description) * 0.1  # 0.0–0.1
total = base + date_score + vendor_score
```

Auto-confirm threshold: ≥ 0.92 → `auto_confirmed=true`, `confirmed_by='system'`.
Human-review band: 0.70–0.91 → surfaced in Review Queue with confidence badge.
No-match: < 0.70 → shown as unmatched in Reconcile tab.

### Reconcile tab (UI spec)

Layout: month picker (default: current month) → two panels side by side.

**Left panel — Unmatched receipts** (reconciled=false):

- Table: Receipt Date, Vendor, Total, Category, Confidence badge, "Confirm Match" button
- Bulk auto-match button at top: runs match pipeline on all unmatched in current month, auto-confirms ≥0.92

**Right panel — Missing receipts** (transactions in bank_transactions with no matched receipt in date range):

- Table: Txn Date, Description, Amount, "Upload Receipt" button inline
- Upload triggers single-receipt upload flow, skips to match step for that txn

**Color coding** (same as Streamlit):

- 🟢 Matched (auto or manual)
- 🔴 Missing (bank txn, no receipt)
- 🟡 Unmatched (receipt exists, no bank txn within tolerance)
- ⚪ Personal (ignored, tagged as personal expense)

---

## 7 — Route Map

| Route                                  | Method | Purpose                                                      |
| -------------------------------------- | ------ | ------------------------------------------------------------ |
| `app/(cockpit)/receipts/page.tsx`      | GET    | 90-day receipt list, reconcile status inline                 |
| `app/(cockpit)/receipts/_components/`  | —      | UploadZone, ReceiptRow, ReconcilePanel, ReviewQueue          |
| `app/api/receipts/upload/route.ts`     | POST   | Single/batch file upload → OCR → insert                      |
| `app/api/receipts/gmail-scan/route.ts` | POST   | Cron-triggered Gmail scan (requireCronSecret)                |
| `app/api/receipts/match/route.ts`      | POST   | Run match on specific receipt_id                             |
| `app/api/receipts/confirm/route.ts`    | POST   | Confirm match (set auto_confirmed=true, confirmed_by='user') |

---

## 8 — Page Spec — `/receipts`

**Header:** "Receipts" + subtitle "90-day view · {N} unmatched · {reconciliation_rate}% auto-matched (7d)"

**Tabs:**

1. **All Receipts** — scrollable 90-day list, filter bar (vendor, category, match status, date range), CSV export
2. **Review Queue** — 3-panel: image preview / OCR data / top-3 match candidates with confidence badges. "Confirm" / "Skip" / "Mark Personal" buttons.
3. **Reconcile** — dual-panel (§6 above), month picker, bulk auto-match button
4. **Email Import** — "Scan Gmail Now" button (triggers `/api/receipts/gmail-scan` with cron secret), last scan timestamp, table of pending Email Invoices with import button per row

**Morning digest signal:** `{reconciliation_rate}% of receipts in last 7 days auto-matched ({unmatched_count} still open)`. Computed via `SELECT COUNT(*) FILTER (WHERE reconciled) * 100.0 / COUNT(*) FROM receipt_lines WHERE created_at > now() - interval '7 days'`.

---

## 9 — Migration Plan

Migration number to be claimed via `node scripts/next-migration-number.mjs` before authoring.

**Single migration file:**

1. `CREATE TABLE receipt_lines` (§3.1)
2. `CREATE TABLE receipt_matches` (§3.2, with FK condition on bank_transactions)
3. RLS policies
4. Grants (F24)

**No seed data.** Historical receipts from Streamlit/Sheets can be imported manually if Colin requests.

---

## 10 — Acceptance Criteria

| #     | Criterion                                                                             | How to verify                                                                                                   |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| AC-1  | `receipt_lines` table exists with all columns from §3.1                               | `SELECT column_name FROM information_schema.columns WHERE table_name='receipt_lines'`                           |
| AC-2  | `receipt_matches` table exists with all columns from §3.2                             | Same pattern                                                                                                    |
| AC-3  | UNIQUE constraint on `receipt_lines.source_email_id` prevents duplicate Gmail imports | INSERT two rows with same source_email_id → second INSERT fails with unique violation                           |
| AC-4  | Gmail scan route requires CRON_SECRET                                                 | `curl -X POST /api/receipts/gmail-scan` with no auth → 401 or 500 (not 200)                                     |
| AC-5  | Gmail scan route uses `requireCronSecret()` from `lib/auth/cron-secret.ts`            | `grep -r "requireCronSecret" app/api/receipts/gmail-scan/` — must match                                         |
| AC-6  | OCR uses `claude-haiku-4-5-20251001` by default                                       | `grep -r "haiku" app/api/receipts/` — model string present in upload route                                      |
| AC-7  | Upload single receipt → OCR runs → row appears in `receipt_lines`                     | E2E: upload test JPEG → `SELECT * FROM receipt_lines ORDER BY created_at DESC LIMIT 1` → vendor/total populated |
| AC-8  | `/receipts` page loads without error in production                                    | Puppeteer navigate → no console errors, 90-day list renders                                                     |
| AC-9  | `match_confidence` column populates on auto-match                                     | After upload of known receipt → `SELECT match_confidence FROM receipt_matches` → non-null value                 |
| AC-10 | RLS blocks anon reads                                                                 | `SELECT * FROM receipt_lines` with anon key → 0 rows returned                                                   |
| AC-11 | No `style={}` attributes in TSX files                                                 | `grep -r "style={" app/(cockpit)/receipts/` → 0 matches (F20)                                                   |
| AC-12 | `receipt_lines` migration includes GRANT block                                        | `grep -A2 "GRANT" supabase/migrations/<migration_file>` → service_role grant present (F24)                      |
| AC-13 | Morning digest surfacing path exists                                                  | `app/api/morning-digest/route.ts` (or equivalent) includes reconciliation_rate query                            |

---

## 11 — Out of Scope (this chunk)

- Camera upload UI (schema supports it via `source='camera'` but no camera route or UI)
- HEIC conversion (Sharp is planned; omit if it adds >1 day to build)
- Historical receipt import from Google Sheets
- Hubdoc Archive tab (omit for v1)
- PDF multi-page extraction (single-page only for v1)
- Bookkeeper export CSV (can be a follow-up ticket)

---

## 12 — Pre-Build Checklist (for builder)

Before writing any code, builder must:

1. Verify `bank_transactions` table exists: `SELECT table_name FROM information_schema.tables WHERE table_name='bank_transactions'` — if absent, use `text` for FK column with migration note
2. Verify `lib/auth/cron-secret.ts` exists and exports `requireCronSecret`: `grep -r "requireCronSecret" lib/auth/cron-secret.ts`
3. Verify Vercel cron config file path: `vercel.json` or `next.config.ts` crons section — check existing pattern before adding new cron
4. Claim migration number: `node scripts/next-migration-number.mjs`
5. Verify no `/receipts` route already exists: `ls app/(cockpit)/receipts/` — should be absent

---

## 13 — F17/F18/F19 Compliance

**F17 — Behavioral ingestion:** Receipt vendor + category pairs inserted to `knowledge` table on each OCR confirm. `entity = vendor`, `content = "{vendor} purchases are categorized as {category}"`. Feeds the twin's expense-pattern knowledge.

**F18 — Measurement + benchmark:**

- Metric: 7-day rolling reconciliation rate (`reconciled_count / total_count`)
- Benchmark: ≥95% auto-matched within 7 days (Colin target from T-003 spec)
- Surface: `/receipts` page header + `morning_digest` signal
- Agent events: `domain='receipts'`, `action='gmail_scan'` logs `{scanned, imported, matched, unmatched}`

**F19 — Continuous improvement:** % improvement over Streamlit baseline logged to `agent_events` after first full week of production data. Baseline: Streamlit reconciliation rate unknown (not measured). Week 1 LepiOS rate = first data point; subsequent weeks benchmarked against it.
