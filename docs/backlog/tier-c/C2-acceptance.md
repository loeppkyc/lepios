# C2 — Statement Coverage Grid v2: Gmail-Based Coverage

**Coordinator:** Phase 1d
**Date:** 2026-05-17
**Study doc:** `docs/sprint-4/chunk-d-v2-streamlit-study.md`
**Prior coordinator task:** `b362b865-5cf7-4f81-ba24-4ded0b6d10b3` (study + Colin Q&A April 2026)
**Colin answers (2026-05-17 via Telegram text):**
- Q1 & Q4: All statement notification emails go to `loeppkycolin@gmail.com`
- Q2: Amex Business Platinum, Amex Bonvoy, TD Bank, TD Visa, TD USD all have different sender domains
- Q3: Statement for month M arrives in the following month (M+1) — coverage rule: `arrival_month - 1 = covered_month`

---

## Scope

Two coordinated changes shipped in one PR:

**A — STATEMENT_ACCOUNTS fix** (`lib/gmail/classifiers/statement-arrivals.ts`): Replace the 3 placeholder accounts (TD Chequing, RBC Visa, AMEX) with the 7 real business accounts. Add exclusion patterns to prevent false positives from IB/Newton/AWS "statement" emails.

**B — Route.ts rewrite** (`app/api/business-review/statement-coverage/route.ts`): Replace Dropbox file-presence logic with `gmail_statement_arrivals` Supabase query. Keep the same `StatementCoverageResponse` shape so the component (`StatementCoverageGrid.tsx`) requires no changes.

**C — False-positive data cleanup** (migration): DELETE the 10 false positive rows currently in `gmail_statement_arrivals` (classified by the placeholder accounts).

**Acceptance criterion:** `/api/business-review/statement-coverage` returns 7 accounts (Capital One absent), with TD Bank April 2026 showing `filed` (based on the May 5 and May 9 TD eStatement emails already in the DB), and Amex March 2026 showing `filed` (based on the May 2 Amex email already in the DB).

---

## Out of Scope

- Statement period extraction from email subject/body (deferred — `statement_period_start/end` stay null in `gmail_statement_arrivals`)
- Adding a missing-statement warning banner (deferred to v3)
- Backfilling 2025 coverage from Dropbox (2025 band uses manual overrides only)
- Attachment filename hydration (deferred)
- CIBC and Canadian Tire CC have no statement notification emails in Gmail — these accounts show `pending`/`missing` via manual-override-only path (same as 2025 band)

---

## Files Expected to Change

```
lib/gmail/classifiers/statement-arrivals.ts  — STATEMENT_ACCOUNTS rewrite
app/api/business-review/statement-coverage/route.ts  — Dropbox → Supabase
supabase/migrations/XXXX_cleanup_false_positive_statement_arrivals.sql  — DELETE false positives
tests/gmail-scanner.test.ts  — update tests for new account config
tests/statement-coverage.test.ts  — update tests for Supabase-based route (if exists)
```

No component changes. `StatementCoverageGrid.tsx` and the override route are untouched.

---

## Part A — STATEMENT_ACCOUNTS Rewrite

### Builder step 1: Discover sender domains

Before writing the config, run this query to confirm actual FROM addresses:

```sql
SELECT from_address, subject, COUNT(*) as cnt 
FROM gmail_messages 
WHERE lower(subject) LIKE '%statement%' OR lower(subject) LIKE '%e-statement%'
GROUP BY from_address, subject 
ORDER BY cnt DESC LIMIT 30;
```

As of 2026-05-17, the DB confirms:
- `alerts@td.com` — "TD Bank - Your Online Banking Statement Is Available" → **TD Bank (chequing)**
- `TD.eStatementNoReplyAccount@td.com` — "Your TD statement is now available" → **TD family (chequing/visa/usd)**
- `AmericanExpress@welcome.americanexpress.com` — "Your American Express Online Statement is Now Ready" → **Amex (BP or Bonvoy)**

### STATEMENT_ACCOUNTS spec

Replace the entire `STATEMENT_ACCOUNTS` array with:

```typescript
const STATEMENT_ACCOUNTS: StatementArrivalAccount[] = [
  {
    account_name: 'TD Chequing',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td bank.*online banking statement/i,
      /td bank.*statement.*available/i,
      /your td.*statement.*available/i,
      /td.*chequing.*statement/i,
    ],
  },
  {
    account_name: 'Amex Business',
    sender_domains: ['americanexpress.com', 'welcome.americanexpress.com'],
    subject_patterns: [
      /american express.*online statement/i,
      /your.*amex.*statement/i,
      /american express.*statement.*ready/i,
    ],
  },
  {
    account_name: 'Amex Bonvoy',
    sender_domains: ['americanexpress.com', 'welcome.americanexpress.com'],
    subject_patterns: [
      /bonvoy.*statement/i,
      /marriott.*statement/i,
      /amex.*bonvoy.*statement/i,
    ],
  },
  {
    account_name: 'TD Visa',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td.*visa.*statement/i,
      /aeroplan.*visa.*statement/i,
      /td.*visa.*available/i,
    ],
  },
  {
    account_name: 'TD USD Chequing',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td.*usd.*statement/i,
      /td.*us dollar.*statement/i,
      /td.*foreign.*statement/i,
    ],
  },
  // CIBC and Canadian Tire CC: no email statement notification detected in DB.
  // These accounts use manual overrides only (Colin marks cells via the UI).
]
```

**EXCLUSION rule (add before the account loop):**
```typescript
// Exclude known non-bank statement senders
const EXCLUDED_SENDERS = [
  'interactivebrokers.com',  // IB daily activity statements
  'newton.co',               // Newton crypto statements
  'aws.com',                 // AWS billing
  'invoicing@aws.com',
]

const fromLower = message.fromAddress.toLowerCase()
if (EXCLUDED_SENDERS.some(s => fromLower.includes(s))) return null
```

**Note on ambiguity:** If "Your TD statement is now available" from `TD.eStatementNoReplyAccount@td.com` doesn't match TD Chequing's subject_patterns, it will still be classified as `medium` confidence under whichever TD account's patterns fire first. Builder should check the actual email subject against the patterns above and refine if needed.

---

## Part B — Route.ts Rewrite

### New route logic

Keep the same exported types (`StatementCoverageResponse`, `CoverageStatus`). Replace the Dropbox auth + folder listing with a Supabase query.

**Account list** (hardcoded, order is display order):

```typescript
const STATEMENT_GRID_ACCOUNTS = [
  { key: 'td_bank',     label: 'TD Bank',           account_names: ['TD Chequing'] },
  { key: 'amex',        label: 'Amex',              account_names: ['Amex Business'] },
  { key: 'amex_bonvoy', label: 'Amex Bonvoy',       account_names: ['Amex Bonvoy'] },
  { key: 'cibc',        label: 'CIBC',              account_names: [] },  // no email notifications
  { key: 'ct_card',     label: 'Canadian Tire CC',  account_names: [] },  // no email notifications
  { key: 'td_visa',     label: 'TD Visa',           account_names: ['TD Visa'] },
  { key: 'td_usd',      label: 'TD USD Chequing',   account_names: ['TD USD Chequing'] },
]
// Capital One is intentionally absent — filtered out per Colin 2026-04-24
```

**Coverage rule:** `arrival_date` in month M → covered month M-1 (statement for prior month arrives in current month). 

**Bands:** 2025 (Jan–Dec) + 2026 (Jan–Dec current year). For 2025, no `gmail_statement_arrivals` data exists — cells can only be `filed_override` or `missing`/`pending`.

**Algorithm:**
1. Fetch all `gmail_statement_arrivals` rows (no date filter — all historical data)
2. For each row: `covered_year_month = arrival_date minus 1 month`
3. Build `coverage[account_key][YYYY-MM] = 'filed'` for each matching arrival
4. Load `statement_coverage_overrides` (keep existing logic)
5. Apply `NO_ACTIVITY` overrides (keep existing map)
6. For unfilled cells: `cellStatus(...)` for pending vs missing

**Remove:** all Dropbox-related code (`getDropboxAccessToken`, `listFolderPdfs`, `DROPBOX_APP_KEY` check, `ACCOUNTS` array, `filenameParser`, `utcToEdmontonYearMonth` — only needed for Dropbox TZ conversion). Keep `previousMonth`, `cellStatus`, `currentEdmontonYearMonth`, `currentEdmontonDate` (still needed).

**Supabase client:** Use `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)` or the existing `gate.supabase` from `requireUser`. The `requireUser` pattern is already used for the override endpoint — follow the same pattern here.

**`revalidate`:** Change from `0` to `300` (5-minute cache). Gmail data updates hourly via cron; no need for every-request Dropbox auth.

**Error handling:** If Supabase query fails, return `{ error: 'gmail_arrivals_fetch_failed' }` with status 502. No silent failures.

### New imports / removed imports

```typescript
// Remove: all Dropbox imports and env var checks
// Remove: getDropboxAccessToken, listFolderPdfs, ACCOUNTS array
// Keep: previousMonth, cellStatus, currentEdmontonYearMonth, currentEdmontonDate
// Keep: StatementCoverageResponse type, CoverageStatus type, NO_ACTIVITY, monthFromAbbrev (can be removed if unused)
// Add: supabase client import
```

---

## Part C — False Positive Cleanup Migration

Migration `XXXX_cleanup_false_positive_statement_arrivals.sql`:

```sql
-- Remove false positive statement arrivals classified by placeholder accounts.
-- These 10 rows were classified by the old placeholder STATEMENT_ACCOUNTS config
-- (TD Chequing, RBC Visa, AMEX) which matched any email with "statement" in subject.
-- Confirmed false positives from gmail_messages join:
--   5x Interactive Brokers "Daily Activity Statement" → classified as AMEX
--   1x Newton crypto "Your Apr 2026 statement is ready!" → classified as TD Chequing
--   1x Amazon Web Services billing statement → classified as RBC Visa
--   2x TD real eStatement emails → classified as RBC Visa (wrong account, correct sender)
--   1x Amex real statement email → classified as TD Chequing (wrong account)

DELETE FROM gmail_statement_arrivals
WHERE message_id IN (
  SELECT a.message_id
  FROM gmail_statement_arrivals a
  JOIN gmail_messages m ON m.message_id = a.message_id
  WHERE m.from_address ILIKE '%interactivebrokers%'
     OR m.from_address ILIKE '%newton.co%'
     OR m.from_address ILIKE '%aws.com%'
);

-- Also delete the misclassified-account rows for real TD/Amex emails
-- (they will be re-classified correctly on the next gmail-scan cron run)
DELETE FROM gmail_statement_arrivals
WHERE message_id IN (
  SELECT a.message_id
  FROM gmail_statement_arrivals a
  JOIN gmail_messages m ON m.message_id = a.message_id
  WHERE (m.from_address ILIKE '%td.com%' AND a.account_name = 'RBC Visa')
     OR (m.from_address ILIKE '%americanexpress.com%' AND a.account_name = 'TD Chequing')
);

-- No grants needed — this is a DML-only migration.
-- Note: GRANT INSERT, UPDATE, DELETE ON gmail_statement_arrivals TO service_role
-- was applied in migration 0022. No F24 action needed here.
```

**After this migration + STATEMENT_ACCOUNTS rewrite deploy, the gmail-scan cron will re-classify:**
- `alerts@td.com` email → `TD Chequing` (high confidence)
- `TD.eStatementNoReplyAccount@td.com` email → `TD Chequing` or `TD Visa` (depends on subject_pattern match)
- `AmericanExpress@welcome.americanexpress.com` email → `Amex Business` (high confidence)

---

## Check-Before-Build Findings

- `app/api/business-review/statement-coverage/route.ts` — EXISTS, full Dropbox implementation; **replace**
- `lib/gmail/classifiers/statement-arrivals.ts` — EXISTS, placeholder STATEMENT_ACCOUNTS; **update**
- `StatementCoverageGrid.tsx` — EXISTS, unchanged (response shape preserved)
- `statement_coverage_overrides` table — EXISTS (migration 0022 or earlier); **keep using**
- `gmail_statement_arrivals` table — EXISTS and has data; **clean + query**
- No new tables needed

---

## External Deps Tested

- `gmail_statement_arrivals` Supabase table: EXISTS, 10 rows (all false positives to be cleaned)
- `gmail_messages` table: EXISTS, 10 statement-keyword rows confirmed
- `statement_coverage_overrides` table: confirmed via existing route code reference
- No new env vars needed

---

## Grounding Checkpoint

After deploy:
1. **False positives cleared:** `SELECT count(*) FROM gmail_statement_arrivals WHERE account_name = 'RBC Visa'` → 0
2. **TD Bank coverage:** `SELECT account_name, arrival_date FROM gmail_statement_arrivals ORDER BY arrival_date DESC` → shows TD Chequing rows with May 2026 arrival dates
3. **Route response:** `GET /api/business-review/statement-coverage` → 7 accounts, no capital_one; `td_bank` April 2026 = `filed`; `amex` March 2026 = `filed`
4. **Current month pending:** `td_bank` May 2026 = `pending` (or `missing` if today > May 31)
5. **Visual check:** Business Review page shows Statement Coverage grid with TD Bank and Amex showing green for past months

Not "tests pass" — Colin runs the curl and checks the live response.

---

## Kill Signals

- Supabase query to `gmail_statement_arrivals` returns 0 rows after cleanup + cron run → scanner has a bug, do not ship the route change without data
- Any existing test for the statement-coverage route requires Dropbox mocks → those tests must be updated/replaced (test update is in scope)

---

## Cached-Principle Decisions

- Capital One excluded: Colin decision 2026-04-24 (task b362b865)
- Coverage rule `arrival_month - 1 = covered_month`: Colin decision 2026-05-17 (Q3 "following month")
- 2025 band kept: Colin decision 2026-04-24 (task b362b865, Q4)
- CIBC + Canadian Tire as manual-override-only: derived from absence of statement emails in DB — no Colin statement email detected after scanner ran since April 2026 launch
- DELETE destructive operation on `gmail_statement_arrivals`: REQUIRES Colin explicit approval (this doc)

---

## Open Questions

1. **TD Visa / TD USD subject patterns**: both accounts may produce emails with generic "Your TD statement is now available" subject. If they can't be distinguished by subject, all three TD accounts will match on the same email. Is it acceptable for TD Chequing/Visa/USD to share a single coverage signal (all three show `filed` when any one TD email arrives), or must they be distinguished? If distinguished, Colin must provide a way to tell them apart.

2. **CIBC and Canadian Tire**: these accounts had NO statement emails in 6 weeks of scanning. Confirm: do they send email statement notifications? If yes, the scanner has missed them (possible if statements arrive less frequently or the scanner's 25h window + subject filter missed them). If no, manual overrides are the only path.

3. **Amex Bonvoy vs Amex Business**: both may produce emails from `americanexpress.com`. If they share the same subject format, the first-match rule will assign all Amex arrivals to whichever account appears first in `STATEMENT_ACCOUNTS`. Colin: does the Amex Bonvoy statement email have "Bonvoy" or "Marriott" in the subject?

---

## F17 Signal

Unchanged from Sprint 5 gmail-scanner spec. `gmail_statement_arrivals` feeds financial state → reconciliation trigger signal for Business Review.

## F18 Measurement

| Metric | Captured | Benchmark |
|--------|----------|-----------|
| Accounts with ≥1 arrival in past 60 days | SQL query | Target: ≥5 of 7 within 60 days of scanner launch |
| False positive rate | COUNT(arrivals where confidence='medium' and from_address not in known domains) | Target: < 5% of all classified |
| Coverage freshness | Latest arrival_date per account | Alert if any account has no arrival in past 45 days |
