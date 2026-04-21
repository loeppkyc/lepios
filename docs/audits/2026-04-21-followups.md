# Audit Follow-ups — 2026-04-21

Items surfaced during triage of docs/audits/2026-04-21-codebase-audit.md
that are NOT quick wins but should not be forgotten.

## FU-01: fetchFromKeepa silently swallows errors

**Location:** lib/keepa/history.ts (the private fetchFromKeepa function)

**Problem:** All errors inside fetchFromKeepa are caught and converted
to `{ points: [], tokensLeft: null }`. The function never throws.
Callers (getBsrHistory, the /api/bsr-history route) cannot distinguish
between "Keepa returned empty data" and "Keepa failed."

**Real-world impact:** A Keepa outage shows up to users as "no BSR
data" with no trace anywhere. The console.error messages are the only
signal; they do not reach agent_events and cannot be queried later.

**Why this is NOT a quick logError swap:** Adding logError mid-function
while still returning empty data would create misleading state —
callers keep assuming success, agent_events accumulates error rows
with no downstream owner. The correct fix changes the contract:
fetchFromKeepa throws, callers handle, route-level logError captures
failures consistently with the rest of the codebase.

**Proposed fix scope (when tackled):**
1. Remove the try/catch blocks in fetchFromKeepa that swallow errors;
   let them propagate.
2. Update getBsrHistory to catch and decide: re-throw to the route,
   or fall back to empty with an explicit "keepa_unavailable" flag
   the caller can see.
3. Route handler logs the failure via logError per yesterday's
   group 7 pattern.
4. Add a test that simulates a Keepa failure and asserts the error
   path is visible to the caller.

**Estimated effort:** 30-60 min. Behavioral change to a path with
real traffic — needs careful review, not a quick-win slot.

**Trigger to revisit:** When BSR data is noticeably missing in scans
(users notice first), OR before any production Keepa debugging
session where the current silent-swallow makes root-causing harder.
