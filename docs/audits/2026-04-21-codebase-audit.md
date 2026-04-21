# Codebase Audit — LepiOS — 2026-04-21

Static analysis only. No test runs, no network calls, no file modifications.
Scope: app/, lib/, scripts/, tests/, supabase/migrations/, docs/, CLAUDE.md.
Excluded: node_modules/, .next/, .git/, this file.

---

## Section 1: TODO / FIXME / HACK inventory

3 actionable items found. 2 script-documentation references excluded (ai-review.mjs:19 and :78 mention "TODO" as part of the reviewer's prompt text, not code todos).

| File | Line | Comment | Category | Resolution |
| --- | --- | --- | --- | --- |
| `app/api/bets/route.ts` | 60 | `// TODO Sprint 5: derive person_handle from user session mapping` | missing-feature | Requires a sessions-to-handle mapping or a custom JWT claim; currently hardcodes the handle which bypasses per-user RLS intent |
| `lib/keepa/product.ts` | 14 | `// TODO: tune thresholds against real sell-through data (Sprint 3+).` | tech-debt | Velocity badge thresholds (rankDrops, monthlySold) need calibration against actual sell-through; blocked on having enough scan history |
| `lib/profit/calculator.ts` | 2 | `// TODO: move to user settings (these are tuning parameters, not constants)` | tech-debt | ROI threshold and fee constants hardcoded; moving to a user_settings table would allow per-user tuning without deploys |

---

## Section 2: Dead code and orphans

### 2.1 Files not imported by production code

These files exist and have tests, but are never called from any API route, page, or lib used by routes/pages.

**`lib/safety/checker.ts`**
Imported only by `tests/safety-checker.test.ts`. No API route, middleware, pre-commit step,
or orchestrator check calls `runSafetyChecks()`. The checker is fully tested (24 tests) but
not integrated into any running code path.

**`lib/handoffs/client.ts`**
Imported only by one-shot scripts (`scripts/backfill-handoffs.ts`, `scripts/seed-real-knowledge.ts`)
and its test file. Not called by any API route, cron, or page. The session handoff pattern was
designed for session bridging but never wired into a route (e.g., morning digest could call
`saveHandoff()` to persist session state automatically).

**`lib/utils.ts`**
Exports `cn()` (Tailwind class merge helper via clsx/tailwind-merge). Zero imports found in
any file under app/ or lib/. Either unused or components use inline class strings instead.

### 2.2 Orphaned API route

**`app/api/deals/route.ts`**
The money page (`app/(cockpit)/money/page.tsx:155`) queries the `deals` table directly via a
Supabase server client, not via this API route. No fetch call to `/api/deals` found in any
frontend file. The route may be a leftover from early development or a planned-but-unlinked
endpoint.

Note: The other cron-only routes (`/api/metrics/digest`, `/api/cron/night-tick`,
`/api/cron/morning-digest`, `/api/knowledge/nightly`) are all registered in `vercel.json`
and are intentionally schedule-triggered — not orphaned. `/api/ollama/health` is session-auth
protected and appears to be a manual diagnostic endpoint, not schedule-triggered.

### 2.3 Migration tables with zero query references

Checked tables created in migrations 0004–0014 against all app/, lib/, tests/ source files.

| Table | Migration | Status |
| --- | --- | --- |
| `scan_results` | 0004 | Active — used in scan route and multiple reads |
| `agent_events` | 0005 | Active — heavily used |
| `keepa_history_cache` | 0008 | Active — `lib/keepa/history.ts:90,111` |
| `hit_lists` | 0010 | Active — hit-lists routes |
| `hit_list_items` | 0010 | Active — hit-lists routes |
| `knowledge` | 0011 | Active — `lib/knowledge/client.ts`, `lib/knowledge/patterns.ts` |
| `session_handoffs` | 0012 | Active — `lib/handoffs/client.ts:42,46,65,84` |
| `task_feedback` | 0014 | **ORPHANED** — table created and RLS enabled; zero reads or writes anywhere in app/ or lib/ |

`task_feedback` is the planned write target for §11.1 (Telegram thumbs), which is deferred.

---

## Section 3: Inconsistencies and conventions

### 3.1 `console.error` where `logError` would be the convention

`lib/knowledge/client.ts:163,173` are self-referential (inside `saveKnowledge` itself —
cannot call logError recursively). These are acceptable and noted as expected.

The remaining 7 sites are in Amazon/Keepa libraries that predate the logError convention
and still use raw console output:

| File | Lines | Note |
| --- | --- | --- |
| `lib/amazon/catalog.ts` | 47 | `console.error('[findAsin] all attempts failed...')` |
| `lib/keepa/client.ts` | 45, 50, 58 | Three console.error paths in keepaFetch |
| `lib/keepa/history.ts` | 61, 66, 74 | Three console.error paths in getBsrHistory |

These errors currently disappear into Vercel function logs with no agent_events trace.

### 3.2 Routes writing directly to agent_events (bypassing logEvent)

After the group 7 migration, one direct insert remains:

**`app/api/bsr-history/route.ts:20`**
```ts
await supabase.from('agent_events').insert({
  domain: 'pageprofit',
  action: 'bsr_sparkline',
  ...
})
```
This is conditional (cache-miss only), but it bypasses `logEvent` and manually assembles
the row. No error path logging either.

### 3.3 Undocumented env vars

Vars referenced via `process.env` in code but absent from `.env.example`:

| Var | Used at |
| --- | --- |
| `OLLAMA_TUNNEL_URL` | `lib/ollama/client.ts:27,110` — .env.example documents `OLLAMA_BASE_URL` instead (wrong key name) |
| `OLLAMA_CODE_MODEL` | `lib/ollama/client.ts:32` |
| `OLLAMA_ANALYSIS_MODEL` | `lib/ollama/client.ts:33` |
| `OLLAMA_GENERAL_MODEL` | `lib/ollama/client.ts:34` |
| `OLLAMA_EMBED_MODEL` | `lib/ollama/client.ts:35` |

`VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are Vercel-injected at runtime; omitting
them from .env.example is correct. `AI_REVIEW_DRY_RUN` is a CI testing shim in
`scripts/ai-review.mjs:20`; acceptable to omit from app .env.example.

Vars documented in `.env.example` with no corresponding process.env read in code:

| Var | Note |
| --- | --- |
| `OLLAMA_BASE_URL` | Code uses `OLLAMA_TUNNEL_URL` instead; this entry is stale |
| `AMAZON_SELLER_ID` | Present in .env.example; no `process.env.AMAZON_SELLER_ID` read found anywhere |

### 3.4 Skipped or todo'd test blocks

None found.

---

## Section 4: Type safety gaps

### 4.1 `any` usage per file

Zero. No `: any`, `as any`, `any[]`, or `Array<any>` found in app/, lib/, or tests/.
Code uses `unknown`, `Record<string, unknown>`, and explicit interfaces throughout.

### 4.2 `@ts-ignore` and `@ts-expect-error`

Zero. None found in any TypeScript file.

### 4.3 Type-only files with no consumers

All four type-only files are consumed:

| File | Imported by |
| --- | --- |
| `lib/knowledge/types.ts` | `lib/knowledge/client.ts`, `lib/knowledge/patterns.ts`, tests |
| `lib/handoffs/types.ts` | `lib/handoffs/client.ts`, `tests/handoffs-client.test.ts` |
| `lib/safety/types.ts` | `lib/safety/checker.ts`, `tests/safety-checker.test.ts` |
| `lib/orchestrator/types.ts` | `lib/orchestrator/scoring.ts`, `lib/orchestrator/tick.ts`, `lib/orchestrator/digest.ts`, tests |

No orphaned type files.

---

## Section 5: Security and secrets scan

### 5.1 Hardcoded tokens or secrets in source

No hardcoded API keys, tokens, or secrets found in app/, lib/, scripts/, supabase/, or docs/.
`lib/safety/checker.ts:89-91` contains regex patterns for detecting secrets (the detector
itself, not a secret).

### 5.2 .env files in the repo

`.env.local` is listed by `git ls-files .env.local` as tracked by git despite `.gitignore`
containing `.env*`. `git log --oneline -- .env.local` returns no commit history for this
file, which is contradictory and warrants manual investigation.

Recommended check: `git check-ignore -v .env.local` to confirm tracking state.

The first 4 lines of `.env.local` observed during this audit:
```
# LepiOS — Local Environment Variables
# DO NOT COMMIT — this file is gitignored
# Supabase (project: lepios, region: ca-central-1)
NEXT_PUBLIC_SUPABASE_URL=https://xpanlbcjueimeofgsara.supabase.co
```
The remaining 32 lines were not read. If the file contains live API keys and is genuinely
tracked (not just staged), `git rm --cached .env.local` is the remediation.

`audits/integrations-report.md:342` and `docs/security-log.md:114` contain the two revoked
Telegram tokens flagged as INC-002 in CLAUDE.md §5. Already documented; already revoked.
No new finding.

Only `.env.example` and `.env.local.example` are intentionally in the repo.

### 5.3 Permissive security settings

No `cors: '*'`, `allow-all`, or `Access-Control-Allow-Origin: *` found in any route.

---

## Section 6: Test coverage gaps

### 6.1 lib/ files with no test

| File | Functions (partial) | Risk |
| --- | --- | --- |
| `lib/amazon/catalog.ts` | `findAsin`, `getCatalogData` | High — core scan path, SP-API |
| `lib/amazon/client.ts` | SP-API HTTP client, token refresh | High — all SP-API calls flow through here |
| `lib/amazon/fees.ts` | `getFbaFees` | Medium — FBA fee calculation |
| `lib/amazon/pricing.ts` | `getUsedBuyBox` | Medium — buy box fetch |
| `lib/ebay/client.ts` | `ebayFetch` | Low — thin wrapper |
| `lib/knowledge/patterns.ts` | 6 analyzers, `nightlyLearn` | Medium — ~388 lines, no test |
| `lib/orchestrator/config.ts` | Constants only | Low |

### 6.2 app/api/ routes with no test

| Route | Risk |
| --- | --- |
| `app/api/scan/route.ts` | **High** — longest route, core revenue path; await/void discipline just changed in ad231c1 |
| `app/api/bets/[id]/route.ts` | Medium — PATCH/DELETE for individual bet |
| `app/api/hit-lists/[id]/route.ts` | Low |
| `app/api/hit-lists/[id]/items/[itemId]/route.ts` | Low |
| `app/api/knowledge/nightly/route.ts` | Low — thin cron wrapper |
| `app/api/metrics/digest/route.ts` | Low — thin cron wrapper |
| `app/api/ollama/health/route.ts` | Low — diagnostic only |
| `app/api/deals/route.ts` | Low — possibly orphaned (§2.2) |

### 6.3 Thin test files

| File | Test count | Flag |
| --- | --- | --- |
| `tests/betting-tile.spec.ts` | 5 | 170-line spec for a complex client component; no signal-computation tests |
| `tests/bsr-history.test.ts` | 7 | 70 lines; cache-hit/miss covered, error paths not visible |

---

## Section 7: Documentation drift

### 7.1 CLAUDE.md phase status (major drift)

`CLAUDE.md:11-14` states:

```
Phase 2 (Research Audits): IN PROGRESS
Phase 3 (Delegated Parallel Build): NOT STARTED
Phase 4 (Integration & Polish): NOT STARTED
No code changes during Phase 2. Research and inventory only.
```

Actual repo state as of 2026-04-21: The app is fully built and deployed to production at
`lepios-one.vercel.app`. SP-API scan routes are live, an autonomous night watchman runs
nightly crons, quality scoring is wired end-to-end, Telegram digests fire every morning,
and 370 tests pass. Phase 3 is complete. Phase 2's "no code" constraint was abandoned
at the start of the autonomous harness build.

### 7.2 Sprint 4 plan vs actual state

`docs/sprint-state.md:1-4`:
```yaml
active_sprint: 4
active_chunk: null
status: "in-acceptance-doc"
awaiting: "coordinator"
```

`docs/sprint-4/plan.md` describes Chunks A–E for a `/business-review` page. None of
these chunks were built. `app/(cockpit)/business-review/` does not exist. The sprint was
effectively abandoned in favour of the autonomous harness work (Steps 1–7). Sprint state
docs are stale.

### 7.3 "Last updated" date drift

No "Last updated" stamps found in docs/ files. Not applicable.

### 7.4 Broken internal links

No broken relative markdown links found. All file references in CLAUDE.md (ARCHITECTURE.md,
audits/migration-notes.md, docs/hallucination-log.md) resolve to existing files.

---

## Section 8: Quick wins (≤30 min each)

- **`.env.local` git tracking** (`git check-ignore -v .env.local`, then `git rm --cached .env.local` if tracked) — 2 min
- **`.env.example` Ollama key mismatch** — rename `OLLAMA_BASE_URL` → `OLLAMA_TUNNEL_URL`, add 4 model vars (`OLLAMA_CODE_MODEL`, `OLLAMA_ANALYSIS_MODEL`, `OLLAMA_GENERAL_MODEL`, `OLLAMA_EMBED_MODEL`), remove `AMAZON_SELLER_ID` — 5 min
- **CLAUDE.md phase status** — update Phase 2 → COMPLETE, Phase 3 → COMPLETE, Phase 4 → IN PROGRESS, remove "no code changes" constraint — 5 min
- **`app/api/bsr-history/route.ts:20`** — replace direct agent_events insert with `void logEvent(...)`, the one route not migrated in group 7 — 10 min
- **`lib/amazon/catalog.ts:47`** — replace `console.error` with `void logError(...)` to capture scan failures in agent_events (highest-value of the 7 console sites) — 10 min
- **`app/api/deals/route.ts`** — confirm orphan status (money page uses Supabase directly), then either delete or add a `// Called by: ...` comment if there's a planned consumer — 5 min
- **`task_feedback`** — add a `// Reserved for §11.1 Telegram thumbs` comment in migration 0014 so future audits don't flag it as accidentally orphaned — 3 min
- **`docs/sprint-state.md`** — update to reflect abandoned Sprint 4 / pivot to autonomous harness so a future session doesn't resume Sprint 4 Chunk A incorrectly — 10 min
- **`lib/amazon/fees.ts` and `lib/amazon/pricing.ts`** — add minimal unit tests (mock SP-API response, assert fee calculation math) for the two untested nodes on the core scan path — 25 min each
- **`lib/safety/checker.ts` wiring** — the checker has 24 tests but is called by nothing in production. Even a single call site (e.g., the pre-commit hook, or the cron tick) would start generating real safety signal — 20 min
