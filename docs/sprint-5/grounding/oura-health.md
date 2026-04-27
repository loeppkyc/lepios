# Grounding Doc — Oura Health (82_Oura_Health.py)

**Prepared:** 2026-04-27  
**Status:** Pre-staged. Do NOT fire until ec1d00c7 confirmed and ranks 1–3 queued or in-flight.  
**Overlap category:** GREENFIELD  
**Migration slots:** 0045 (oura_daily)  
_(Assumes keepa 0041–0042, goals 0043–0044. Recount from actual last migration before firing.)_

---

## 1. What Already Exists in LepiOS

**Nothing.** No `oura_daily` table, no `lib/oura/` directory, no `/cockpit/oura` route. Confirmed via Grep on `app/` and `lib/` for "oura", "sleep", "readiness" — zero matches.

---

## 2. Streamlit Source Analysis

Source: `pages/82_Oura_Health.py` (230 lines)

### Architecture in Streamlit

```
[Oura v2 REST API] → sync_oura() → [Google Sheets: "❤️ Oura Daily"] → load_oura_data() → UI
```

**Password gate (source lines 5–6):**

```python
from utils.auth import require_health_password
require_health_password()
```

This is a Streamlit-specific password prompt — NOT porting to LepiOS. Use standard Supabase auth.

### API calls (grounded from source lines 60–64)

```python
sleep_data     = fetch_oura("daily_sleep", token, start, end)
readiness_data = fetch_oura("daily_readiness", token, start, end)
activity_data  = fetch_oura("daily_activity", token, start, end)
sleep_detail   = fetch_oura("sleep", token, start, end)      # per-sleep-session detail
hr_data        = fetch_oura("heartrate", token, start, end)  # NOTE: not used in final row construction
```

**Oura v2 base URL:** `https://api.ouraring.com/v2/usercollection/{endpoint}`  
**Auth:** Bearer token via `Authorization` header.

### Data mapping (grounded from source lines 81–113)

```python
# Per-date row assembled from 4 endpoints:
rows.append({
    "Date": date,
    "Sleep Score":      sl.get("score", ""),         # from daily_sleep
    "Readiness Score":  rd.get("score", ""),         # from daily_readiness
    "Activity Score":   ac.get("score", ""),         # from daily_activity
    "HRV":              det.get("average_hrv", ...), # from sleep detail (longest session)
    "Resting HR":       det.get("lowest_heart_rate", ...),  # from sleep detail
    "Total Sleep (hrs)": round(det.get("total_sleep_duration",0)/3600, 1),
    "Deep Sleep (min)":  round(det.get("deep_sleep_duration",0)/60),
    "REM Sleep (min)":   round(det.get("rem_sleep_duration",0)/60),
    "Light Sleep (min)": round(det.get("light_sleep_duration",0)/60),
    "Steps":            ac.get("steps", ""),         # from daily_activity
})
```

**Key detail — sleep stages use longest-session rule (source lines 73–76):**

```python
# For days with multiple sleep sessions, use the session with highest total_sleep_duration
for s in sleep_detail:
    day = s.get("day", "")
    if day not in detail_map or s.get("total_sleep_duration",0) > detail_map[day].get(...,0):
        detail_map[day] = s
```

**HRV source (source lines 95–97):** Primary: `average_hrv` from sleep detail. Fallback: `sl["contributors"]["hrv_balance"]`. The `heartrate` endpoint is fetched but not used in the final row.

### Sheets cache

```python
OURA_TAB = "❤️ Oura Daily"
# Columns: Date, Sleep Score, Readiness Score, Activity Score, HRV, Resting HR,
#          Total Sleep (hrs), Deep Sleep (min), REM Sleep (min), Light Sleep (min), Steps, Synced
# Dedup logic: if row["Date"] not in existing_dates → append
```

### UI structure (3 tabs)

**Latest scores row** (always visible, above tabs):

- 5 metrics: Sleep, Readiness, Activity, HRV, Resting HR — from most recent row

**Tab 1 — Score Trends:** `st.line_chart` for Sleep Score, Readiness Score, Activity Score on a shared time axis. Separate HRV and Resting HR line charts.

**Tab 2 — Sleep Breakdown:** `st.bar_chart` for Deep/REM/Light sleep (stacked). `st.line_chart` for Total Sleep (hrs). Average sleep hours caption.

**Tab 3 — Raw Data:** Full table, Date formatted as YYYY-MM-DD.

### Sync controls

```python
sync_days = st.selectbox("Sync period", [7, 14, 30])
# Manual sync button: fetches API, deduplicates by date, appends new rows to Sheets
```

---

## 3. Decisions (Resolved Pre-fire)

| Decision                | Resolution                                                              | Rationale                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheets cache → Supabase | **`oura_daily` table**                                                  | Eliminates Sheets dependency; data queryable by harness                                                                                       |
| Password gate           | **Drop it; use Supabase auth**                                          | LepiOS already has auth; password gate is Streamlit-only workaround                                                                           |
| Manual sync             | **PORT** + add cron extension                                           | Manual sync button stays (useful for ad-hoc). Add note that `night_tick` cron can be extended to call the sync endpoint nightly (20% Better). |
| Oura PAT storage        | **`harness_config` table, key `OURA_ACCESS_TOKEN`**                     | Per S-L1 pattern — agent runtime values → harness_config, not Vercel env                                                                      |
| HRV source              | **Replicate exactly**: `average_hrv` → fallback `hrv_balance`           | Don't change the data mapping; parity is correct here                                                                                         |
| Sleep stage rule        | **Replicate exactly**: longest session wins                             | Consistent with Streamlit; changing this would alter historical data comparisons                                                              |
| Charting                | **shadcn/ui Chart (Recharts)** — `ChartContainer` + Recharts primitives | Resolved 2026-04-27. See `docs/decisions/chart-library-strategy.md`                                                                           |
| `heartrate` endpoint    | **Skip for v1**                                                         | Fetched in Streamlit but never used in the UI — dead import                                                                                   |
| Grounding checkpoint    | **None needed**                                                         | Health scores have no financial source of truth to match                                                                                      |

---

## 4. What to Port / Skip / Rebuild

| Item                            | Action                              | Reason                                                     |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Oura v2 API client              | **REBUILD** as `lib/oura/client.ts` | Clean TypeScript client; replaces Streamlit `fetch_oura()` |
| Data mapping (date aggregation) | **PORT** (translate to TS)          | Logic is correct; longest-session rule preserved           |
| Sheets read/write               | **SKIP / REPLACE**                  | Supabase `oura_daily` table                                |
| Password gate                   | **SKIP**                            | Use Supabase auth                                          |
| `heartrate` endpoint call       | **SKIP**                            | Unused in Streamlit UI                                     |
| Latest scores row (5 metrics)   | **PORT**                            | Direct translation                                         |
| Score Trends tab                | **PORT** (Tailwind bars)            | No line chart lib — Tailwind bars for now                  |
| Sleep Breakdown tab             | **PORT** (Tailwind bars)            | Same                                                       |
| Raw Data tab                    | **PORT**                            | Simple table; use Design Council data table pattern        |
| Manual sync button              | **PORT**                            | POST to `/api/oura/sync`                                   |
| Sync dedup by date              | **PORT**                            | `upsert` on unique date column in Supabase                 |

---

## 5. New Schema (Coordinator Must Spec)

### `oura_daily` (migration 0045)

```sql
id uuid primary key default gen_random_uuid(),
date date not null unique,                    -- one row per calendar date
sleep_score int,
readiness_score int,
activity_score int,
hrv numeric,                                  -- average_hrv from longest sleep session
resting_hr numeric,                           -- lowest_heart_rate from longest sleep session
total_sleep_hrs numeric,                      -- hours, 1 decimal
deep_sleep_min int,
rem_sleep_min int,
light_sleep_min int,
steps int,
synced_at timestamptz default now()
```

**Upsert key:** `date` (unique). On re-sync of same date, update all score fields.

---

## 6. New Route / Page / Lib Structure

```
lib/oura/client.ts                            — Oura v2 API wrapper
  fetchOuraEndpoint(endpoint, token, start, end) → data[]
  syncOuraDays(token, days)                   — full aggregation logic, returns OuraDayRow[]

app/(cockpit)/oura/page.tsx                   — main page, 3 tabs
app/(cockpit)/oura/_components/
  OuraScoreRow.tsx                            — latest 5-metric row (above tabs)
  OuraScoreTrends.tsx                         — Tab 1 (Tailwind proportional bar charts)
  OuraSleepBreakdown.tsx                      — Tab 2 (sleep stage bars + total line)
  OuraRawTable.tsx                            — Tab 3 (full data table)
app/api/oura/sync/route.ts                    — POST → fetch API, upsert to oura_daily
app/api/oura/data/route.ts                    — GET → query oura_daily with date range
```

---

## 7. 20% Better Opportunities

1. **Nightly cron sync**: Extend `night_tick` (or add a dedicated daily cron) to call `/api/oura/sync?days=1` each morning. Streamlit requires a manual button click. Supabase always has yesterday's data without user action.
2. **Data queryable by harness**: With `oura_daily` in Supabase, the harness can ask "what was my average HRV last week?" — not possible with Sheets. Wire a query into `morning_digest` (future).
3. **Readiness-gated work scheduling** (vision-level): `readiness_score < 60 → morning_digest flags low-recovery day`. Pairs with the behavioral ingestion spec (F17). Not in v1 acceptance doc but note it.

---

## 8. Blockers / Open Questions

| Item                                   | Status                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OURA_ACCESS_TOKEN` in harness_config? | Likely not yet — coordinator should check `SELECT key FROM harness_config` before fire. Flag for Colin to insert if missing.                     |
| Sync period cron frequency             | night_tick is daily — syncing 1 day behind is fine. If Colin wants real-time, a dedicated cron is needed. Coordinator should note both options.  |
| Chart library future                   | When recharts is added to package.json, OuraScoreTrends.tsx is the right candidate for a real line chart. Leave a TODO comment in the component. |

---

## 9. Grounding Manifest

| Claim                                           | Evidence                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| No oura/sleep/readiness code in LepiOS          | Grounded — Grep on app/ and lib/ for "oura", "sleep", "readiness" returned zero matches 2026-04-27 |
| 5 Oura v2 endpoints called                      | Grounded — source lines 60–64, read 2026-04-27                                                     |
| `heartrate` endpoint not used in UI             | Grounded — source: `hr_data` assigned but no reference in rows assembly (lines 81–113)             |
| Longest-session sleep stage rule                | Grounded — source lines 73–76, read 2026-04-27                                                     |
| HRV primary + fallback                          | Grounded — source lines 95–97, read 2026-04-27                                                     |
| Password gate via `require_health_password()`   | Grounded — source lines 5–6, read 2026-04-27                                                       |
| No charting lib in LepiOS                       | Grounded — AmazonDailyChart.tsx line 3 comment, read 2026-04-27                                    |
| 3 tabs: Score Trends, Sleep Breakdown, Raw Data | Grounded — source line 190, read 2026-04-27                                                        |
