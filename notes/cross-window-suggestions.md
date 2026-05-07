# Cross-window suggestions

When a Claude session spots a useful refactor, follow-up, or fix that is **outside its SCOPE CONTRACT**, it goes here instead of being acted on. Colin reviews periodically and decides whether to spin up a dedicated session for it.

Format per entry:

```text
## YYYY-MM-DD — <one-line title>
- Spotted by: <branch / window>
- Files involved: ...
- Why noted: ...
- Suggested action: ...
```

Hard rule: do **not** make the change in the current session. Note it and move on.

---

## 2026-05-07 — Coordination files should be in the seam list

- Spotted by: `chore/window-scope-enforcement`
- Files involved: `.husky/pre-commit`, `.husky/commit-msg`, `.claude/CLAUDE.md`, `.claude/migration-claims.json`, `.gitignore`
- Why noted: these files are the multi-window protocol's enforcement surface. A silent edit by one window can disable enforcement for every other window. Today they live outside the seam list (`package.json|...|supabase/seed.sql`), so they can be edited without `[seam-approved]`.
- Suggested action: extend the seam regex in `.husky/commit-msg` to include `^\.husky/|^\.claude/|^\.gitignore$`. One-line change. Follow-up PR with `[seam-approved]` flag.

---
