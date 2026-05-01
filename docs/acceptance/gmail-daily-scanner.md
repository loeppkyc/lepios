# Acceptance Doc — Gmail Daily Scanner

Component: #7 · Weight: 8 · Current: 0%
Date: 2026-04-30
Branch: feature/gmail-daily-scanner

---

## Component

\#7 Gmail daily scanner — weight 8, currently 0%

---

## Grounding

The existing `app/api/cron/gmail-scan/route.ts` (on main) already ships the scanner
infrastructure — auth, scan, dedup, insert. It currently calls **statement-arrivals only**.

The invoice + receipt classifiers live on `feature/gmail-classifiers-week1-v2` (PR #40,
open). This PR extends the existing cron route to call those classifiers once PR #40 merges.

Verified on main:

- `lib/gmail/client.ts` — OAuth client, `GmailNotConfiguredError`
- `lib/gmail/scan.ts` — `scanMessages`, `filterNewMessages`, `insertMessages`
- `lib/gmail/classifiers/statement-arrivals.ts` — only existing classifier
- `supabase/migrations/0022_add_gmail_tables.sql` — `gmail_known_senders`, `gmail_messages`
- `vercel.json` cron: `/api/cron/gmail-scan` at `"0 6 * * *"` (daily 06:00 UTC, midnight MT)

On PR #40 (not yet on main):

- `lib/gmail/classifiers/invoice.ts` — `classifyInvoice`, `insertInvoiceClassifications`
- `lib/gmail/classifiers/receipt.ts` — `classifyReceipt`, `insertReceiptClassifications`
- `lib/gmail/classifiers/learn-senders.ts` — `learnSenderDomains`
- `lib/gmail/classifiers/types.ts` — `KnownSender { trust_level, sender_type }`
- `supabase/migrations/0055_gmail_classifiers.sql` — `gmail_invoice_classifications`, `gmail_receipt_classifications`

**Merge-order dependency:** This PR cannot ship before PR #40 merges. The builder must
confirm PR #40 is on main before creating the feature branch off main.

---

## Scope

- Extend `app/api/cron/gmail-scan/route.ts` to call `classifyInvoice` and `classifyReceipt`
  alongside the existing `classifyStatementArrival`
- Replace the hardcoded 25h lookback with a watermark derived from `gmail_daily_scan_runs`
  (see Open Questions below for the decision)
- Add `gmail_daily_scan_runs` table (migration 0058) — one row per cron run, audit log
- Schedule stays at `"0 6 * * *"` (06:00 UTC, midnight MT) — no change in this PR
- Upgrade knownSenders load: existing route passes `Set<string>` to statement-arrivals;
  new route loads full rows (email_address, trust_level, sender_type) and passes
  `Map<string, KnownSender>` to invoice + receipt classifiers (compatible with their interface)

---

## Out of Scope (this PR)

- OAuth env wiring (component #6, separate PR) — scanner handles `GmailNotConfiguredError`
  gracefully and is inert without credentials
- UI surfacing of scan results — `gmail_daily_scan_runs` is queryable but no page yet
- Sender-domain learning loop tuning — `learnSenderDomains` exists on PR #40 but calling it
  automatically on every cron run is deferred (adds noise until sender list stabilizes)
- Statement-arrivals classifier changes — existing logic unchanged in this PR

---

## Acceptance Criteria

### AC-1: Route response codes

- Returns 200 on success (messages scanned, classified, run row written with `status='ok'`)
- Returns 200 on `GmailNotConfiguredError` (writes run row with `status='skipped_unconfigured'`,
  no scan performed)
- Returns 200 on any Gmail API error mid-scan (writes run row with `status='error'`)
- Returns 500 only on unexpected errors outside the main try/catch
  (infrastructure failures: DB unreachable, migration not applied)

### AC-2: Idempotency

- Running twice within the same UTC day classifies zero new messages on the second run
- `filterNewMessages` deduplicates against `gmail_messages.message_id` — no re-insert
- `gmail_invoice_classifications` and `gmail_receipt_classifications` upsert on conflict
  (`onConflict: 'message_id', ignoreDuplicates: true`) — idempotent by schema
- Second run writes a new `gmail_daily_scan_runs` row (run log is append-only)

### AC-3: Migration 0058 — `gmail_daily_scan_runs`

```sql
CREATE TABLE public.gmail_daily_scan_runs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,              -- null until run completes
  status               text        NOT NULL
                                   CHECK (status IN ('ok', 'skipped_unconfigured', 'error')),
  messages_fetched     int         NOT NULL DEFAULT 0,
  messages_new         int         NOT NULL DEFAULT 0,
  invoices_classified  int         NOT NULL DEFAULT 0,
  receipts_classified  int         NOT NULL DEFAULT 0,
  statements_classified int        NOT NULL DEFAULT 0,
  errors_count         int         NOT NULL DEFAULT 0,
  error_summary        text        -- null on success; first error message on failure
);

CREATE INDEX gmail_daily_scan_runs_started_at_idx
  ON public.gmail_daily_scan_runs (started_at DESC);

ALTER TABLE public.gmail_daily_scan_runs ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS, no user-facing reads yet
```

RLS enabled, no policies — matches the post-migration-0050 service_role-only pattern.

### AC-4: Watermark logic

- On each run, query: `SELECT MAX(finished_at) FROM gmail_daily_scan_runs WHERE status='ok'`
- If result is non-null: use it as `afterDate` (scan from last successful completion)
- If null (first-ever run): fall back to `NOW() - INTERVAL '25 hours'`
- Rationale: first run covers the prior 25h; subsequent runs are incremental from last success

### AC-5: knownSenders upgrade

- Load from `gmail_known_senders` WHERE `trust_level != 'ignore'`, select
  `email_address, trust_level, sender_type`
- Build `Map<string, KnownSender>` keyed by `email_address`
- Pass this Map to `classifyInvoice` and `classifyReceipt` (matches their function signatures)
- Pass `new Set(knownSendersMap.keys())` to `classifyStatementArrival` (unchanged interface)

### AC-6: Classifier execution order

Per message (for each `newMessage`):

1. `classifyStatementArrival(msg, knownSendersSet)` — sync, no Gmail API call
2. `classifyInvoice(msg, service, knownSendersMap)` — async, may re-fetch full message
3. `classifyReceipt(msg, service, knownSendersMap)` — async, may re-fetch full message

Run classifiers in parallel per message via `Promise.allSettled` — partial failure (one
classifier throws) must not drop the other two results. Log each individual classifier error
to `errors_count`/`error_summary` in the run row.

### AC-7: Tests (`tests/api/gmail-scan.test.ts`)

All Gmail API calls and DB calls mocked.

| Test                      | Expected outcome                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Configured success path   | Route returns 200, run row has `status='ok'`, correct counts                                        |
| Unconfigured skip path    | `GmailNotConfiguredError` caught, 200, run row `status='skipped_unconfigured'`, counts=0            |
| Partial-failure path      | One classifier throws per message; other classifiers still run; `errors_count > 0`, route still 200 |
| Idempotent re-run         | `filterNewMessages` returns empty; invoice/receipt inserts not called; run row has 0 new            |
| Watermark: first run      | No prior `status='ok'` row → `afterDate` = 25h ago                                                  |
| Watermark: subsequent run | Prior `status='ok'` row at T → `afterDate` = T                                                      |

Existing tests in `tests/gmail-scanner.test.ts` must remain green — this PR does not touch
statement-arrivals logic.

### AC-8: F17 — Behavioral ingestion signal

- `classifyInvoice` results: invoice detected from trusted vendor = B2B expense activity signal
- `classifyReceipt` results: receipt from known inline sender = consumer spend activity signal
- Both feed the path probability engine as financial-activity signals alongside existing
  `gmail.scan` events
- Declare in route: `// F17: invoice/receipt classifications = financial-activity signals
for behavioral ingestion`

### AC-9: F18 — Measurement

| Metric                      | Source                                                | Benchmark                                    |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| Run latency                 | `finished_at - started_at` in `gmail_daily_scan_runs` | < 60s for 500 messages                       |
| Messages fetched per run    | `messages_fetched`                                    | Baseline: first week establishes daily count |
| New vs dedup rate           | `messages_new / messages_fetched`                     | < 10% new after first 7 days                 |
| Invoices classified per run | `invoices_classified`                                 | Alert if 0 for 14 consecutive days           |
| Receipts classified per run | `receipts_classified`                                 | Alert if 0 for 14 consecutive days           |
| Error rate                  | `errors_count / messages_new`                         | 0 at steady state; alert > 5%                |

**Surfacing query** (for future status page or `morning_digest`):

```sql
SELECT
  started_at::date          AS run_date,
  status,
  messages_fetched,
  messages_new,
  invoices_classified,
  receipts_classified,
  statements_classified,
  errors_count,
  EXTRACT(EPOCH FROM (finished_at - started_at))::int AS duration_sec
FROM gmail_daily_scan_runs
ORDER BY started_at DESC
LIMIT 14;
```

---

## Open Questions (resolved)

### Q1: Watermark source

**Resolved: derive from `gmail_daily_scan_runs`.**
`MAX(finished_at) WHERE status='ok'` is a single query, avoids a second source of truth,
and keeps all run state in one table. The 25h fallback covers the first-ever run.

### Q2: Cron secret

**Resolved: reuse `CRON_SECRET`** — same env var used by all other cron routes in this
codebase. No separate secret needed. Merge-order note: the auth-fail-closed PR (#38) changed
the 401 path; confirm PR #38 is merged before this PR ships so the auth helper is current.

### Q3: Cron schedule

**Closed: schedule change deferred to separate PR.**
Existing `"0 6 * * *"` (06:00 UTC, midnight MT) stays. `vercel.json` is not touched in this PR.

---

## Files Changed

```
app/api/cron/gmail-scan/route.ts          — extend to call invoice + receipt classifiers
supabase/migrations/0058_gmail_daily_scan_runs.sql  — new audit table
tests/api/gmail-scan.test.ts              — new test file (6 tests above)
```

No new files in `lib/gmail/` — all classifier functions come from PR #40.

---

## Builder Notes

1. **Do not create this branch until PR #40 is on main.** The `classifyInvoice`,
   `classifyReceipt`, and `learnSenderDomains` imports will not resolve otherwise.
2. Migration 0058 must be applied to Supabase before the cron runs. Verify with
   `SELECT table_name FROM information_schema.tables WHERE table_name = 'gmail_daily_scan_runs'`
   after applying.
3. The existing `tests/gmail-scanner.test.ts` covers the statement-arrivals path — do not
   modify those tests; new tests go in a separate file.
4. `Promise.allSettled` for parallel classifier execution: collect fulfilled values for
   insertion, log rejected values to `errors_count`/`error_summary` in the run row.
5. `error_summary` stores only the first error message (truncated to 500 chars). Do not
   store PII from email content.
6. The `knownSenders` Map must be built with the full row before the message loop —
   one DB query per cron run, not per message.
