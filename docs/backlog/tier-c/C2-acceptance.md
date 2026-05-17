# C2 — Statement Coverage Grid v2: Gmail-Based Coverage

**task_id:** 05e8c359-1f69-431d-b2f5-caa4f7e8bbaa  
**Written by:** coordinator (2026-05-17)  
**Status:** awaiting-colin-approval — BLOCKED on sender_domains (see Open Questions)

---

## Scope

Replace the Dropbox file-presence logic in `app/api/business-review/statement-coverage/route.ts` with a Supabase query against `gmail_statement_arrivals`. Capital One excluded. Current month (Edmonton) shows `pending` (dash). Override system (`statement_coverage_overrides`) preserved unchanged.

**Acceptance criterion:** The Statement Coverage Grid renders correctly with all 7 accounts (no Capital One row), current month shows dash, and coverage statuses reflect `gmail_statement_arrivals` arrival dates — not Dropbox folder contents. Builder cannot start until all 4 BLOCKER items below are answered by Colin.

---

## Out of scope (deferred to v3)

- Statement period extraction (start/end dates in `gmail_statement_arrivals`) — still null in v1 classifier; v2 does not require it
- Removing DROPBOX_* env vars from Vercel — leave in place until v2 is verified; clean-up is a separate task
- Multi-year history — v2 shows current year only (same as v1)
- Capital One coverage — excluded per task spec; row absent from grid

---

## Files expected to change

| File | Change |
|------|--------|
| `app/api/business-review/statement-coverage/route.ts` | Replace Dropbox fetch logic with Supabase query against `gmail_statement_arrivals`; remove Dropbox auth helpers; keep `ACCOUNTS` array structure but replace `path` + `filenameParser` with `gmail_account_name` + `arrival_month_offset` |
| `lib/gmail/classifiers/statement-arrivals.ts` | Replace 3 placeholder accounts with correct 7-account definitions (sender_domains + subject_patterns) matching the grid's account keys |

No schema migrations required. `gmail_statement_arrivals` and `statement_coverage_overrides` tables unchanged.

---

## Check-Before-Build

- `StatementCoverageGrid.tsx` — existing component, no change required; response shape preserved
- `statement_coverage_overrides` table — existing, no change; override logic preserved
- `gmail_statement_arrivals` table — existing (migration 0022); query by `account_name` + `arrival_date`
- `statement-coverage/override/route.ts` — existing, no change; toggle logic unchanged
- Prior art search: no v2 statement coverage route exists; this is an in-place replacement

---

## Architecture decision (for Colin to confirm)

### Account mapping table

The v2 route defines a `GMAIL_COVERAGE_ACCOUNTS` config array. Each entry maps the grid's
`account_key` to the `account_name` stored in `gmail_statement_arrivals`, plus the per-account
arrival offset (see BLOCKER Q2 below).

Coordinator's best-guess mapping (confirm/correct all 7 in BLOCKER answers):

| account_key | label | gmail_account_name (proposed) | arrival_offset |
|-------------|-------|-------------------------------|----------------|
| `td_bank` | TD Bank | `TD Chequing` | **Q3: confirm** |
| `amex` | Amex | `AMEX` | M-1 (email in M covers M-1) |
| `cibc` | CIBC | `CIBC Costco` | M-1 |
| `ct_card` | Canadian Tire CC | `Canadian Tire` | M-1 |
| `amex_bonvoy` | Amex Bonvoy | `Amex Bonvoy` | M-1 |
| `td_visa` | TD Visa | `TD Visa` | **Q3: confirm** |
| `td_usd` | TD USD Chequing | `TD USD` | **Q3: confirm** |

Capital One excluded — row absent from `GMAIL_COVERAGE_ACCOUNTS`.

### Arrival date → coverage month logic

v1 (Dropbox): PDF filename date → `applyMinus1` flag per account → covered period.  
v2 (Gmail): `arrival_date` in `gmail_statement_arrivals` → offset per account → covered period.

Most accounts: statement email arrives in month M (shortly after period ends in M-1) → covered month = M-1.  
TD Bank chequing: email may arrive in same month as period ends → covered month = M (no offset). **Requires Colin confirmation — see BLOCKER Q3.**

### Query design

```sql
SELECT account_name, arrival_date
FROM gmail_statement_arrivals
WHERE arrival_date >= YYYY-01-01
  AND arrival_date < (YYYY+1)-01-01
ORDER BY arrival_date DESC
```

Group by `account_name`; for each group, compute covered months from `arrival_date` using per-account offset.  
Current Edmonton month → `pending` (dash). Past month with no row → `missing`. Override table checked as in v1.

---

## 20% Better (vs Dropbox v1)

| Category | Improvement |
|----------|-------------|
| **Performance** | 1 Supabase query replaces 8 parallel Dropbox API calls + 1 OAuth token refresh. Load time: from ~2–4s (Dropbox) to <100ms (Supabase). |
| **Reliability** | No Dropbox credentials required at runtime — eliminates the `dropbox_credentials_missing` and `dropbox_auth_failed` error surfaces. Coverage data persists in DB, survives Dropbox outages. |
| **Correctness** | Gmail classifier detects statements as they arrive — no dependency on Colin remembering to save PDFs to Dropbox. Coverage is updated automatically after each gmail-scan cron run. |
| **Observability** | `confidence` field in `gmail_statement_arrivals` surfaces per-statement detection reliability. Can add confidence indicator to grid cells in v3. |
| **Data freshness** | Dropbox: manual upload required for "filed" status. Gmail: automatic on next cron scan. Data freshness = time since last gmail-scan run (surfaced in existing `agent_events`). |

---

## BLOCKER — Colin must answer all 4 before builder starts

**Q1: Sender domains for each of the 7 accounts**

For each account, provide the exact FROM address domain (or full email) that the statement-ready notification arrives from. This goes into `sender_domains` in the classifier.

Format: `account_key → domain or full email address`

Example: `td_bank → td.com` (or `td.bank@td.com` if specific)

All 7 needed:
- `td_bank` →
- `amex` →
- `cibc` →
- `ct_card` →
- `amex_bonvoy` →
- `td_visa` →
- `td_usd` →

**Q2: Subject patterns for distinguishing same-domain accounts**

Amex and Amex Bonvoy likely share the same sender domain (`americanexpress.com`).  
TD Bank, TD Visa, and TD USD Chequing likely share `td.com`.

For each pair/group sharing a domain, provide the subject line wording or keyword that distinguishes the accounts. (E.g., "TD Visa subjects say 'AEROPLAN' while TD Chequing subjects say 'eStatement'").

**Q3: Per-account arrival offset for TD accounts**

Does the TD Bank chequing statement email arrive in the same month as the statement period ends, or in the following month? Same question for TD Visa and TD USD.

(Example: if October statement email arrives in October → offset = 0. If it arrives in November → offset = -1 month.)

**Q4: Confirm proposed `gmail_account_name` values**

Confirm or correct the `gmail_account_name` strings in the mapping table above. These must exactly match what will be stored in `gmail_statement_arrivals.account_name` by the classifier.

---

## External deps tested

- `gmail_statement_arrivals` table: verified present (migration 0022), has 10 rows with placeholder data (AMEX: 5, RBC Visa: 3, TD Chequing: 2 — all confidence=medium, all placeholder accounts)
- `statement_coverage_overrides` table: existing, used by override route
- No new external API calls in v2 route

---

## Grounding checkpoint

1. Open `/business-review` page — Statement Coverage Grid renders with exactly 7 account rows (no Capital One row)
2. Current Edmonton month cell = dash (–) for all accounts
3. At least 1 past month per account shows `filed` (✓) status sourced from `gmail_statement_arrivals`
4. Toggle a cell → override route still works (cell toggles missing↔filed_override as in v1)
5. `SELECT account_name, arrival_date FROM gmail_statement_arrivals ORDER BY account_name LIMIT 5` — rows show the new account names from Q4 answers (not the old placeholders)

Note: grounding requires at least one scan cycle after the classifier is updated with correct sender_domains. If `gmail_statement_arrivals` still has only placeholder data at build time, builder should seed 1–2 test rows per account for grounding.

---

## Kill signals

- Account names in `gmail_statement_arrivals` don't match what the route queries → all cells show `missing` (silent data mismatch)
- TD Bank/TD Visa/TD USD all classified under same account_name → coverage merged incorrectly
- Amex and Amex Bonvoy merged under same account_name → coverage merged incorrectly

---

## Cached-principle decisions

None — escalating to Colin. Blocker items are domain facts (email sender addresses) not derivable from any principle or codebase pattern. Twin unreachable (coordinator sandbox host allowlist). Cannot satisfy META-C confidence=high with 4 open domain-specific questions.

---

## Open questions

All 4 BLOCKER questions above must be answered. No other open questions.

---

## Migration

None required. `gmail_statement_arrivals` and `statement_coverage_overrides` exist. No new tables.
