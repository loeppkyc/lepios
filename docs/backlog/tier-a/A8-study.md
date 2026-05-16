# A8 — Edmonton Free Events Scanner: Coordinator Study Doc

**task_id:** 1b9edb82-648a-4171-a335-e4954f352531  
**run_id:** c32bb406-3fa0-41b1-b14d-a74ffb79b1cf  
**date:** 2026-05-16  
**source:** task_queue — Tier A parked backlog item (auto-queued via harness)

---

## Task Brief (from task_queue)

**task:** A8 — Edmonton Free Events Scanner (Open Data + Eventbrite)  
**description:** Upcoming free Edmonton events next 14 days. Kill signal: verify Open Data dataset ID jx5c-8cxn. Requires EVENTBRITE_API_KEY in Vercel.

---

## Check-Before-Build Findings

**Search scope:** app/, lib/, components/ — all .ts/.tsx files  
**Terms searched:** eventbrite, edmonton event, open data, jx5c  
**Result: No prior art found.** This is fully greenfield.

No `/events` cockpit page exists.  
No Eventbrite client in lib/.  
No Edmonton Open Data client in lib/.  
No events API route in app/api/.  
No events table in any migration file.

**Comparable patterns to reuse:**
- `/flyer-intel` — external data fetch → card list UI pattern
- `/deal-tracker` — timed deals with filtering
- `lib/amazon/financial-events.ts` — Edmonton timezone handling (postedDateEdmonton already exists — reuse)
- cron pattern: `app/api/cron/` (daily refresh) — well-established

**Build verdict:** Build-new (no reusable component applies), but scaffold from flyer-intel and deal-tracker patterns.

---

## What It Does (from task brief)

Shows Colin upcoming free Edmonton events for the next 14 days.

Two data sources:
1. **Edmonton Open Data** — dataset `jx5c-8cxn` (public, no auth required)
2. **Eventbrite** — requires `EVENTBRITE_API_KEY` in Vercel env

Filter: free events only. Lookahead: 14 days from today (Edmonton timezone).

---

## Domain Rules (to carry into acceptance doc)

1. **Edmonton timezone is MST/MDT** — `postedDateEdmonton()` exists in lib/amazon/financial-events.ts. Use America/Edmonton for all date arithmetic.
2. **14-day lookahead** — today through today+14 days. Not calendar month.
3. **Free = $0 admission** — definition to confirm with Colin (see open questions).
4. **Kill signal** — coordinator.md §Non-negotiable #1: verify dataset ID jx5c-8cxn returns actual data before marking chunk complete. This is a physical-world grounding checkpoint.

---

## 20% Better Analysis (vs. Streamlit — N/A, greenfield)

No Streamlit predecessor. This is a new feature.

Better-than-naive defaults:
- **Correctness:** Edmonton timezone (America/Edmonton) for all date filters — not UTC
- **Performance:** Cache Open Data + Eventbrite responses for 6h (events don't change minute-to-minute); daily cron refresh
- **UX:** Show event name, date/time, location, source, URL — at minimum. Sort by date ascending.
- **Observability:** Log fetch timestamp, event count, source breakdown to agent_events
- **F18:** metric = events fetched per source per day; benchmark = >0 events returned on any given weekday (Edmonton is an active events city)

---

## Twin Q&A — BLOCKED (endpoint unreachable)

The Twin endpoint (`https://lepios-one.vercel.app/api/twin/ask`) returned "Host not in allowlist" for all queries. Same restriction as the heartbeat endpoint.

**All twin questions are escalated to Colin:**

**Q1:** Does Colin have any preference for how Edmonton free events should be surfaced — cockpit page (`/events`), morning_digest Telegram line, or both?

**Q2:** What is Edmonton Open Data dataset jx5c-8cxn exactly? Does it cover community events? What's the API endpoint format (CKAN REST API standard)?

**Q3:** Has Colin indicated intent to attend free events as family activity (Cora, Megan), personal enrichment, or sourcing/networking?

---

## F17 — Behavioral Ingestion Justification (MISSING — escalation required)

Per F17 (CLAUDE.md §3, rule 7): "Every new module must justify its contribution to the behavioral ingestion spec and path probability engine."

**Gap:** No F17 justification is documented in the task brief, the parked-backlog entry, or any referenced spec.

**Candidate justifications (coordinator proposing — Colin decides):**
1. "Which free events Colin attends" feeds the behavioral engine under leisure/family decision domain
2. Event scanner feeds `morning_digest` → generates a signal on whether Colin engages with local community activities
3. Weak: "reduces friction to attend free events → saves money vs. paid alternatives"

**None of these are strong enough to meet the F17 standard without Colin's explicit sign-off.**

**Resolution required:** Colin provides F17 justification or grants explicit exemption ("lifestyle module, no engine signal required").

---

## F18 — Measurement + Benchmark (MISSING — escalation required)

Per F18 (CLAUDE.md §3, rule 8): metric + benchmark + surface required.

**Draft (coordinator proposing):**
- metric: events fetched per source per day (Open Data count, Eventbrite count)
- benchmark: >0 free events returned on any weekday (Edmonton is active)
- surface: `agent_events` with `action='events_fetched'`; morning_digest line "X free events in next 14 days"

**Colin must confirm this is the right metric or provide one.**

---

## Architecture §11 Check

ARCHITECTURE.md §11: "Every sprint must ship something that measurably helps Colin make or save money."

**Gap:** A free events scanner is a lifestyle/quality-of-life feature. No direct money connection.

**Coordinator position:** This does NOT obviously satisfy §11. However, it IS on the parked backlog (A8) and was queued with priority 2 by the harness, implying Colin placed it there. If Colin accepts that lifestyle modules are permitted in the T6 backlog-clearing track without meeting §11, the coordinator needs that as an explicit ruling.

---

## Open Questions for Colin

1. **F17 justification or exemption?** Does A8 feed the behavioral path probability engine? Or is this a lifestyle module exempt from F17?
2. **F18 metric confirmation?** Is "events fetched per source per day" the right metric?
3. **ARCHITECTURE.md §11 exemption?** Lifestyle modules in the T6 track — permitted without money connection?
4. **Surface:** Cockpit page `/events`, morning_digest line, Telegram notification, or all three?
5. **"Free" definition:** $0 price only, or "free registration" (Eventbrite sometimes charges for free events)?
6. **Eventbrite API scope:** Events search endpoint? Edmonton lat/lng bounding box? Categories filter?
7. **EVENTBRITE_API_KEY:** Already in Vercel production env, or needs to be added first?
8. **Refresh strategy:** Daily cron only, or on-demand fetch on page load?

---

## Summary

- **Prior art:** None. Fully greenfield.
- **Twin:** Unreachable. All questions escalated to Colin.
- **F17/F18:** Missing. Escalation required before acceptance doc can be finalized.
- **Next step:** Colin approves scope + answers questions → coordinator writes formal acceptance doc → builder builds.
