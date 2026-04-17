Review the current staged diff using the Reviewer Agent checklist.

Run `git diff --cached` to get the staged changes, then evaluate them against ALL items in this checklist. Output each finding as one line: `BLOCK:`, `WARN:`, or `PASS:` prefix.

**Checklist:**

1. **SECRETS** — No Telegram tokens, Supabase keys (`sb_secret_`, `eyJ` JWTs), AWS keys (`AKIA`), Stripe keys (`sk_live_`, `rk_live_`), GitHub PATs (`ghp_`, `github_pat_`), or suspicious long hex/base64 strings (32+ chars) hardcoded in code
2. **DEBUG** — No `console.log`, `console.debug`, or `debugger` statements in non-test production paths
3. **TODOS** — Flag any `TODO`, `FIXME`, or `XXX` comment markers
4. **INTENT** — Does the diff content match what a sensible commit message would say? Flag if scope is wildly inconsistent
5. **TESTS** — If feature/logic code changed, were acceptance tests also updated?
6. **TYPES** — No bare `any` types; no `@ts-ignore` without a trailing `// reason: ` comment
7. **SIZE** — If diff is very large (400+ lines), flag for manual review
8. **SCHEMA** — Supabase table reads/writes use column names that exist in the known schema (`deals`, `bets`, `trades`, `orders`, `transactions`)
9. **CONTRACTS** — API handler function signatures match their TypeScript types
10. **GROUNDING** — Hardcoded data that looks AI-generated or placeholder (fake names, lorem ipsum, placeholder UUIDs) gets flagged

**Output format:**

```
BLOCK: <what and why>
WARN:  <what and why>
PASS:  diff looks clean
```

After listing findings, give a one-line summary: `VERDICT: PASS | WARN | BLOCK` and say whether you'd let the commit through.

If anything is `BLOCK`: explain exactly what line to fix before committing.
