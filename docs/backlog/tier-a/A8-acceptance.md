# A8 Acceptance Doc — Edmonton Free Events Scanner

**task_id:** 1b9edb82-648a-4171-a335-e4954f352531  
**status:** DRAFT — awaiting Colin approval (open questions in §6)  
**date:** 2026-05-16  
**coordinator:** autonomous harness run

---

## 1 — Scope (one sentence)

Build `/events` cockpit page that fetches upcoming free Edmonton events for the next 14 days from Edmonton Open Data (dataset `jx5c-8cxn`) and Eventbrite, caches results 6h, and displays them as a sortable card list.

**Acceptance criterion:** Page loads and renders ≥1 free Edmonton event dated within the next 14 days from at least one data source (Open Data OR Eventbrite). Kill signal: verify Edmonton Open Data dataset `jx5c-8cxn` returns usable event data (shape + at least one record).

---

## 2 — Out of Scope

- Eventbrite OAuth / ticket purchasing — read-only API key access only
- Event RSVP or tracking (v2)
- Historical events (past events not shown)
- Non-Edmonton events
- Paid events — filtered out
- Map view (v2)
- Telegram notification (v2 unless Colin specifies in escalation response)

---

## 3 — Files Expected to Change

**New files:**
- `app/(cockpit)/events/page.tsx` — server component, fetches and renders events
- `app/(cockpit)/events/_components/EventCard.tsx` — UI card per event
- `lib/edmonton-open-data/events.ts` — Edmonton Open Data client (dataset jx5c-8cxn, CKAN REST API)
- `lib/eventbrite/events.ts` — Eventbrite client (events search, free filter)
- `app/api/cron/refresh-edmonton-events/route.ts` — daily cache refresh cron (F22-compliant)

**Modified files:**
- `app/(cockpit)/_components/CockpitNav.tsx` (or nav config) — add `/events` link
- `vercel.json` — add cron schedule (1 per day, within Hobby plan limit)
- `.env.example` — add `EVENTBRITE_API_KEY`

**No schema migration required** — responses cached in memory or simple key-value in harness_config. (If Colin wants persistence, add `free_events` table — F24 grant required.)

---

## 4 — Check-Before-Build Findings

- **No prior art.** No existing events page, Eventbrite client, or Open Data client.
- **Reusable patterns:** Edmonton timezone from `lib/amazon/financial-events.ts`, cron pattern from `app/api/cron/`, card list UI from `/deal-tracker` or `/flyer-intel`.
- **External deps to test at build time:** (a) Edmonton Open Data CKAN endpoint for jx5c-8cxn, (b) Eventbrite `/v3/events/search` with `is_free=true&location.within=20km&location.address=Edmonton,AB`.

---

## 5 — Grounding Checkpoint

**Physical-world check (Colin runs):**

1. Verify Edmonton Open Data dataset `jx5c-8cxn` exists and returns event records:
   ```
   GET https://data.edmonton.ca/resource/jx5c-8cxn.json?$limit=5
   ```
   Expected: JSON array of event records with name, date, location fields.

2. Load `/events` in browser — confirm ≥1 card renders with title, date, location.

3. Check `agent_events` for `action='events_fetched'` row — confirm both sources attempted, counts logged.

---

## 6 — Open Questions for Colin (ESCALATION REQUIRED before builder start)

> Twin endpoint unreachable in coordinator sandbox. All questions surface to Colin.

**Q1 — F17 justification or exemption (required):**  
A8 is a lifestyle module with no clear behavioral engine signal. Does it feed the path probability engine ("Colin attended X events in Q2 → attend-rate signal")? Or is this an explicit lifestyle module exempt from F17?

**Q2 — F18 metric confirmation (required):**  
Draft metric: events fetched per source per day + morning_digest line "X free events in next 14 days." Is this the right metric? What's Colin's benchmark?

**Q3 — ARCHITECTURE.md §11 exemption (required):**  
"Every sprint must measurably help Colin make or save money." A free events scanner is lifestyle/QOL. Is this explicitly permitted under the T6 backlog-clearing track, or does it need a money justification?

**Q4 — Surface (choose one or more):**  
(a) Cockpit page `/events` only, (b) morning_digest Telegram line, (c) both. Default draft: cockpit page only.

**Q5 — "Free" definition:**  
$0 price tickets only, or include "free registration" events on Eventbrite (some events charge $0 but still require registration)?

**Q6 — EVENTBRITE_API_KEY:**  
Is it already in Vercel production env, or does Colin need to add it first? (Build can proceed if absent; key needed before grounding checkpoint.)

**Q7 — Refresh strategy:**  
Daily cron (midnight MDT) only? Or also refresh on page load if cache >6h old?

---

## 7 — Kill Signals

- Edmonton Open Data dataset `jx5c-8cxn` doesn't exist or returns malformed data → **halt, report to Colin**
- Eventbrite `/v3/events/search` deprecated or requires OAuth (not API key) → **remove Eventbrite, Open Data only**
- No free Edmonton events exist in the dataset → expected edge case; page shows "No upcoming free events" state

---

## 8 — Cached-Principle Decisions

None applied — escalating to Colin given F17/F18/§11 gaps and twin unreachability.

---

## 9 — F17 / F18 Hooks (draft — Colin confirms)

**F17 (behavioral ingestion):** Pending Colin's Q1 answer. If approved: log `agent_events` row `action='events_viewed'` when page loads (signal: Colin checked events). If F17 exempted: omit.

**F18 (measurement):**
- metric: events fetched per source per run (`open_data_count`, `eventbrite_count`)
- benchmark: >0 free events on any given weekday
- surface: `agent_events` `action='events_fetched'` + optional morning_digest line

---

_Status: awaiting Colin approval via Telegram button._  
_Study doc: `docs/backlog/tier-a/A8-study.md`_
