# Reviewer Agent — Spec

**Layer:** 2 (AI-powered, runs after Layer 1 linters)
**Trigger:** git pre-commit hook (automatic) + `/review` slash command (manual)
**Model:** claude-sonnet-4-6
**Cost:** ~$0.001–0.003 per commit (Sonnet input pricing on a typical diff)

---

## Architecture

```
git commit
  └─ .husky/pre-commit
       ├─ Layer 1: npx lint-staged        (ESLint + Prettier — deterministic, fast)
       └─ Layer 2: node scripts/ai-review.mjs   (Sonnet on staged diff)
              │
              ├─ PASS/WARN findings → exit 0 (commit proceeds)
              └─ BLOCK finding     → exit 1 (commit blocked)
```

Manual trigger: `/review` in Claude Code (reads staged diff, runs same checklist).

---

## Checklist

Every commit is evaluated against all 10 items:

| #   | Category                                                                                                                                                                                           | Level if violated                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **Secrets** — Telegram tokens, Supabase keys (`sb_secret_`, `eyJ` JWTs), AWS (`AKIA`), Stripe (`sk_live_`, `rk_live_`), GitHub PATs (`ghp_`, `github_pat_`), long hex/base64 (32+ chars) hardcoded | **BLOCK**                         |
| 2   | **Debug output** — `console.log`, `console.debug`, `debugger` in non-test production paths                                                                                                         | **WARN**                          |
| 3   | **TODO markers** — `TODO`, `FIXME`, `XXX` in committed code                                                                                                                                        | **WARN**                          |
| 4   | **Commit intent** — diff scope inconsistent with what the commit message would reasonably say                                                                                                      | **WARN**                          |
| 5   | **Test coverage** — feature/logic code changed without updating acceptance tests                                                                                                                   | **WARN**                          |
| 6   | **TypeScript hygiene** — bare `any` types; `@ts-ignore` without `// reason: ` comment                                                                                                              | **WARN**                          |
| 7   | **Size guard** — diff exceeds 400 lines                                                                                                                                                            | **WARN** (flag for manual review) |
| 8   | **Schema consistency** — Supabase reads/writes use column names that exist in migrated schema                                                                                                      | **BLOCK**                         |
| 9   | **API contracts** — handler function signatures match TypeScript types                                                                                                                             | **BLOCK**                         |
| 10  | **Grounding** — hardcoded placeholder/AI-generated data (fake names, lorem ipsum, placeholder UUIDs)                                                                                               | **WARN**                          |

---

## Output Format

```
BLOCK: hardcoded Supabase service key on line 12 of lib/supabase/service.ts
WARN:  TODO comment on line 47 of app/api/bets/route.ts
PASS:  diff looks clean
```

One line per finding. Minimum one line (at least one PASS if clean).

---

## Bypass

**Recommended bypass** (logs the skip):

```sh
./scripts/commit-skip.sh "reason — e.g. emergency hotfix, reviewed manually"
```

This logs to `docs/review-skips.md` and commits with `--no-verify`.

**Raw bypass** (no logging — avoid):

```sh
git commit --no-verify
```

Works but creates an untracked skip. Use only if the script fails.

**CI bypass:**

```sh
SKIP_AI_REVIEW=1 git commit
```

Layer 1 linters still run. AI review is skipped. No log entry.

---

## Implementation Files

| File                         | Purpose                                           |
| ---------------------------- | ------------------------------------------------- |
| `.husky/pre-commit`          | Runs Layer 1 then Layer 2                         |
| `scripts/ai-review.mjs`      | Layer 2 reviewer script (Node.js + Anthropic SDK) |
| `scripts/commit-skip.sh`     | Documented bypass with logging                    |
| `docs/review-skips.md`       | Bypass log — committed, grows over time           |
| `.claude/commands/review.md` | `/review` slash command for manual runs           |

---

## Environment Requirements

- `ANTHROPIC_API_KEY` — must be set in shell env for Layer 2 to run
  - If unset, Layer 2 silently skips (Layer 1 still runs)
  - Add to `~/.zshrc` or `~/.bashrc`: `export ANTHROPIC_API_KEY=sk-ant-...`
- `node` 18+ in PATH
- Husky installed: `npm install` (in devDependencies)

---

## Known Limitations

- Reviewer sees only the staged diff — no broader codebase context
- Schema check (item 8) relies on the model's knowledge of the tables, not a live schema query
- Large diffs (>400 lines) are truncated to 32K chars before sending to the model
- False positives on long random strings in test fixtures — use `// review-skip: reason` inline to suppress (future enhancement)
