# Acceptance Doc — Status Page v2

**Date:** 2026-04-28  
**Branch:** feature/status-page-v2  
**Status:** approved (Colin-direct — doc hardening session, reversible, no financial data)

---

## Scope

Enhance `/status` with: 90-day uptime bars per harness component, incident log (recent errors/warnings from `agent_events`), dual timezone display (Edmonton MT + UTC), and a nav link from CockpitNav.

**One acceptance criterion:** `/status` page loads in production with all four sections populated from live DB data; CockpitNav contains a "Status" link.

## Out of scope

- Dedicated `health_pings` table — `agent_events` provides sufficient signal; table build deferred
- Auth-gating `/status` — it is intentionally public for operations monitoring; defer to a future security sprint
- Moving status page into cockpit layout group

## Files expected to change

1. `lib/harness/status-data.ts` — new: `getIncidentLog()` + `get90DayBars()`
2. `app/status/page.tsx` — add incident log section, 90-day bars, dual timezone
3. `app/api/status/route.ts` — add `incident_log` + `uptime_bars` to JSON response
4. `app/(cockpit)/_components/CockpitNav.tsx` — add `{ href: '/status', label: 'Status' }` to NAV_LINKS
5. `tests/status-data.test.ts` — new: unit tests for `getIncidentLog()` and `get90DayBars()`

## Check-Before-Build findings

- `app/status/page.tsx` exists — extending, not replacing
- `app/api/status/route.ts` exists — extending response shape
- `tests/api/status.test.ts` exists — not touching, existing tests must remain green
- `lib/harness/component-health.ts` — reuse `HealthStatus` type
- No migration required — all data from existing `agent_events` + `harness_components`

## Data model (grounded against actual schema)

### getIncidentLog(limit = 50)

Query: `agent_events WHERE status IN ('error', 'warning') ORDER BY occurred_at DESC LIMIT 50`  
Returns: `{ id, occurred_at, domain, action, actor, status, error_message }`

### get90DayBars()

Query: group `agent_events WHERE domain='harness'` by `DATE(occurred_at AT TIME ZONE 'America/Edmonton')` for the past 90 days. Returns one bar per day:

```ts
interface DayBar {
  date: string // YYYY-MM-DD in Edmonton
  status: 'green' | 'amber' | 'red' | 'none'
  successCount: number
  errorCount: number
}
```

Rules:

- `none`: no events that day
- `green`: successCount > 0, errorCount = 0
- `amber`: successCount > 0, errorCount > 0
- `red`: errorCount > 0, successCount = 0

## Timestamp standard

Every timestamp displayed: `Apr 27 11:38 MT` + `17:38 UTC` side-by-side.  
Implementation: `Intl.DateTimeFormat` with `timeZone: 'America/Edmonton'` and `timeZone: 'UTC'`.

## UI constraints (F20)

- All new TSX: Tailwind utility classes only. No `style={}` attributes.
- Note: existing CockpitNav violates F20 with inline styles — do NOT extend the violation; add the Status link using existing pattern to avoid layout regression, flag the existing violation in a follow-up.

## F17 — Behavioral ingestion justification

Status page drives harness observability: Colin visits → confirms system is healthy or detects failure → action follows. Each view correlates with harness health state. Indirect signal for improvement-engine: incident patterns surface degraded harness paths.

## F18 — Measurement + benchmark

- Metric: number of incidents visible in status log at any point in time
- Benchmark: "time to awareness" — without status page, harness failures discovered via Telegram only (async). With status page, failures visible on demand. Target: any harness failure visible within 5 min of first browse.
- Surfacing path: CockpitNav → /status (this PR)

## Grounding checkpoint

After deploy: browse `lepios-one.vercel.app/status` and verify:

1. Component Health table renders with ≥1 row
2. 90-day bars section renders with colored squares (most will be grey/none given harness age)
3. Incident Log shows ≥5 rows matching recent `agent_events WHERE status IN ('error','warning')`
4. Each timestamp shows both MT and UTC formats
5. CockpitNav contains "Status" link

Grounding is DB-state queryable: `SELECT COUNT(*) FROM agent_events WHERE status IN ('error','warning')` should match incident log row count (capped at 50).

## Kill signals

- If `agent_events` query takes >3s in production: add index on `(status, occurred_at DESC)` as follow-up
- If 90-day SQL aggregation causes timeout: add index on `(domain, occurred_at)` as follow-up
