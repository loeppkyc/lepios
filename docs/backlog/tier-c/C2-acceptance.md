# C2 — Statement Coverage Grid v2: Gmail-Augmented Detection

**task_id:** 05e8c359-1f69-431d-b2f5-caa4f7e8bbaa  
**item_id:** C2  
**tier:** C  
**written:** 2026-05-17 (second attempt — first doc lost when prior session container cleaned up)  
**Colin's Q&A answers incorporated:** Q1–Q4 (text message 2026-05-17)

---

## Scope

Replace the placeholder `STATEMENT_ACCOUNTS` in `lib/gmail/classifiers/statement-arrivals.ts` with Colin's real 8 accounts, and augment the Statement Coverage Grid route to union Dropbox detection with `gmail_statement_arrivals` data. A cell shows `filed` if **either** source detects the statement.

**One acceptance criterion:** The Statement Coverage Grid loads without error, and cells for months where `gmail_statement_arrivals` has a record show `filed` even if no Dropbox file exists for that month.

---

## Out of Scope

- Removing Dropbox as a source (Phase 2 — after scanner has built history)
- Statement period date extraction from email body (v1 deferred — see classifier)
- Multi-year view (still single-year, same as today)
- Sender domain tuning after first scan run (operational, not build work)

---

## Colin's Answers (Q1–Q4, 2026-05-17)

| Q | Asked | Answer | Interpretation |
|---|-------|--------|----------------|
| Q1 | Sender domains for 7 accounts | "all loeppkycolin@gmail.com" | All 8 statements arrive at one Gmail account: loeppkycolin@gmail.com. Sender domains are not known exactly — use subject patterns as primary detection. |
| Q2 | How to distinguish accounts with same sender domain | "Amex business platinum, amex bonvoy td bank, visa and usd all different" | All 8 accounts have distinct subject patterns; subject-based detection is viable. |
| Q3 | TD arrival offset: same month or following? | "Following month" | **All accounts**: statement email arrives the following month after the period ends. covered_period = arrival_month − 1 for ALL accounts. |
| Q4 | Gmail account name | "Loeppkycolin@gmail.com" | Gmail account to scan: loeppkycolin@gmail.com |

---

## Files Expected to Change

| File | Change |
|------|--------|
| `lib/gmail/classifiers/statement-arrivals.ts` | Replace 3 placeholder `STATEMENT_ACCOUNTS` entries with 8 real accounts |
| `app/api/business-review/statement-coverage/route.ts` | Add `getGmailStatementCoverage()` helper and union with Dropbox in `GET()` |
| `tests/statement-coverage.test.ts` | Add tests for gmail coverage union logic |

No migration. No schema change. `gmail_statement_arrivals` table already exists (migration 0022).

---

## Check-Before-Build Findings

- `lib/gmail/classifiers/statement-arrivals.ts` exists and ships with explicit `// TODO: tune` comment — this chunk IS that tune.
- `gmail_statement_arrivals` table exists (migration 0022). Confirmed in live schema.
- `app/api/business-review/statement-coverage/route.ts` already exports `ACCOUNTS` (8 real accounts with Dropbox paths). The `account_name` values in `STATEMENT_ACCOUNTS` must match the `key` values in `ACCOUNTS` exactly so the union join is clean.
- No prior art for gmail-augmented coverage path. Net-new helper function.

---

## STATEMENT_ACCOUNTS Config

Replace the 3 placeholder entries with these 8. `account_name` values MUST match `ACCOUNTS[*].key` in the coverage route.

**Precedence rule:** subject match is sufficient for any confidence level. Sender domain adds `high` confidence; subject-only = `medium`. Both approaches valid per existing classifier logic.

```typescript
const STATEMENT_ACCOUNTS: StatementArrivalAccount[] = [
  {
    account_name: 'td_bank',  // matches ACCOUNTS key
    sender_domains: ['td.com', 'tdbank.com', 'td.ca'],
    subject_patterns: [
      /e-?statement/i,
      /account statement/i,
      /chequing.*statement/i,
      /statement.*chequing/i,
    ],
  },
  {
    account_name: 'amex',  // Amex Business Platinum
    sender_domains: ['americanexpress.com', 'aexp.com'],
    subject_patterns: [
      /business platinum/i,
      /american express.*business/i,
      /your.*statement.*business/i,
      /new statement.*business/i,
    ],
  },
  {
    account_name: 'amex_bonvoy',  // Amex Marriott Bonvoy
    sender_domains: ['americanexpress.com', 'aexp.com'],
    subject_patterns: [
      /bonvoy/i,
      /marriott.*statement/i,
      /american express.*bonvoy/i,
      /bonvoy.*statement/i,
    ],
  },
  {
    account_name: 'cibc',  // CIBC Costco Mastercard
    sender_domains: ['cibc.com', 'mybankingservices.com'],
    subject_patterns: [
      /cibc/i,
      /costco.*credit/i,
      /statement.*ready/i,
      /new statement/i,
    ],
  },
  {
    account_name: 'ct_card',  // Canadian Tire Mastercard
    sender_domains: ['canadiantire.ca', 'triangle.ca', 'ctfs.com'],
    subject_patterns: [
      /canadian tire/i,
      /triangle.*mastercard/i,
      /triangle.*statement/i,
      /ct.*statement/i,
    ],
  },
  {
    account_name: 'capital_one',  // Capital One Mastercard
    sender_domains: ['capitalone.com', 'capitalonecredit.com'],
    subject_patterns: [
      /capital one/i,
      /capital one.*statement/i,
    ],
  },
  {
    account_name: 'td_visa',  // TD Aeroplan Visa Business
    sender_domains: ['td.com', 'tdbank.com', 'td.ca'],
    subject_patterns: [
      /aeroplan/i,
      /td.*visa/i,
      /td.*credit card.*statement/i,
      /business.*credit.*card/i,
    ],
  },
  {
    account_name: 'td_usd',  // TD USD Chequing
    sender_domains: ['td.com', 'tdbank.com', 'td.ca'],
    subject_patterns: [
      /us dollar/i,
      /usd.*chequing/i,
      /td.*usd/i,
      /u\.s\..*statement/i,
    ],
  },
]
```

**Important note for builder:** These sender_domains and subject_patterns are initial estimates based on industry knowledge. The first production scan run will reveal actual sender addresses. Builder must add a code comment: `// Initial estimates — tune after first scan run with real Gmail data`.

---

## Route Change: getGmailStatementCoverage()

Add a helper to the coverage route that queries `gmail_statement_arrivals` grouped by account/month:

```typescript
// Returns Set of "account_key:YYYY-MM" strings for cells that have gmail arrivals.
// covered_period = arrival_month − 1 for ALL accounts (Colin Q3: "following month").
async function getGmailStatementCoverage(
  supabase: SupabaseClient,
  currentYear: number
): Promise<Set<string>> {
  const covered = new Set<string>()
  const { data } = await supabase
    .from('gmail_statement_arrivals')
    .select('account_name, arrival_date')
    .gte('arrival_date', `${currentYear - 1}-01-01`)
    .lte('arrival_date', `${currentYear + 1}-12-31`)
  
  for (const row of data ?? []) {
    // arrival_date is "YYYY-MM-DD" — email arrives following month → covered = M−1
    const [yearStr, monthStr] = row.arrival_date.split('-')
    const arrYear = Number(yearStr)
    const arrMonth = Number(monthStr)
    const { year: covYear, month: covMonth } = previousMonth(arrYear, arrMonth)
    covered.add(`${row.account_name}:${covYear}-${String(covMonth).padStart(2, '0')}`)
  }
  return covered
}
```

**Union logic in GET():** After building `coverage` from Dropbox, for each account+month in `allMonths`, if `gmailCoverage.has(`${account.key}:${yyyyMM}`)` and current status is not `filed`, promote to `filed`. Priority: `no_activity` > `filed` (either source) > `filed_override` > `pending/missing`.

**Failure mode:** If the `gmail_statement_arrivals` query fails, log `agent_events` row (action='gmail_coverage_fetch_failed', status='warning') and proceed with Dropbox-only result. Non-fatal.

---

## Domain Semantics Preserved

The coverage route's existing logic is unchanged:
- Dropbox filename parsing → covered period (account-specific, applyMinus1 varies)
- NO_ACTIVITY overrides (e.g., cibc: ['2026-03'])
- `statement_coverage_overrides` manual override table
- Cell priority order: no_activity > filed > filed_override > pending > missing

Gmail adds a new promotion path: `missing` or `pending` → `filed` if gmail_coverage has the cell.

---

## Tests Required

Builder must add to `tests/statement-coverage.test.ts`:

1. `getGmailStatementCoverage()` with mock supabase — arrival_date='2026-05-15' → covered cell='td_bank:2026-04'
2. January arrival → covered cell = December of prior year (rollback test)
3. Union: Dropbox has no file for a month, Gmail has arrival → cell shows `filed`
4. Union: Both have data → `filed` (not double-counted)
5. Gmail query failure → falls back to Dropbox-only result (no error thrown)

---

## Grounding Checkpoint

**Not "tests pass."** Colin must:
1. Run the Gmail scanner against his inbox to populate `gmail_statement_arrivals`
2. Load the Business Review page (Production URL: lepios-one.vercel.app)
3. Visually confirm that at least one cell that was previously `missing` (no Dropbox PDF) now shows `filed` due to Gmail detection
4. Confirm the grid loads without error when Dropbox credentials are present

**DB check (alternative):** `SELECT account_name, arrival_date FROM gmail_statement_arrivals ORDER BY detected_at DESC LIMIT 10` — should return rows with correct account_names matching the 8 keys.

---

## Kill Signals

- STATEMENT_ACCOUNTS keys don't match ACCOUNTS keys → union join produces zero matches
- Gmail query in GET() causes the entire route to throw (must be non-fatal)
- Pattern collision: td_bank and td_visa both match the same email → confidence='high' for both (ambiguous)

---

## Cached-Principle Decisions

- **Check-Before-Build (§8.4):** `gmail_statement_arrivals` table confirmed exists. Classifier file exists. No prior art for union logic — builder adds it fresh.
- **F17 (behavioral ingestion):** Not a new module — extending existing Sprint 5 Gmail scanner. No new F17 justification required.
- **F18 (measurement):** `gmail_statement_arrivals` table IS the measurement. Grid coverage % is the benchmark (target: 100% of known months show filed within 7 days of statement email arrival).
- **F20 (no inline style):** Route file has no TSX; classifier has no TSX. No style constraint applies.
- **F22 (cron-secret):** Route uses `requireUser`, not CRON_SECRET. Correct.
- **F24 (migration grants):** No migration in this chunk.

---

## Open Questions

- **Sender domains uncertain:** Colin's Q1 answer ("all loeppkycolin@gmail.com") didn't specify actual FROM domains. Initial estimates used above. If first scan produces zero arrivals, it's likely the sender_domains or subject_patterns need tuning. Builder should label configs as `// initial estimates`.
- **Capital One not in original Q1 list:** The Telegram notification listed 7 accounts (missing capital_one). This acceptance doc adds capital_one for completeness, matching the real ACCOUNTS list. Builder should confirm capital_one statements arrive at loeppkycolin@gmail.com (assumed yes per Q1 answer "all loeppkycolin@gmail.com").

---

## GitHub Prior Art

- `gmail_statement_arrivals` + `classifyStatementArrival()`: LepiOS Sprint 5 (migration 0022, lib/gmail/classifiers/statement-arrivals.ts). Building on existing foundation, not duplicating.
- Union of two data sources in a coverage grid: no external library needed. Plain Set intersection in ~15 lines.
- No open-source library wrapping Gmail → Supabase statement detection at this specificity. Build-native is correct.
