# 0036 migration collision (committed to main)

Two migrations share prefix 0036 on main:
- 0036_amazon_settlements.sql
- 0036_register_tax_sanity_component.sql

Supabase will only apply one — the other is effectively dead on a fresh clone.

## To investigate
- Which file actually applied in production (check supabase migrations table)
- Which file is dead — does its content exist in the DB or not
- Whether the dead one needs to be renumbered + reapplied, or its content is already covered elsewhere

## Resolution path
Likely a follow-up migration that adds whatever the dead one was supposed to add, plus a renumber of the file on disk for fresh-clone correctness.

Do NOT just rename one file — that breaks reproducibility for environments that already applied the original.

Logged 2026-04-30 during untracked-file triage. See PR history around #38–#44 for context.
