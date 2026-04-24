# Chunk D v2 — Streamlit Study

Sprint 4 · Statement Coverage Grid
Phase 1a–1c study artifact — planning input only, not an acceptance doc.
Written: 2026-04-24

---

## What it does (user-visible behavior)

The Statement Coverage Grid in Business Review renders an HTML table with one row per bank/credit card account (8 accounts) and one column per calendar month of 2026 (January through last completed month — current month is excluded). Each cell shows a green checkmark if that account has a statement uploaded for that month, or a red X if not. A warning message lists any missing statements by name and month. A success banner shows if all accounts are current. A diagnostic expander explains why specific months are missing (e.g. "only 2 transactions found, need 3+"). The grid is labeled "Statement Coverage — 2026" and is displayed in the Today, Weekly, and Monthly views inside Business Review.

The Streamlit version is 2026-only. The 2025 tax year band in the v1 LepiOS acceptance doc is a coordinator-added expansion, not a Streamlit port.

---

## How it does it (data sources, API calls, transformations)

### Account config source

`utils/dropbox_statements.py:37–46` — `ACCOUNT_CONFIG` dict defines 8 accounts with `label`, `folder` (Dropbox path), `type` (bank|cc), and optional `personal: True` for capital_one.

### Coverage determination — three-tier logic

`utils/n8n_webhooks.py:76–286` — `get_statement_coverage(year: int = 2026)`:

**Tier 1 — Period dates (primary, most trusted)**
Reads `{account_key}_period_dates` from the `⚙️ Settings` Google Sheet. These are `start:end` date pairs extracted from Claude AI PDF analysis during `sync_all_accounts`. For each month, checks if any period overlaps the month calendar range:

```python
has_it = any(
    start <= month_end and end >= month_start
    for start, end in acct_periods
)
```

This requires TWO statements to bracket a month (the closing date of the prior statement + the closing date of the current statement = one confirmed coverage period). One PDF alone does not guarantee Tier 1 coverage.

**Tier 2 — Transaction count fallback**
Reads `🏦 Statement Lines` Google Sheet. Counts transactions per account per month. If `txn_counts[(acct_key, month)] >= 3`, marks covered. The `>=3` threshold filters out isolated transactions that don't represent a full statement import.

Also reads `{account_key}_all_dates` from Settings (closing dates of statements ever synced). These are inflated by `+= 10` to txn_counts so they win over raw transaction counts. But only the `_period_dates` path actually computes overlap — `_all_dates` feeds into an inferred period calculation:

```python
# n8n_webhooks.py:211–225
for i, d in enumerate(sorted_dates):
    if i == 0:
        inferred.append((date(d.year, d.month, 1), d))
    else:
        prev = sorted_dates[i - 1]
        inferred.append((prev + timedelta(days=1), d))
```

**Tier 3 — Dropbox file-date fallback (last resort, cached 10 min)**
`_get_dropbox_file_months(year)` in `n8n_webhooks.py:44–73`: lists PDFs in each folder, checks `f.server_modified.year == year` and `months.add(mod.month)`. **This uses raw UTC year/month from the Dropbox Python SDK datetime object — no Edmonton timezone conversion.** A file uploaded Dec 31 at 11pm MT = Jan 1 UTC would be credited to January in Streamlit Tier 3.

### Month boundary rule

`n8n_webhooks.py:228`: `max_month = today.month - 1 if today.year == year else 12`
Only months 1 through `max_month` are evaluated. The current month is excluded entirely (rendered as "—" in the UI).

### UI rendering

`Business_Review.py:1685–1748` — `_render_statement_coverage(key_suffix)`:

- Builds an HTML table via string concatenation
- For each account × month: if `m > _max_month` → show "—", elif covered → "✔" (green), else → "✗" (red)
- Calls `get_statement_coverage(2026)` — hardcoded year 2026
- Runs inside `dev_section("Statement Coverage — 2026")` which is a custom section header wrapper
- Invoked in Today view (line 2817), Weekly view (line 3191), Monthly view (line 3838) — same function, different `key_suffix` to avoid Streamlit widget key collisions

### v1 LepiOS approach (the implementation built without Phase 1a)

`route.ts` uses only Dropbox `files/list_folder` + `server_modified` converted to Edmonton timezone. No Google Sheets. No period_dates. No transaction counts. This is Tier 3 logic only, but with the correct Edmonton timezone conversion (which Streamlit Tier 3 lacks).

---

## Domain rules embedded

1. **8 accounts exactly** as defined in `ACCOUNT_CONFIG`. Keys: td_bank, amex, cibc, ct_card, amex_bonvoy, capital_one, td_visa, td_usd.
2. **capital_one is tagged personal** (`personal: True`). In Streamlit it appears in the grid with no visual distinction from business accounts.
3. **Current month is excluded** from the green/red assessment. Streamlit shows "—" for current and future months. This is a deliberate design choice — a missing statement for the current month is not an actionable gap yet.
4. **year=2026 is hardcoded** in the Streamlit call. No 2025 band exists in Streamlit.
5. **server_modified is the authoritative timestamp** for Dropbox file presence. Streamlit Tier 3 uses it directly (UTC, no TZ conversion). LepiOS v1 correctly converts to Edmonton.
6. **One PDF in a folder is sufficient for Tier 3 presence** — the Streamlit Tier 3 `_get_dropbox_file_months` just checks whether any PDF has `server_modified.month == m`. This matches the v1 LepiOS rule.
7. **Tier 1 (period_dates) requires two statements to bracket a month** — a single PDF's closing date alone doesn't confirm coverage. Tier 3 only checks upload presence, not content coverage.
8. **Missing-statement warning lists by label and month name** (not by account key or YYYY-MM string). UI text format: "{Label} ({Month Name})".
9. **No N/A state in the working cells** — the "—" applies only to current and future months, not to accounts opened mid-year.
10. **Diagnostic expander** shows why each red cell is red: period-date logic failure, insufficient transactions, or no Dropbox files at all. This is a transparency feature Streamlit has that v1 LepiOS lacks.

---

## Edge cases

1. **Tier fallback sequence is per-account**: an account with period_dates uses Tier 1; if it's missing period_dates but has transactions, uses Tier 2; only falls to Dropbox API if both are empty.
2. **The \_all_dates path can infer periods from consecutive closing dates** — two closing dates create an inferred period `(prev+1_day, next)`. This means a new account that has never had transactions synced but has had `sync_all_accounts` run twice can get Tier 1-equivalent coverage without the Dropbox call.
3. **Streamlit Tier 3 UTC bug**: `mod.year == year` at line 66 in n8n_webhooks uses UTC datetime from Dropbox SDK. A statement uploaded Dec 31 23:30 MT = Jan 1 00:30 UTC would be credited to January instead of December. LepiOS v1 correctly handles this with Edmonton conversion.
4. **April 30 upload at 23:30 MT = May 1 UTC**: Streamlit Tier 3 credits May. LepiOS v1 correctly credits April. This is an existing correctness gap between Streamlit and LepiOS.
5. **`has_more` pagination**: Streamlit's `_list_pdf_metadata` in `dropbox_statements.py:109–115` does handle `has_more` pagination (while loop). LepiOS v1 does NOT paginate. For folders with many PDFs (e.g. if someone stores non-statement PDFs in the same folder), this could miss files on page 2. With 12-file-per-year volumes this is low risk but non-zero.
6. **Folder not found**: Streamlit silently catches `Exception` in `_get_dropbox_file_months` and returns empty set — the account shows all-red with no error. LepiOS v1 returns a 502 error for `not_found` paths, stopping the whole response. These are different failure modes.
7. **No close_day config usage** in the statement coverage feature. `close_day` is used in other Business Review sections (revenue calculations) but not here. The month boundary is controlled solely by `today.month - 1`.
8. **`get_statement_coverage` is decorated `@st.cache_data(ttl=600)` on the inner `_get_dropbox_file_months` only** — the outer function itself is not cached and re-reads the Settings sheet on every call. This is slightly fragile: each tab render (Today, Weekly, Monthly) triggers a fresh Settings read.

---

## Fragile or improvable points

1. **Streamlit Tier 3 UTC timezone bug**: The fallback path uses UTC year/month directly. Not fixed in Streamlit because the primary path (period_dates) usually fires first. LepiOS v1 correctly fixes this.
2. **Streamlit has three data sources for coverage; LepiOS v1 has one**: v1 discards the period_dates and txn_count logic entirely. This means v1 is inherently less accurate than Streamlit's primary path — it's accurate for presence (uploaded a PDF) but not for coverage (statement period overlaps the month). For the stated purpose (tax reconciliation), presence is probably sufficient, but the distinction matters if a statement uploaded in March covers Feb 15–Mar 15 (it would mark both Feb and Mar as present in v1, but only Mar in Streamlit Tier 1).
3. **v1 does not paginate Dropbox folder listings**: `has_more` is ignored. Streamlit handles this correctly.
4. **v1 has no diagnostic information**: When a cell is red, there's no explanation. Streamlit's diagnostic expander tells Colin why.
5. **v1 exposes all errors as full-route failures**: One bad path breaks the entire response. Streamlit silently handles per-account errors and renders the rest of the grid.
6. **No missing-statement count or warning in v1**: Streamlit emits a `st.warning` listing missing accounts. v1 shows only green/red cells.
7. **HTML table in Streamlit has hover highlighting and account type styling** (`.cov-table tr:hover`, first-child bold). v1 is a plain React table with Design Council colors — better but different.

---

## Twin Q&A

All 5 questions escalated to Colin. See `## Pending Colin Questions` below.

Q1 (coverage logic): `escalate: true, reason: insufficient_context`
Q2 (current month inclusion): `escalate: true, reason: insufficient_context`
Q3 (capital_one visual treatment): `escalate: true, reason: insufficient_context`
Q4 (2025 band scope): `escalate: true, reason: below_threshold` — twin confirmed Streamlit uses only 2026; found session note about 3-tier coverage logic; could not confirm whether 2025 band in v1 acceptance doc was Colin-approved or coordinator-added without study. Confidence 0.75 (below threshold).
Q5 (UTC timezone bug in Streamlit Tier 3): `escalate: true, reason: insufficient_context`

---

## 20% Better

### Correctness

**C1 — Fix Streamlit's UTC year/month bug in Tier 3 (v1 already does this)**
Streamlit `_get_dropbox_file_months` at line 66 uses `mod.year == year` on a raw UTC datetime. A Dec 31 23:30 MT upload = Jan 1 UTC would be credited to January. LepiOS v1 already fixes this with Edmonton conversion. This fix should be preserved and tested in v2.

**C2 — Handle `has_more` pagination (v1 does not, Streamlit does)**
Streamlit's `_list_pdf_metadata` has a `while result.has_more` loop. The v1 Dropbox `files/list_folder` call ignores `has_more`. With 12 files/year per folder this is low risk, but the fix is trivial: check `has_more` and call `files/list_folder_continue` until exhausted. This is a correctness gap that should close in v2.

**C3 — Per-account error isolation (Streamlit silently isolates; v1 blows up the whole response)**
Streamlit catches per-account exceptions and returns an empty set (account shows all-red). v1 returns a 502 for any non-`not_found` error, killing the entire response. v2 should isolate per-account failures: if one folder errors, render that account's cells as a distinct "error" state (grey or striped), and continue rendering the other 7 accounts.

**C4 — Confirm whether presence (Tier 3 logic) is the right accuracy bar for Colin's tax purpose**
Streamlit Tier 1 checks that a statement period brackets the month — i.e., the full month is covered by at least one statement. Tier 3 (v1 logic) only checks upload presence. For a statement uploaded in March covering Feb 15–Mar 15: Tier 3 marks both Feb and Mar as green. Tier 1 marks only March. For tax reconciliation, knowing the statement exists is likely sufficient; Colin opens the statement to reconcile anyway. But this should be confirmed before shipping. **(Routes to Colin — domain semantics change.)**

### Performance

**P1 — Single token refresh, parallel folder listings (v1 already does this)**
v1 uses `Promise.allSettled` for 8 parallel folder calls. Streamlit's `sync_all_accounts` also parallelizes with `ThreadPoolExecutor`. Both are already optimal. No improvement needed.

**P2 — `revalidate = 3600` is already set in v1**
The route is cached for 1 hour at the Next.js layer. Streamlit has `@st.cache_data(ttl=600)` only on the inner Dropbox fetch. The LepiOS 1-hour cache is better.

**P3 — `fetchedAt` timestamp in v1**
v1 already returns a `fetchedAt` ISO timestamp that the component renders as "Fetched: Apr 24, 2026, 10:32 AM MT". This is a genuine improvement over Streamlit which has no data freshness indicator.

### UX

**U1 — Add missing-statement count and warning (Streamlit has this; v1 does not)**
Streamlit emits a `st.warning` listing missing accounts by name and month. v1 shows only the grid. Adding a summary line ("3 statements missing: TD Bank (Jan), Amex (Feb), CIBC (Mar)") below the grid is a meaningful UX improvement — Colin shouldn't have to scan 96 cells to find the reds. This is a non-semantic addition (no data model change required); include in v2.

**U2 — Add diagnostic expander for red cells (Streamlit has this; v1 does not)**
Streamlit's diagnostic expander explains why each cell is red. v1 cannot replicate Tier 1/2 diagnostics without Google Sheets integration, but it could add a simpler note: "Red = no PDF found with server_modified in that Edmonton month." This is low priority for v2 but worth a single line of subtext.

**U3 — Current month treatment needs a decision**
Streamlit shows "—" for current and future months. v1 includes the current month as green or red. Which is correct is a Colin decision (see pending_colin_qs Q2). If Colin wants "—" for current month, the fix is: cap the 2026 YTD band at `currentEdmontonMonth - 1` and render current month as a neutral cell.

**U4 — "Personal" account labeling for Capital One**
capital_one has `personal: True` in Streamlit config. The Streamlit UI shows it with no visual distinction. v2 could add a small "(personal)" label suffix or a dimmed row style. Low priority unless Colin explicitly wants it. (Routes to Colin — see pending_colin_qs Q3.)

### Extensibility

**E1 — Year range should be config-driven, not hardcoded**
v1 hardcodes 2025 and 2026. If Colin runs this in 2027, 2026 becomes a historical band and 2027 becomes the YTD band. The band logic should take a `currentYear` parameter derived at runtime, not compile-time constants. This is a low-cost extensibility seam that avoids a future re-edit.

**E2 — Account list in v1 is hardcoded in the route**
Both Streamlit and v1 hardcode the 8 accounts. Moving to config (env var or a small config file) would allow adding accounts without touching the route. Low priority for v2 but flag it.

### Data model

**D1 — `server_modified` vs `client_modified`: v1 is correct**
v1 correctly uses `server_modified`. Streamlit's Tier 3 also uses `server_modified`. No change needed.

**D2 — Pagination gap (already flagged under C2)**
The `has_more` handling is a data completeness gap. Fix in v2.

### Observability

**O1 — `fetchedAt` timestamp (v1 already has this)**
v1 renders the fetch timestamp in Edmonton time. Streamlit has nothing. Keep in v2.

**O2 — Per-account error state (links to C3)**
v1 currently shows a full 502 on any per-account error. v2 should show a per-account error indicator (e.g. grey cell or "err" label) so Colin can see which account failed without losing the rest of the grid.

**O3 — Add account count summary to response**
Return `{total: 8, green_count: N, red_count: M}` alongside the grid data. Allows the component to render a summary line without re-iterating the coverage map.

---

## 20% Better — Domain semantic changes requiring Colin input

Two improvements are flagged as domain semantic changes that need Colin's answer before inclusion in the acceptance doc:

1. **C4 — Presence vs. period coverage accuracy**: Should v2 use Dropbox presence only (Tier 3 logic, as in v1) or attempt period-date coverage checking (Tier 1 logic, as in Streamlit primary path)? Period-date logic requires reading from Google Sheets — a cross-system dependency. Presence logic is simpler and sufficient for "did I upload this statement?" but not for "does this statement fully cover the month?"

2. **U3 — Current month inclusion**: Should the 2026 YTD band include the current month (green if uploaded, red if not) or cap at last-completed month (show "—" for current month, matching Streamlit)?

---

## Pending Colin Questions

All 5 twin questions escalated (all returned `insufficient_context` or `below_threshold`):

**Q1 — Coverage logic approach**
"For the Statement Coverage Grid: the Streamlit version uses a three-tier coverage logic (period_dates from Settings sheet > transaction count >= 3 > Dropbox file server_modified month). v1 LepiOS uses only Dropbox server_modified (Tier 3 equivalent). For v2, should we use simple Dropbox file-presence (one PDF with server_modified in that Edmonton month = green), or attempt to replicate the Streamlit period-date heuristic from Google Sheets?"
[twin: insufficient_context]

**Q2 — Current month treatment**
"Should the 2026 YTD band include the current month as green/red (if a statement is already uploaded), or cap at last-completed month and show the current month as '—' (matching Streamlit behavior)?"
[twin: insufficient_context]

**Q3 — Capital One personal account visual distinction**
"Capital One is tagged `personal: True` in ACCOUNT_CONFIG. In Streamlit it appears in the grid with no visual distinction. Should v2 label it differently (e.g. '(personal)' suffix, dimmed row) or treat it identically to business accounts?"
[twin: insufficient_context]

**Q4 — 2025 band: Colin-intended or coordinator-added?**
"Streamlit calls `get_statement_coverage(year=2026)` — no 2025 band exists in Streamlit. The v1 LepiOS acceptance doc added a 2025 · Tax Year band as a new feature. Did Colin explicitly request the 2025 band, or was it added by the coordinator without Colin sign-off? Should v2 include it?"
[twin: below_threshold — confidence 0.75; twin confirmed Streamlit is 2026-only but could not find a Colin decision on whether to add 2025]

**Q5 — UTC timezone bug: Streamlit Tier 3 vs. v1 fix**
"Streamlit's Tier 3 fallback (n8n_webhooks.py line 66) uses `mod.year == year` on a UTC datetime — no Edmonton timezone conversion. A Dec 31 23:30 MT upload = Jan 1 UTC would be credited to January, not December. v1 LepiOS fixes this with Edmonton conversion. Is this a known accepted limitation in Streamlit, or a bug? Confirming it's a bug lets us document the fix as an explicit correctness improvement in v2."
[twin: insufficient_context]

---

## Resolution — Colin answers 2026-04-24

**Q1 — Coverage logic:** NEITHER Tier 1 nor Tier 3 as primary. New approach: Gmail scanner detects statement-arrival emails per account (e.g. Bonvoy statement arrives ~Apr 20 = March statement complete). Grid computes coverage from statement-arrival events. **Implication: Chunk D v2 is now blocked on Gmail scanner chunk (task `14913742`).**

**Q2 — Current month treatment:** Answered by Q1. Current month shows "—" until the statement-arrival email lands for that month.

**Q3 — Capital One / personal accounts:** Filter OUT of Business Review grid entirely. No label, no dimmed row — just absent. Future "Personal Spending view" task queued separately (`abac1bac`), to be built after automation stack complete.

**Q4 — 2025 · Tax Year band:** KEEP. Colin will be adding 2025 statements + QuickBooks + tax return data. Purpose: reference prior year while doing 2026 taxes (completing ~April 2027).

**Q5 — UTC timezone bug:** DEFER. Mark as known limitation. Moot if Q1 moves coverage off Dropbox file timestamps entirely.

**Sequencing decision (Colin):** Path A — Gmail scanner first, then Chunk D v2. Gmail scanner is foundational for invoices, receipts, reconciliation, Amazon supplier emails. Build it properly before Chunk D v2 consumes it.

**Phase 1d status:** NOT written. Chunk D v2 acceptance doc blocked on Gmail scanner completion.
