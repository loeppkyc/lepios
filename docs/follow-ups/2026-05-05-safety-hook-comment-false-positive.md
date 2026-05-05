# Safety hook flags commented destructive SQL — false positive

**Date filed:** 2026-05-05
**Filed by:** twin-teach-slice-2 (could not commit until rollback comment was removed)

## What happened

Commit on `harness/twin-teach-slice-2` was blocked by `.husky/pre-commit` safety hook with:

```
[safety] ✗ BLOCKED — Safety Agent static check failed.
[safety]   • DROP statement (supabase/migrations/0125_twin_escalations.sql): DROP TABLE IF
```

The flagged line was inside a SQL comment block:

```sql
-- Rollback:
--   DROP TABLE IF EXISTS public.twin_escalations;
```

This is the standard rollback-documentation pattern used in 10+ existing migrations
(`0011_add_knowledge_store.sql`, `0012_add_session_handoffs.sql`, `0015_add_task_queue.sql`,
`0017_add_outbound_notifications.sql`, etc.). All of those landed before commit `68d59fe`
tightened the destructive_sql regexes today.

## Root cause

`68d59fe` tightened the destructive-SQL regex in `scripts/safety-check.ts` (or wherever the
hook lives) to require a name token after the keyword (e.g. `DROP TABLE? <name>`). That fixed
the Tailwind `truncate` false positive but didn't add a "skip lines starting with `--`" check.

## Fix

Update the safety hook's SQL parser to strip SQL line comments (`-- ...`) before applying
destructive-pattern regexes. This matches how existing migrations document rollback
intent without firing the destructive-SQL gate.

Pattern reference (Postgres SQL):

- `-- foo` is a line comment to end of line
- `/* foo */` is a block comment

The current scanner only needs to handle line comments — block comments aren't used in the
migration corpus. A simple `lines.filter(l => !l.trim().startsWith('--'))` before pattern
matching would clear this case.

## Workaround applied today

Removed the inline rollback comment from `0125_twin_escalations.sql`. Rollback intent now
described in prose comment instead. Pattern is regressing — future migrations should NOT
inline rollback `DROP` comments until this is fixed.

## Priority

Low-medium. Workaround is one line of prose per migration. But if not fixed, the rollback
documentation pattern dies (no migration can include a `DROP` comment), which is a real loss.
