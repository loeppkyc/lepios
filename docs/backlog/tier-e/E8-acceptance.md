# E8 — Life Signals Page (/signals): Acceptance Doc

**Task ID:** da9a9e3c-63e4-4ba9-9d94-6c2a84af431d  
**Study doc:** docs/backlog/tier-e/E8-study.md  
**Status:** awaiting-colin-approval  
**Date:** 2026-05-17

---

## Scope

Build `/signals` cockpit page: one CockpitRow per configured life signal, showing today's
value, 7-day mini sparkline (raw SVG), green/yellow/red status band, and inline freshness
timestamp. Signals with empty source tables show an "awaiting data" placeholder — no errors,
no 0-value lies.

**Acceptance criterion:** Colin opens `/signals` in production, sees Oura sleep score row
with a non-null current value and a 7-day sparkline drawn from `oura_daily`. All other rows
(mood, weather, bets, trades) display "awaiting data" cleanly. No JavaScript errors in
console. Page loads in under 2s.

---

## Out of Scope (Deferred)

- Manual Telegram signal capture (family flags Megan/Cora, derm flare 0–3): new terrain,
  no existing table, requires new ingestion path — defer to v2 per Principle 15.
- Write path for any signal: this page is read-only in v1.
- Weather live data fetch: `weather_log` is empty; scaffolded row shows "awaiting data".
  Populating it (weather API cron) is a separate task.
- User-configurable thresholds: v1 uses centralized constants, Colin tunes via code.

---

## Signals and Data Sources

| Row # | Signal | Source table | Column(s) | Freshness column | Empty fallback |
|-------|--------|-------------|-----------|-----------------|----------------|
| 1 | Oura Sleep Score | `oura_daily` | sleep_score | synced_at | "awaiting data" |
| 2 | Oura Readiness | `oura_daily` | readiness_score | synced_at | "awaiting data" |
| 3 | Oura HRV | `oura_daily` | hrv | synced_at | "awaiting data" |
| 4 | Oura Resting HR | `oura_daily` | resting_hr | synced_at | "awaiting data" |
| 5 | Steps | `oura_daily` | steps | synced_at | "awaiting data" |
| 6 | Amazon Gross Revenue (7d) | `amazon_financial_events` | gross_contribution | posted_date | "awaiting data" |
| 7 | Energy / Mood | `mood_log` | energy (0–10) | logged_at | "awaiting data" |
| 8 | Weather (Edmonton) | `weather_log` | temp_c, condition | recorded_at | "awaiting data" |
| 9 | Bet P&L (30d rolling) | `bets` | pnl | bet_date | "awaiting data" |
| 10 | Trading P&L (30d rolling) | `trades` | dollar_pnl | trade_date | "awaiting data" |

**Amazon revenue note:** `gross_contribution` is pre-fee gross (Principle 6 — honest labels).
Label on page: "Amazon Revenue (gross, 7d avg by settlement date)". Not "net" — we don't
have daily net without fee breakdown.

---

## Files Expected to Change

| File | Action | Notes |
|------|--------|-------|
| `app/(cockpit)/signals/page.tsx` | Create | Server component — auth, fetch, pass to dashboard |
| `app/(cockpit)/signals/_components/SignalsDashboard.tsx` | Create | Client component, renders all rows |
| `app/(cockpit)/signals/_components/SignalRow.tsx` | Create | One row: label + value + sparkline + band + freshness |
| `lib/signals/queries.ts` | Create | Fetches last 7 days for each signal source |
| `lib/signals/thresholds.ts` | Create | Centralized color band constants (Principle 11) |
| `app/(cockpit)/_components/CockpitSidebar.tsx` | Edit | Add nav link — "Signals" |

---

## Check-Before-Build Findings

**Repo:**
- `/oura/page.tsx`: Server component + pass-rows-to-client pattern — **reuse directly**.
- `app/(cockpit)/money/page.tsx` lines 129–190: `MoneySparkline` raw SVG pattern —
  **reference and adapt** (note: Sprint 4 comment flags for extraction to shared component).
- `app/(cockpit)/_components/CockpitSidebar.tsx`: already has pattern for nav link
  additions.
- No `/signals` page exists. Fully additive.

**GitHub prior art:**
- `nicholaswagner/health-dashboard`: Generic SaaS. **Skip** (Design Council overrides).
- No open-source "life signals cockpit" matching our instrument-panel aesthetic found.
  **Build-new** (additive, not replacing anything).

---

## External Deps Tested

No new external APIs. All data from existing Supabase tables. No API keys needed.

---

## Grounding Checkpoint

**What Colin verifies:**
1. Navigate to `/signals` — page loads, no JS errors.
2. Row 1 (Oura Sleep Score): current value non-null, matches `/oura` page's most recent
   sleep_score.
3. Row 2–5 (other Oura signals): values present or freshness shows last Oura sync date.
4. Row 6 (Amazon Revenue): shows a number or freshness from 2026-04-26 (last known event).
5. Rows 7–10 (mood/weather/bets/trades): all show "awaiting data" placeholder text.
   No blank space, no error, no 0.
6. Freshness timestamps display as relative human time ("3 days ago", not ISO string).

---

## Kill Signals

- Builder can't get the page to render Oura data (query or typing issue) → reject, investigate.
- Page throws error on empty tables → reject, fix empty-state handling.
- Any signal shows "0" instead of "awaiting data" when table is empty → reject, Principle 6
  violation.

---

## Cached-Principle Decisions

| Decision | Principle | Rationale | Reversibility |
|----------|-----------|-----------|--------------|
| Placeholders in `lib/signals/thresholds.ts` with TODO | Principle 11 | We don't have enough real data to tune thresholds | Free (change constants) |
| Defer manual Telegram signals | Principle 15 (new terrain) + Principle 17 (no speculative infra) | No existing table, new ingestion path required | N/A |
| "Awaiting data" not "0" for empty tables | Principle 6 (honest labels) | 0 implies a measurement was taken | Free (change label) |
| Build-new (no open-source match) | ARCHITECTURE §8.4 | Checked prior-art doc, no cockpit-instrument match | N/A |
| All signals read-only in v1 | Principle 17 | Write paths are separate tasks | Free |

---

## Open Questions for Colin

1. **Amazon revenue label** — confirm "gross revenue (before fees)" is the right framing
   vs. showing net payout. Affects Principle 6 (honest labels).
2. **P&L rolling window** — 30-day default is a placeholder. Confirm or adjust.
3. **Manual Telegram signals** — confirm defer to v2 (family flags, derm flare).
4. **Sidebar label** — "Signals" or "Life Signals"?

---

## F17 — Behavioral Ingestion Justification

This page IS the behavioral ingestion corpus view. Every signal shown here is a candidate
ingestion event for the path probability engine. Surfacing them in a unified view:
(a) lets Colin audit what's being ingested, (b) reveals gaps (empty signals = no data
pipeline yet), (c) provides the "current state" snapshot the Digital Twin needs as context.
Direct F17 compliance — strongest possible.

---

## F18 — Measurement + Benchmark

**Metric:** Signal freshness age per row (how many hours/days since last data point).  
**Benchmark:** Oura syncs nightly — freshness should be <24h. Amazon events lag by
settlement cycle (~2 weeks lag is expected). Mood/weather/etc: N/A until pipelines exist.  
**Surfacing:** Freshness displayed inline on each row. Colin can see at a glance which
signals are stale without reading logs.

---

## META-C Cache-Match Reasoning

```
2026-05-17 task=E8 chunk=E8-signals doc=docs/backlog/tier-e/E8-acceptance.md
cited_principles: [6 honest-labels, 11 placeholders-in-one-place, 15 new-terrain, 17 no-speculative-infra, META-C]
trigger_match_evidence: |
  Principle 6: empty tables → "awaiting data" not "0" — exact trigger match.
  Principle 11: color thresholds unknown → centralized constants w/ TODO — exact trigger match.
  Principle 15: manual Telegram signals = no table, no write path = new terrain — defer.
  Principle 17: manual Telegram ingestion path = speculative for this chunk — defer.
reversibility_check: |
  app/(cockpit)/signals/page.tsx: new file — reversible-free (delete).
  app/(cockpit)/signals/_components/: new files — reversible-free (delete).
  lib/signals/queries.ts: new file — reversible-free (delete).
  lib/signals/thresholds.ts: new file — reversible-free (delete).
  CockpitSidebar.tsx: 1 nav link addition — reversible-free (revert).
  No migrations. No schema changes. No seam files. No canonical writes.
  All decisions fully reversible.
confidence: medium
```

**Confidence is medium** (twin unreachable; 4 open questions; most signal tables are empty
which changes the UX significantly from the original task description). **Escalating to
Colin per META-C rules.**
