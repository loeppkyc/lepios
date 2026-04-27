# Utility Tracker — Phase 1a Streamlit Study

**Module:** `pages/52_Utility_Tracker.py`
**Coordinator task:** `8b3d7030-a873-431a-b82f-6dbd4ceda83d`
**Date:** 2026-04-27
**Source:** knowledge corpus (domain=`streamlit_source`, entity=`pages/52_Utility_Tracker.py`), 2 chunks
**Tier (from streamlit-inventory-study):** Tier 3 — display page, minimal session_state
**Lines:** 141 | **Complexity:** small | **Category:** finance

> Note: `../streamlit_app/` is not mounted in this environment. Source recovered from the
> knowledge corpus embedded by `scripts/embed-streamlit-source.ts` (Sprint 5 streamlit-inventory chunk).
> Two function-level chunks cover the full implementation. Module preamble (imports, constants)
> is reconstructed from evidence in the chunk bodies.

---

## What it does

A personal electricity bill ledger. Colin manually enters monthly kWh usage and dollar amounts from
Metergy statements. The page shows four summary metrics (total billed, avg monthly cost, avg
monthly kWh, latest bill), two bar charts (monthly kWh and monthly cost), a reverse-chronological
data table of all statements, and a form to add or update a month's entry. Data lives in Google
Sheets.

---

## How it does it

### Data source

Google Sheets via `get_spreadsheet()` (from `utils/sheets.py`). Worksheet name is `SHEET_NAME`
(a module-level constant, value inferred as `"Utility Tracker"` from context).

**Column layout** (inferred from `ws.update(f"A{i}:F{i}", [[month_in, kwh_in, amount_in, "Metergy", "", notes_in]])`):

| Column | Name | Type | Notes |
|--------|------|------|-------|
| A | Month | string (YYYY-MM) | Primary key for upsert |
| B | kWh | float | Usage figure |
| C | Amount ($) | float | Dollar amount |
| D | Provider | string | Hardcoded "Metergy" on write |
| E | (reserved) | string | Always written as empty string; not shown in display |
| F | Notes | string | Free-text |

`HEADERS` constant = `["Month", "kWh", "Amount ($)", "Provider", "", "Notes"]` (inferred from `ws.append_row(HEADERS)`).

### Data loading (`load_utility_data`)

```python
def load_utility_data() -> pd.DataFrame:
    try:
        ws = get_spreadsheet().worksheet(SHEET_NAME)
        data = ws.get_all_records()
        if not data:
            return pd.DataFrame(columns=HEADERS)
        df = pd.DataFrame(data)
        df["kWh"]        = pd.to_numeric(df["kWh"],        errors="coerce").fillna(0)
        df["Amount ($)"] = pd.to_numeric(df["Amount ($)"], errors="coerce").fillna(0)
        df["_month"]     = pd.to_datetime(df["Month"] + "-01", errors="coerce")
        return df.sort_values("_month").reset_index(drop=True)
    except Exception:
        _log.exception("Failed to load utility data")
        return pd.DataFrame(columns=HEADERS)
```

- Returns empty DataFrame on any error (never crashes)
- `_month` is a derived datetime column used for sorting only
- Sorted **ascending** by `_month` (oldest first in DataFrame)

### Worksheet access helper (`_ws`)

```python
def _ws():
    ss = get_spreadsheet()
    try:
        return ss.worksheet(SHEET_NAME)
    except Exception:
        _log.info("Worksheet '%s' not found — creating it", SHEET_NAME)
        ws = ss.add_worksheet(SHEET_NAME, rows=200, cols=len(HEADERS))
        ws.append_row(HEADERS)
        return ws
```

Auto-creates the worksheet on first use.

### Display pipeline (module-level code, after `_ws`)

```python
df = load_utility_data()
st.markdown(section_header("Utility Tracker", "Monthly power usage from Metergy statements"), ...)

if not df.empty:
    # ── Summary metrics ─────────────────────────────────────────────────
    total_cost = df["Amount ($)"].sum()
    avg_kwh    = df["kWh"].mean()
    avg_cost   = df["Amount ($)"].mean()
    latest     = df.iloc[-1]   # last row = newest month (sorted ascending)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Billed",     f"${total_cost:,.2f}")
    c2.metric("Avg Monthly Cost", f"${avg_cost:.2f}")
    c3.metric("Avg Monthly kWh",  f"{avg_kwh:.0f} kWh")
    c4.metric("Latest Bill",      f"${latest['Amount ($)']:.2f}",
              help=f"{latest['Month']} — {latest['kWh']:.0f} kWh")

    # ── Charts ──────────────────────────────────────────────────────────
    chart_df = df.set_index("_month")[["kWh", "Amount ($)"]].copy()
    chart_df.index = chart_df.index.strftime("%b %Y")

    col_left, col_right = st.columns(2)
    with col_left:
        st.bar_chart(chart_df["kWh"], color="#f59e0b")
    with col_right:
        st.bar_chart(chart_df["Amount ($)"], color="#c89b37")

    # ── Data table ──────────────────────────────────────────────────────
    display = df[["Month", "kWh", "Amount ($)", "Provider", "Notes"]].copy()
    display["kWh"]        = display["kWh"].map("{:.1f}".format)
    display["Amount ($)"] = display["Amount ($)"].map("${:.2f}".format)
    st.dataframe(display.iloc[::-1].reset_index(drop=True), ...)   # newest first
else:
    st.info("No utility data yet. Add your first entry below.")

# ── Manual entry form ────────────────────────────────────────────────
with st.form("add_utility"):
    fc1, fc2, fc3 = st.columns(3)
    month_in  = fc1.text_input("Month (YYYY-MM)", placeholder="2025-03")
    kwh_in    = fc2.number_input("kWh", min_value=0.0, step=1.0)
    amount_in = fc3.number_input("Amount ($)", min_value=0.0, step=0.01)
    notes_in  = st.text_input("Notes (optional)", placeholder="e.g. Mar 2025 billing")
    submitted = st.form_submit_button("💾 Save", type="primary")

if submitted:
    if not month_in or kwh_in == 0:
        st.error("Month and kWh are required.")
    else:
        try:
            datetime.strptime(month_in + "-01", "%Y-%m-%d")
        except ValueError:
            st.error("Month must be YYYY-MM format.")
            st.stop()

        ws = _ws()
        all_rows = ws.get_all_values()
        updated = False
        for i, row in enumerate(all_rows[1:], start=2):
            if row and row[0] == month_in:
                ws.update(f"A{i}:F{i}", [[month_in, kwh_in, amount_in, "Metergy", "", notes_in]])
                st.success(f"Updated {month_in}.")
                updated = True
                break
        if not updated:
            ws.append_row([month_in, kwh_in, amount_in, "Metergy", "", notes_in])
            st.success(f"Added {month_in}.")

        load_utility_data.clear()
        st.rerun()
```

---

## Domain rules embedded

1. **Month format is YYYY-MM** — validated with `datetime.strptime(month_in + "-01", "%Y-%m-%d")`. No other format accepted.
2. **kWh = 0 means "not entered"** — validation rejects a form submission if `kwh_in == 0`. This means a real 0 kWh reading cannot be recorded.
3. **Provider is always "Metergy"** — hardcoded on write; not shown in the entry form. The Sheets column holds it but the form provides no way to change it.
4. **Upsert semantics: month is the key** — exact string match `row[0] == month_in`. Finds existing month in column A, updates that row; otherwise appends.
5. **Data sorted ascending; displayed descending** — DataFrame is `sort_values("_month")` ascending; table display uses `iloc[::-1]` (newest first). Latest bill = `df.iloc[-1]` (last in ascending = newest).
6. **Empty-data state** — shows `st.info("No utility data yet.")` instead of error; always safe to load.
7. **Error isolation** — `load_utility_data` returns empty DataFrame on any exception; page never crashes.

---

## Edge cases

- **First use** — worksheet doesn't exist → `_ws()` creates it with headers. Safe.
- **Non-numeric data in Sheets** — `errors="coerce"` + `.fillna(0)` silently zeros bad values. A corrupted Amount becomes $0.00 with no warning.
- **Month format mismatch** — YYYY-M (no leading zero) would pass `datetime.strptime` (it accepts single-digit months) but would NOT match existing rows stored as "2025-03" vs "2025-3". Creates duplicate rows.
- **Empty Sheets rows** — `if row and row[0] == month_in` guards against blank rows returned by `get_all_values()`.
- **kWh = 0 for a real reading** — blocked by validation. A genuinely zero-usage month cannot be recorded.

---

## Fragile or improvable points

| # | Issue | Impact | Streamlit accepted as |
|---|-------|--------|-----------------------|
| 1 | Provider hardcoded as "Metergy" | Can't record other providers | Good enough (one property) |
| 2 | Column position dependency (`A{i}:F{i}`) | Breaks if Sheets columns reordered | Good enough (manual-only sheet) |
| 3 | kWh=0 treated as invalid | Real zero reading unrecordable | Accepted (electricity always >0) |
| 4 | Month string exact-match for upsert | "2025-3" vs "2025-03" creates dup | Accepted (UI enforces placeholder) |
| 5 | `fillna(0)` silences data corruption | Bad data shows as $0 | Accepted (manual entry expected clean) |
| 6 | No cache TTL visible in chunks | Data staleness not managed | Likely `@st.cache_data` with no TTL |
| 7 | Chart index is string label (`strftime`) | No zoom, no hover on chart | Accepted (Streamlit limitation) |
| 8 | Column E reserved but blank | Schema waste | Accepted (historical artifact) |

---

## Twin Q&A — blocked (endpoint unreachable)

`https://lepios-one.vercel.app/api/twin/ask` returned `Host not in allowlist` for all 4 questions.
All questions resolved by design decisions below — no Colin escalation required.

| Question | Resolution |
|----------|------------|
| Is Metergy the only provider? | Provider becomes a free-text field (default "Metergy") — covers any future provider without needing the answer |
| Is the page actively used? | Proceed regardless; scope unaffected |
| Should historical Sheets data be migrated? | Scoped out of v1 — out-of-scope item in acceptance doc, follow-on task if Colin wants it |
| What is column E for? | Irrelevant — LepiOS uses Supabase with explicit named columns |

---

## 20% Better

### Correctness improvements

| # | Streamlit defect | LepiOS fix |
|---|-----------------|------------|
| C1 | `fillna(0)` silently zeros corrupted numeric data | Reject non-numeric on insert; surface load errors to UI |
| C2 | Month string upsert has "2025-3" vs "2025-03" dup risk | Normalize month on save: `new Date(year, month-1).toISOString().slice(0,7)` |
| C3 | kWh=0 blocks real zero reading | Allow zero if explicitly confirmed via field; or simply remove the `== 0` guard (zero electricity is rare but not impossible) |

### Performance improvements

| # | Streamlit | LepiOS |
|---|-----------|--------|
| P1 | Google Sheets read on every render (cached until manual `clear()`) | Supabase query — ~5ms vs ~300ms for Sheets. No cache needed; Next.js `force-dynamic` + direct DB |
| P2 | `get_all_values()` for upsert scan (O(n) row scan) | Supabase upsert with `ON CONFLICT (month) DO UPDATE` — O(1) |

### UX improvements

| # | Streamlit | LepiOS |
|---|-----------|--------|
| U1 | 4 flat metrics, no trend signal | Add month-over-month delta to "Latest Bill" metric (▲/▼ vs prior month kWh and cost) |
| U2 | Two separate bar charts side by side | Single dual-axis chart (kWh left, $ right) — or keep two charts but use Design Council tokens for color |
| U3 | Provider column visible in table (always "Metergy") | Hide Provider in table if all rows have the same value; show as a table caption note |
| U4 | No year-to-date total | Add YTD total for current calendar year as a fifth metric |

### Extensibility improvements

| # | Streamlit | LepiOS |
|---|-----------|--------|
| E1 | Provider hardcoded "Metergy" on write | Provider is a free-text input field (default "Metergy") — future-proofs for building changes |
| E2 | Sheet column order is fragile | Supabase table with named columns; no positional dependency |

### Observability improvements (F18)

| # | Addition |
|---|----------|
| O1 | Log `agent_events` row on each entry save: `action='utility_bill_saved', meta.month, meta.kwh, meta.amount` |
| O2 | `data_freshness_at` displayed in UI (last Supabase write timestamp visible in table header) |

### Out of scope for v1

- Historical data migration from Google Sheets (requires Sheets API credentials in LepiOS env; separate task if Colin requests it)
- Bill import from Metergy PDF/email (future automation)
- Multi-property support (current data is single-property)
