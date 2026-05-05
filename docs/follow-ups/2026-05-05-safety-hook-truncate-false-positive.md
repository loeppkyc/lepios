# Safety Hook: TRUNCATE False Positive + Hook Doesn't Block

**Date:** 2026-05-05
**Found during:** chat-page lint-error refactor commit (`bcbef8c`)
**Status:** Deferred — two real bugs, neither blocking work

---

## What happened

Committing the chat split refactor (which adds a Tailwind `truncate` class
to the conversation row title) printed:

```
[safety] ✗ BLOCKED — Safety Agent static check failed.
[safety]   • TRUNCATE statement: TRUNCATE …
```

…then the commit succeeded anyway and pushed to main.

Both halves of that are bugs.

---

## Bug 1 — false positive on Tailwind `truncate`

`scripts/pre-commit-safety.mjs:48`:

```js
if (/\bTRUNCATE\b/.test(additionsUpper)) {
  findings.push({ severity: 'block', rule: 'TRUNCATE statement', evidence: 'TRUNCATE …' })
}
```

`additionsUpper` is the diff additions uppercased. Tailwind's `truncate`
utility class becomes `TRUNCATE` after uppercase, and `\b…\b` matches
inside `"block truncate"`. Same shape would fire on any TSX/MD/CSS file
that mentions the word "truncate" in prose.

The mirror in `lib/harness/safety/static.ts:86` has the same pattern but
is only invoked with explicit SQL strings, so it never sees TSX. Only
the pre-commit script wires the regex against arbitrary file diffs.

### Fix options

**A. Only scan SQL contexts** — gate the destructive_sql pattern set on
file extension. The pre-commit script can read the staged file list with
`git diff --cached --name-only` and only union the additions of files
matching `*.sql`, `supabase/migrations/**`, `scripts/**/*.sql`,
`scripts/**/*.py` (the bookkeeping CSV ingester writes raw SQL strings
in Python). Cleanest, also speeds up the check.

**B. Require SQL syntactic context** — change the regex to demand a SQL
keyword neighbor: `/\bTRUNCATE\s+(TABLE\s+)?\w+/`. Catches real
`TRUNCATE table_name` and `TRUNCATE TABLE table_name`. Misses
`TRUNCATE TABLE  ` with weird whitespace, edge case. Same kind of
tightening applies to DROP and DELETE patterns already in the script.

**C. Skip the line if it sits inside an obvious string literal that
isn't SQL** — too fragile, declines.

Recommendation: **A** (file-extension gating) is the right primary fix.
**B** (syntactic context) is a useful secondary defense for any non-`.sql`
file that legitimately contains SQL strings (e.g., `lib/orb/tools/*.ts`).

---

## Bug 2 — the hook prints "BLOCKED" but doesn't actually block

`.husky/pre-commit`:

```sh
#!/usr/bin/env sh
# Layer 0 — Safety Agent static check
node scripts/pre-commit-safety.mjs

# Layer 1 — deterministic checks
npx lint-staged

# Layer 2 — AI diff review
if [ "${SKIP_AI_REVIEW}" != "1" ]; then
  node scripts/ai-review.mjs
fi
```

POSIX `sh` does **not** abort on first failure unless `set -e` is set.
Layer 0 exits 1, but the script keeps running. The exit code of the hook
is the exit code of the _last_ command (Layer 2), which today is
soft-skipping with exit 0. Net: every "BLOCKED" today is actually a
warning.

### Fix

Add `set -e` to the top:

```sh
#!/usr/bin/env sh
set -e
node scripts/pre-commit-safety.mjs
npx lint-staged
if [ "${SKIP_AI_REVIEW}" != "1" ]; then
  node scripts/ai-review.mjs
fi
```

`SAFETY_BYPASS=1` already exists for the documented escape hatch. With
`set -e`, exit-1 from any of the three layers correctly aborts.

There is also a third-order question: **should Layer 2 (AI review)
abort the commit on its own findings?** Currently it soft-skips on
provider failure (correct) but its severity decisions are advisory
(probably also correct — the diff might exceed 400 lines and a model
review can be noisy). Out of scope for this doc; flagging only.

---

## Why this slipped past on `bcbef8c`

The diff that triggered Bug 1 contained the literal word `truncate`
inside a Tailwind className. Because of Bug 2, the false positive
printed `BLOCKED` to stderr but didn't block the commit. The commit
landed and pushed to production. There was no actual destructive SQL —
correct outcome by accident. But the same code path would also fail to
block a _real_ destructive SQL operation if Bug 1 fired alongside it.

---

## Suggested order of fix

1. Bug 2 (`set -e`) — one line, restores blocking semantics. Do this first.
2. Bug 1 fix A (file-extension gating) — the larger, safer change. Add
   a small unit test that the hook passes a TSX with the word `truncate`
   and blocks a `.sql` file with `TRUNCATE accounts`.

Both belong in one PR — order matters because shipping (1) without (2)
would have blocked the chat refactor commit on a false positive.
