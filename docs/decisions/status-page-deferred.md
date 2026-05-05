# Decision — Status page deferred indefinitely

**Date:** 2026-05-05
**Closes:** gpu-day-readiness C5 ("Status page spec'd or shipped")
**gpu-day-readiness:** C5 → 100% (deferred with rationale)

## Decision

No status page will be built. The `morning_digest` Telegram message is the canonical surface for system health, and adding a webpage duplicates that information at maintenance cost.

## Rationale

`morning_digest` already covers:

- Harness component rollup (% complete per component)
- Recent `agent_events` (errors, warnings, completions)
- Cron run status (last fire times, failures)
- Deploy gate state (pending approvals)
- Quota burn rate (S-L11 added)

A `/status` webpage would either:

1. Duplicate the digest content → maintenance burden, two sources of truth
2. Add new metrics not in the digest → those should go in the digest first

Either way, the page is downstream of the digest, not parallel to it.

## When to revisit

Revisit if:

- A non-Colin user gains read access (collaborator, contractor) — they don't get Telegram alerts
- An external party needs an uptime SLA surface (customer, partner)
- The digest stops being the primary notification path (e.g., Telegram becomes unreliable)

## Documentation

This decision is the spec. No code, no queued task.
