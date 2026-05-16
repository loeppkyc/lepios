# Acceptance Doc — Chunk D: QBO April Close + Reconcile UI

**Sprint:** 7
**Prepared:** 2026-05-15
**Status:** awaiting_builder_assignment
**Migration:** 0212

---

## Phase 1a — Codebase Study

### What already exists

The reconcile pipeline is substantially built. This is NOT a 20% stub — the bulk of the
work is done. What exists:

**`/bookkeeping/reconcile` page + `ReconcilePage.tsx` (full, ~680 lines):**

- Fetches `/api/bookkeeping/reconcile` → `{pending, accounts, totalNeedsReview}`
- Renders one card per `pending_transactions` row where `status='needs_review'`
- Each card shows: date, description, source_account, amount, matched_rule_name, confidence score
- Editable fields per row: expense_account (select from chart_of_accounts), GST rate (0/5/13%), business_use_pct
- "Learn rule" checkbox + pattern input → creates `vendor_rules` row on approve
- Approve → POST `/api/bookkeeping/reconcile/approve` → creates JE + marks txn `approved`
- Reject → POST `/api/bookkeeping/reconcile/reject` with reason → marks txn `rejected`
- Flash feedback per row; refetch on approve/reject with 600ms delay

**`GET /api/bookkeeping/reconcile`:**

- Reads `pending_transactions` WHERE `status='needs_review'`, ORDER BY `txn_date DESC`
- Joins `vendor_rules` to resolve `matched_rule_name` from `matched_rule_id`
- Reads `chart_of_accounts` WHERE `is_active=true` AND `qb_type IN (Expenses, COGS, Other Current Assets, Income, Other Current Liabilities)`
- Returns `{pending:[], accounts:[], totalNeedsReview:N}`

**`/bookkeeping/qb-export` page + route (full, working):**

- `GET /api/bookkeeping/qb-export` → JSON summary of unexported JEs
- `GET /api/bookkeeping/qb-export?format=csv` → QBO-format CSV download
- `POST /api/bookkeeping/qb-export/mark` → marks JEs as exported
- Date range and `include_exported` filters supported
- Fully functional — not a stub

**Underlying tables confirmed referenced:**

- `pending_transactions` — `id, txn_date, source_account, description, amount_signed, vendor_extracted, suggested_expense_account, suggested_gst_rate, suggested_business_use_pct, confidence, matched_rule_id, status`
- `vendor_rules` — `id, rule_name, match_pattern, match_type`
- `chart_of_accounts` — `full_name, qb_type, is_active`
- `journal_entries` — `id, je_number, je_date, name, description, total_debit, total_credit, exported_to_qb_at, source`
- `journal_entry_lines` — `journal_entry_id, line_no, account_full_name, description, debit, credit`

**Note on table provenance:** These tables are referenced in live route code but their CREATE
statements were not found in the `supabase/migrations/` files examined. They either exist in
the Supabase project (applied out of band) or in seed.sql. Builder must confirm table existence
via `SELECT table_name FROM information_schema.tables WHERE table_schema='public'` before
writing any new SQL targeting these tables. Do NOT create them if they exist.

### What is actually missing (the real 20% gap)

The UI and approve/reject flow are complete. The two genuine gaps are:

1. **Bulk-approve button** — no way to approve multiple high-confidence rows in one click.
   The reconcile queue for April could have 100+ transactions. Row-by-row is the bottleneck.

2. **Ingestion trigger** — the `ReconcilePage` has no way to initiate April CSV ingestion.
   The task brief confirms CSV ingestion is a CLI script (`scripts/bookkeeping/match-amazon-settlements.py`
   and `scripts/bookkeeping/parse-td-pdf.py` exist; `ingest-bank-csv.py` is absent — builder
   must verify what the actual ingest entrypoint is). The UI does NOT need to handle CSV upload.
   However, it should surface a "Last ingested" timestamp or row count so Colin knows whether
   April data has been loaded before he tries to review.

3. **Reconcile progress summary** — the page shows total `needs_review` count but not the
   breakdown: how many approved, how many rejected, how many remaining. This is the one piece
   of information Colin checks first when deciding whether to keep reviewing.

---

## Phase 1b — Resolved Ambiguities

| Question                                     | Decision                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the reconcile UI a stub?                  | No — the full review flow (approve/reject/learn rule) is implemented. Gap is bulk-approve and progress context.                                                                                 |
| Does qb-export need building?                | No — fully functional. Out of scope for this chunk.                                                                                                                                             |
| Is CSV ingestion in scope for the UI?        | No. Colin ingests via CLI. UI needs a data-freshness signal only.                                                                                                                               |
| Which tables need migration 0212?            | Only: add `bulk_approved_at` and `bulk_approved_count` columns to `pending_transactions` tracking for F18. Actually: simpler — log to `agent_events` on bulk approval. No schema change needed. |
| Migration 0212 purpose?                      | Add `ingest_runs` table (one row per CLI ingest run) so the UI can show "Last ingested: May 12, 2026 — 47 rows added". This is the freshness signal the UI is missing.                          |
| Which confidence threshold for bulk-approve? | ≥85 confidence score. Below 85 stays in the queue for manual review.                                                                                                                            |

---

## Phase 1c — ≥20% Better

| Area          | Current gap                                                 | LepiOS improvement                                                                 |
| ------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Throughput    | One-by-one review on 100+ transactions = multi-hour session | Bulk-approve button for rows ≥85 confidence → clears the queue in one click        |
| Freshness     | No signal about whether April data is ingested              | Ingest run log (`ingest_runs` table) — UI shows "Last ingested: {date} — {N} rows" |
| Progress      | Shows totalNeedsReview count only                           | Progress bar: Approved / Rejected / Remaining with total                           |
| Bulk feedback | N/A                                                         | Bulk-approve shows "Approved {N} transactions, {M} JEs created"                    |

---

## Phase 1d — Acceptance Criteria

### Pre-build checks (coordinator runs before handing to builder)

```sql
-- 1. Confirm pending_transactions exists
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name='pending_transactions';

-- 2. Confirm chart_of_accounts, vendor_rules, journal_entries exist
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
AND table_name IN ('chart_of_accounts','vendor_rules','journal_entries','journal_entry_lines');

-- 3. Confirm ingest_runs does NOT yet exist
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name='ingest_runs';

-- 4. Verify pending_transactions columns match what the route expects
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='pending_transactions'
ORDER BY ordinal_position;
```

---

### Migration 0212 — `0212_bookkeeping_ingest_runs.sql`

```sql
-- 0212_bookkeeping_ingest_runs.sql
-- Adds ingest_runs table: one row per CLI bookkeeping ingest execution.
-- Enables the reconcile UI to surface "Last ingested: {date} — {N} rows loaded."
-- Written by the ingest CLI script (or manually) via service_role.

CREATE TABLE IF NOT EXISTS public.ingest_runs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          timestamptz  NOT NULL DEFAULT now(),
  source          text         NOT NULL,   -- 'td_pdf' | 'csv' | 'amazon_match' | 'manual'
  rows_added      integer      NOT NULL DEFAULT 0,
  rows_skipped    integer      NOT NULL DEFAULT 0,
  period_start    date,
  period_end      date,
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_runs_run_at_idx ON public.ingest_runs (run_at DESC);
CREATE INDEX IF NOT EXISTS ingest_runs_source_idx ON public.ingest_runs (source, run_at DESC);

ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingest_runs_service_rw ON public.ingest_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY ingest_runs_authenticated_read ON public.ingest_runs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.ingest_runs TO service_role;

COMMENT ON TABLE public.ingest_runs IS
  'One row per CLI bookkeeping ingest execution. Enables the /bookkeeping/reconcile UI to '
  'surface data freshness: "Last ingested: {date} — {N} rows." Written by the ingest script '
  'via service_role. source values: td_pdf, csv, amazon_match, manual.';
```

---

### New Route

| Route                                     | Method | Auth | Purpose                                                                           |
| ----------------------------------------- | ------ | ---- | --------------------------------------------------------------------------------- |
| `/api/bookkeeping/reconcile/bulk-approve` | POST   | user | Approve all `pending_transactions` WHERE `confidence >= threshold` in one request |
| `/api/bookkeeping/ingest-runs`            | GET    | user | Last 5 ingest runs (for UI freshness display)                                     |

**`POST /api/bookkeeping/reconcile/bulk-approve`**

Request body:

```json
{
  "confidence_threshold": 85
}
```

Response:

```json
{
  "approved": 12,
  "jes_created": 12,
  "errors": []
}
```

Logic:

1. Fetch all `pending_transactions` WHERE `status='needs_review'` AND `confidence >= threshold` AND `suggested_expense_account IS NOT NULL`
2. For each: call the same approve logic as the single-row endpoint (create JE + lines, mark `approved`)
3. Log to `agent_events`: `action='bulk_approve', meta={count, threshold, jes_created}`
4. Return summary

**`GET /api/bookkeeping/ingest-runs`**

Returns last 5 ingest_runs rows ordered by `run_at DESC`. UI renders as: "Last ingested: May 12, 2026 — 47 rows" beneath the page header.

---

### UI Changes

**`app/(cockpit)/bookkeeping/reconcile/_components/ReconcilePage.tsx`**

Three additions to the existing component:

**1. Progress summary bar** — added below the page header:

```
Approved: 23 · Rejected: 5 · Remaining: 47
```

Reads from a count query via the existing `/api/bookkeeping/reconcile` route (add `approvedCount` and `rejectedCount` to the `ReconcileQueue` response shape).

**2. Last ingested banner** — below the progress bar:

```
Last ingested: May 12, 2026 — 47 rows loaded  [source: td_pdf]
```

Fetches from new `/api/bookkeeping/ingest-runs`. Shows "No ingestion data yet — run the CLI script first" if empty.

**3. Bulk-approve button** — in the page header row, next to "Refresh":

```
[Bulk Approve ≥85% confidence]
```

Disabled when there are 0 eligible rows. On click: `POST /api/bookkeeping/reconcile/bulk-approve`, shows modal confirmation: "Approve {N} transactions automatically? This cannot be undone." On confirm: shows "Approved {N} transactions" flash and reloads queue.

No `style={}` in any new TSX. Use LepiOS CSS vars via the existing `s` style-object pattern already used in `ReconcilePage.tsx`.

**`GET /api/bookkeeping/reconcile` response shape change:**

Add three fields to `ReconcileQueue`:

```typescript
interface ReconcileQueue {
  pending: PendingTxn[]
  accounts: AccountOption[]
  totalNeedsReview: number
  // NEW:
  approvedCount: number
  rejectedCount: number
  bulkEligibleCount: number // rows with confidence >= 85 AND suggested_expense_account IS NOT NULL
}
```

Compute via a single additional query:

```sql
SELECT
  COUNT(*) FILTER (WHERE status='approved') AS approved_count,
  COUNT(*) FILTER (WHERE status='rejected') AS rejected_count,
  COUNT(*) FILTER (WHERE status='needs_review' AND confidence >= 85 AND suggested_expense_account IS NOT NULL) AS bulk_eligible
FROM pending_transactions;
```

---

### Acceptance Tests

**AC-1 — Progress summary present**

- `GET /bookkeeping/reconcile` renders without JS errors
- Page shows "Approved: N · Rejected: N · Remaining: N" header row

**AC-2 — Bulk-approve flow**

- Insert 3 test `pending_transactions` rows WHERE `status='needs_review'`, `confidence=90`, `suggested_expense_account='Office Supplies'`
- `POST /api/bookkeeping/reconcile/bulk-approve` `{confidence_threshold:85}` → 200, `{approved:3, jes_created:3}`
- Verify: 3 rows now have `status='approved'` in `pending_transactions`
- Verify: 3 rows in `journal_entries` with matching `je_date`
- Cleanup test rows

**AC-3 — Ingest runs freshness**

- Insert test row: `INSERT INTO ingest_runs (source, rows_added, period_start, period_end) VALUES ('td_pdf', 47, '2026-04-01', '2026-04-30')`
- `GET /api/bookkeeping/ingest-runs` → 200, array with that row
- UI renders: "Last ingested: [date] — 47 rows loaded [source: td_pdf]"
- Cleanup

**AC-4 — Quality gates**

- `grep -r 'style=' app/(cockpit)/bookkeeping/reconcile/_components/ReconcilePage.tsx` — new code must use the existing `s.` style object pattern, NOT new `style={}` inline attributes (F20)
- Migration 0212 includes F24 grants for `ingest_runs`
- Bulk-approve route uses `createServiceClient()` for writes, `createClient()` for auth check

**AC-5 — F18 observability**

- After bulk-approve: `SELECT * FROM agent_events WHERE action='bulk_approve' ORDER BY occurred_at DESC LIMIT 1` returns a row with `meta.count >= 1`

---

## GitHub Prior Art Check (Architecture §8.4)

| Problem                     | Decision                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bulk transaction processing | **Build-new** — existing approve route handles one row; wrap it in a loop at the route layer. No npm package. |
| Progress counters           | **Beef-up** — add counts to existing reconcile route query.                                                   |
| Ingest run tracking         | **Build-new** — `ingest_runs` table. Lightweight; no external dependency.                                     |

---

## F17 Connection (Behavioral Ingestion)

The bookkeeping approval pipeline is the ground truth for Colin's business expense
categorization. Each approved JE feeds the Life P&L system. Bulk-approve unblocks monthly
close, which unblocks QBO sync, which is the financial data backbone for behavioral signals
(spending patterns, GST capture rate, business vs personal ratio over time).

The `ingest_runs` table creates a timestamp anchor for data freshness — future behavioral
analysis can correlate "time since last ingest" with Colin's review behavior patterns.

---

## F18 Measurement

| Metric             | Unit                        | Source                                                | Baseline / Target                               |
| ------------------ | --------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Queue depth        | count                       | `pending_transactions` WHERE `status='needs_review'`  | April open: 100+; target: 0 after close session |
| Bulk-approve rate  | % of queue cleared via bulk | `agent_events` WHERE `action='bulk_approve'`          | Target ≥60% of queue per session                |
| Manual review rate | count/session               | `agent_events` WHERE `action='approve'` (single)      | Tracks proportion needing Colin judgment        |
| Time-to-close      | days                        | `ingest_runs.run_at` to last `approved` txn in period | Target: ≤3 days from ingest to close            |
| Ingest frequency   | runs/month                  | `ingest_runs` count                                   | Target: ≥2/month (payroll, bank)                |

---

## Out of Scope

- CSV upload UI — ingestion remains CLI-only; the `parse-td-pdf.py` and `match-amazon-settlements.py` scripts are out of scope for this chunk
- QBO push integration (auto-publish JEs to QBO via API) — the export is CSV download only; live QBO write API is a future sprint
- Editing `chart_of_accounts` rows from the reconcile UI
- Multi-user / profiles FK (marked SPRINT5-GATE in the existing code)

---

## Grounding Checkpoint

Colin runs in the browser after builder ships:

1. Navigate to `/bookkeeping/reconcile`
2. Confirm the progress summary row is visible: "Approved: N · Rejected: N · Remaining: N"
3. Confirm bulk-approve button is visible if any rows have confidence ≥85
4. Click bulk-approve on a test batch — confirm the confirmation modal appears and the queue shrinks after confirm
5. Confirm "Last ingested" banner (may show "No ingestion data yet" if no ingest_runs rows — that is correct behavior)

Pass criterion: steps 1–4 complete without JS errors; counts are consistent with what is in the database.

---

## Open Questions

None. The existing code is well-structured and the gaps are well-defined from direct study.

---

## Files Expected to Change

- `app/(cockpit)/bookkeeping/reconcile/_components/ReconcilePage.tsx` — add progress bar, bulk-approve button, last-ingested banner
- `app/api/bookkeeping/reconcile/route.ts` — add `approvedCount`, `rejectedCount`, `bulkEligibleCount` to response
- `app/api/bookkeeping/reconcile/bulk-approve/route.ts` — new file
- `app/api/bookkeeping/ingest-runs/route.ts` — new file
- `supabase/migrations/0212_bookkeeping_ingest_runs.sql` — new file
