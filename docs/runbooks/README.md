# Runbooks

Operational records for one-off production operations that aren't schema migrations
but still need a paper trail: backfills, manual data corrections, emergency patches,
cron re-triggers, and anything else that changed production state outside of a
normal deploy.

Each runbook is a dated markdown file. Name format: `YYYY-MM-DD-short-description.md`.

These are append-only historical records. Do not edit past runbooks to "clean them up"
— if a decision was wrong, document the correction in a new runbook that references
the original.
