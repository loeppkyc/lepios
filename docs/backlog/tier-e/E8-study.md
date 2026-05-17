# E8 — Life Signals Study

**Task:** da9a9e3c-63e4-4ba9-9d94-6c2a84af431d  
**Run:** 9989289a-074e-42c2-8cbf-7c6e78c7cff7  
**Date:** 2026-05-17  
**Type:** Greenfield (no direct Streamlit predecessor)

---

## What It Does

A daily-state cockpit page at `/signals`. One row per configured life signal.
Each row: signal label, today's value, 7-day mini sparkline, green/yellow/red status
band, freshness timestamp (when last data arrived). The page is a cross-pillar
at-a-glance view of Colin's current state.

F17 rationale: this IS the behavioral ingestion corpus view — all cross-pillar signals
in one place, surfacing what the ingestion pipeline has collected.

F18: signal freshness is displayed inline so Colin can see data staleness at a glance.

---

## No Streamlit Predecessor

The Streamlit OS had individual pages per source (Oura, Amazon, Trading).
There is no unified "life signals" page in Streamlit. This is a net-new composition.

Adjacent Streamlit ports already shipped as LepiOS pages:
- `/oura` (sleep/HRV/readiness/activity) — shipped, using `oura_daily` table
- `/health` (vitals, symptoms, medications) — shipped, using `vitals`/`weight_log`/etc.

---

## Data Source Survey (as of 2026-05-17)

| Signal | Table | Key columns | Rows | Last date | Status |
|--------|-------|-------------|------|-----------|--------|
| Oura sleep score | `oura_daily` | sleep_score, synced_at | 32 | 2026-05-06 | **HAS DATA** |
| Oura readiness | `oura_daily` | readiness_score, synced_at | 32 | 2026-05-06 | **HAS DATA** |
| Oura HRV | `oura_daily` | hrv, synced_at | 32 | 2026-05-06 | **HAS DATA** |
| Oura resting HR | `oura_daily` | resting_hr, synced_at | 32 | 2026-05-06 | **HAS DATA** |
| Oura steps | `oura_daily` | steps, synced_at | 32 | 2026-05-06 | **HAS DATA** |
| Amazon daily revenue | `amazon_financial_events` | gross_contribution, posted_date | 644 | 2026-04-26 | **HAS DATA** |
| Mood/energy | `mood_log` | energy, focus, logged_at | 0 | null | **EMPTY** |
| Weather (Edmonton) | `weather_log` | temp_c, condition, recorded_at | 0 | null | **EMPTY** |
| Sports bet P&L | `bets` | pnl, bet_date | 0 (colin) | null | **EMPTY** |
| Trading P&L | `trades` | dollar_pnl, trade_date | 0 (colin) | null | **EMPTY** |

**Critical finding:** Most signal sources are currently empty. Only Oura and Amazon
have live data. Page must handle empty-table gracefully with "awaiting data" placeholder,
not an error or blank page.

---

## Existing Patterns to Reuse

- **Server component + inline dashboard**: `/oura/page.tsx` pattern — auth check, fetch,
  pass rows to client component.
- **Sparkline (raw SVG)**: `MoneySparkline` in `app/(cockpit)/money/page.tsx` (flagged
  for extraction to `components/cockpit/Sparkline.tsx`). Similar inline SVG in
  `grocery-finder/_components/GroceryFinderClient.tsx`.
- **Cockpit CSS vars**: `--color-positive`, `--color-warning`, `--color-critical`,
  `--color-text-muted`, `--color-base`, `--color-rail`, `--font-ui`.
- **CockpitSidebar**: nav link needs to be added to
  `app/(cockpit)/_components/CockpitSidebar.tsx`.

---

## 20% Better Than Streamlit

| Category | Improvement |
|----------|------------|
| Correctness | Streamlit had no such unified view — every signal required navigating to its own page. This gives Colin's state at a glance in one place. |
| Observability | Freshness timestamp per signal (when was last data received). Streamlit had no freshness signal. |
| Data model | Empty-signal honest state: "awaiting data" instead of hiding the signal or showing 0. Honest labeling (Principle 6). |
| UX | Cockpit row layout — consistent left-to-right: label + current value + sparkline + band + freshness. Scannable in 3 seconds. |
| F17 | This page feeds the behavioral ingestion path by surfacing all signal sources in one audit view. |

---

## Open Questions (Twin Unreachable)

1. **Amazon revenue label**: `gross_contribution` (before fees) or net? Honest label
   depends on Colin's mental model. My default: label as "Amazon gross revenue (7d avg)"
   with a note. → Colin to confirm.
2. **P&L rolling window**: Task says "rolling" — 30 days? 7 days? 90 days? Default: 30d.
   → Placeholder per Principle 11. Colin to tune.
3. **Color thresholds**: e.g., sleep_score green≥80, yellow 65–79, red<65. All in
   centralized `lib/signals/thresholds.ts` with `// TODO: tune with real data` comments.
   → Placeholder default. Colin to tune.
4. **Manual Telegram signals** (family flags Megan/Cora, derm flare 0–3): No table exists.
   New terrain (Principle 15). → Defer to v2, confirm with Colin.
5. **Sidebar label**: "Signals" or "Life Signals"?

---

## Domain Rules (Greenfield — No Streamlit to Carry Forward)

1. Empty table = "awaiting data" placeholder, never an error or 0 value.
2. All numeric thresholds in centralized constants module (Principle 11).
3. Freshness comes from the source table's timestamp column (synced_at / logged_at /
   recorded_at / trade_date / bet_date / posted_date) — not from `created_at`.
4. No new schema for v1 — read-only view of existing tables only.
5. Manual Telegram signals deferred (new terrain, Principle 15).
