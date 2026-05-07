# Sprint 6 Backlog — 2026-05-07 EOD

> Compiled by autonomous research while Colin was AFK. Four parallel Explore agents + live Supabase + GitHub state. Every claim is grounded with a file path or DB query — no prose-only assertions.

## Where we are

**Harness: 100% complete.** All 21 components in `harness_components` at 100% (DB-verified 2026-05-07; matches `harness_tracker.md` memory). The autonomous infrastructure is shipped — coordinator/builder loop, sandbox, self-repair, deploy gate, twin Q&A, smoke test framework.

**Next frontier: GPU Day (91%) and Orb Day (90.3%).** Per `docs/gpu-day-readiness.md` (last updated 2026-05-05). The remaining gap is operational, not architectural.

**Today shipped 16 PRs** (#103–#118) including: 5 Streamlit ports (diet, health, oura, vehicles, family-expenses), AI Pick Engine schema (Chunk A), self-repair scanner v2, multi-window protocol enforcement, business-review fixes, vercel cron-count guard, tsc pre-commit gate, multi-window worktree enforcement (this session). Net: 30 of 105 Streamlit pages now ported (29%).

**Production health: clean.** Last 48h: 2 arms_legs HTTP errors only (`agent_events` query). No open incidents.

**Open PRs: 5** (1 stuck = #104 security lockdown failed Vercel cron-count, 1 awaiting Colin click = #41 Dropbox archiver). Three are pre-staged tasks with passing checks.

**Task queue: 32 queued + 7 awaiting_grounding + 2 approved** in `task_queue`.

**The single biggest systemic gap:** F18 (measurement-required) is declared but unenforced. **26 of 39 cockpit modules ship zero metrics, benchmark, or surfacing path** (67% non-compliance). Without metrics, the ARCHITECTURE.md §11 kill criterion ("measurably helping Colin make or save money") cannot be evaluated.

---

## Strategic posture

The architecture is locked. The harness is shipped. The remaining work splits cleanly:

1. **Finish the port** — 55 Streamlit pages still backlog. ~5 of them carry real revenue (PageProfit, Receipts, Arbitrage Scanner, Amazon orders unification, Receipts).
2. **Earn the metrics** — retrofit F18 onto shipped modules so the kill criterion is measurable.
3. **Wire the engine** — AI Pick Engine Chunks B+C+D (predictions → trades → calibration). Foundation already merged.
4. **Close protocol gaps** — multi-window edit-time scope, migration race, heartbeat orphans (4 gaps from #118 diagnosis).
5. **Connect behavioral ingestion** — 13 of 18 channels unwired; Twin will only become useful once data flows in.

Items below are organized by priority tier. Each has scope (XS/S/M/L/XL), why-it-matters, files, blockers, estimate.

---

## P0 — Finish-line / unblock

Quick-win surgical fixes. Small effort, high impact, no blockers.

### P0-1: Unblock PR #104 (security lockdown — 50 RLS policies)

- **Scope:** XS · **Estimate:** 5–15 min
- **Why:** Migrations 0138/0139 are already applied to prod. The remaining piece (auth UI + RLS gates) is queued behind a Vercel cron-count failure. Half-applied security migrations are tail risk.
- **Blocker:** PR pre-dates #112 (cron-count hotfix). Failed Vercel build with `Vercel: FAILURE` (gh PR data 2026-05-07 12:09).
- **Fix:** Rebase `security/lockdown-phase-0-4` onto current main, force-push. Vercel auto-redeploys. Sub-blocker per Window 2 handoff: `useSearchParams()` not in `<Suspense>` at `/login` — one-line wrap.
- **Files:** `app/login/page.tsx`, then rebase.
- **Verify:** `gh pr checks 104` shows green.

### P0-2: Approve PR #41 (Dropbox Archiver acceptance doc)

- **Scope:** XS · **Estimate:** 1 click + read
- **Why:** Sitting since 2026-05-01. All checks green. Solely awaiting human approval.
- **File:** read the acceptance doc in the PR diff, then `gh pr merge 41 --squash --delete-branch`.

### P0-3: Add `scripts/window-*.mjs` + `.husky/` + `.claude/` to shared-seam list

- **Scope:** XS · **Estimate:** 10 min
- **Why:** PR #118 just shipped multi-window enforcement. Today another window could silently edit `window-start.mjs` and break it for everyone — exactly the class of bug we just closed. Today's seam list (in `.husky/commit-msg`) covers `package.json`, `middleware.ts`, etc., but NOT the protocol scripts themselves.
- **Files:** `.husky/commit-msg` (regex), `.claude/CLAUDE.md` (seam list paragraph), tests in `tests/multi-window/seam-list.test.ts`.
- **Done when:** editing `scripts/window-start.mjs` from any window without `[seam-approved]` blocks the commit.

### P0-4: Wire night-watchman scan back to a cron home

- **Scope:** S · **Estimate:** 30 min
- **Why:** PR #112 deleted the standalone `*/30 4-13 * * *` cron to fix Vercel Hobby's 18-cron limit. The scanner is functional but never auto-runs. Per `notes/cross-window-suggestions.md` v2.1.
- **Options:** (a) Invoke `runScan()` from `app/api/cron/night-tick/route.ts` (existing cron, no new slot). (b) Upgrade Vercel to Pro (paid). Default: (a).
- **Files:** `app/api/cron/night-tick/route.ts`.

### P0-5: Move OLLAMA_TUNNEL_URL from process.env to harness_config

- **Scope:** XS · **Estimate:** 15 min
- **Why:** Task in `task_queue` (id `c00e54e0`). Aligns with the runtime-config-pattern rule — env vars don't survive process boundaries. Tunnel URL changes require code redeploy today.
- **Files:** `lib/ollama/client.ts`, harness_config seed.

### P0-6: Close orphan local branches with `[gone]` upstream

- **Scope:** XS · **Estimate:** 5 min
- **Why:** `git branch -vv` shows ~10 branches whose origin was deleted (squash-merged). Cleanup hygiene.
- **Cmd:** `git branch -vv | awk '/: gone]/{print $1}' | xargs -n1 git branch -D`

---

## P1 — Active in-flight tracks (continue)

Foundation already merged; finish the obvious next step.

### P1-1: AI Pick Engine Chunk B (Trading)

- **Scope:** M · **Estimate:** 3–4h
- **What:** Daily 7am cron, scan ~14 instruments via yfinance, 5-factor scoring → `predictions` table → Telegram dispatch. Weekly tune cron (Claude proposes new weights).
- **Acceptance doc:** `docs/acceptance/ai-pick-engine-chunk-b-trading.md` (already pre-staged)
- **Files:** `lib/trading/scanner.ts`, `market-data.ts`, `scoring.ts`, `learn.ts`; `app/api/cron/trading-picks-scan/route.ts`; `app/api/cron/trading-weights-tune/route.ts`; `app/(cockpit)/trading/page.tsx`.
- **Worktree ready:** `lepios-aipe-b` exists (no junctions yet — needs setup before launch).
- **Dependencies:** Schema (✓ #110), `lib/cache/`, `outbound_notifications`, `requireCronSecret`.

### P1-2: AI Pick Engine Chunk C (Sports)

- **Scope:** M · **Estimate:** 3–4h, parallel-safe with B
- **What:** Daily 8am Odds API → Claude analysis → predictions. 11pm resolve cron. Sunday tune cron (auto-adjust weights — new vs Streamlit).
- **Acceptance doc:** `docs/acceptance/ai-pick-engine-chunk-c-sports.md`
- **Files:** `lib/sports/odds.ts`, `coach.ts`, `scanner.ts`, `learn.ts`; `app/(cockpit)/sports/page.tsx`.
- **Worktree ready:** `lepios-aipe-c` exists.
- **Dependencies:** Schema (✓), Odds API key, Anthropic SDK (already wired).

### P1-3: AI Pick Engine Chunk D (Calibration + Trust Gate)

- **Scope:** M · **Estimate:** 3h
- **What:** `/calibration` page: hit rate by grade, calibration plot, drawdown. Trust Gate state machine — all 5 metrics must pass to unlock "Go Live". Threshold editor (no redeploy).
- **Acceptance doc:** `docs/acceptance/ai-pick-engine-chunk-d-calibration.md`
- **Files:** `lib/trust/state.ts`, `gate.ts`, `lib/calibration/metrics.ts`.
- **Dependencies:** Chunks B + C must have ≥1 day prediction history (trading ≥30 resolved, sports ≥50). **Sequence after B/C.**

### P1-4: Health module — finish F18 surfacing

- **Scope:** S · **Estimate:** 1h
- **Why:** Health is 1 of 3 modules with metrics capture (oura_daily) but no benchmark or surfacing path. Closest to F18-compliant.
- **Files:** Add benchmark + surfacing widget to `app/(cockpit)/health/`.

### P1-5: AI Chat UI polish (PR #74 follow-on)

- **Scope:** S · **Estimate:** 1–2h
- **Why:** 60→75% complete per Window 1 handoff. Twin tool bridge works. Mobile polish + render layer remaining.
- **Files:** `app/(cockpit)/chat/`, `lib/ollama/client.ts`.
- **Related task:** orb-A1 (`14ec2466`), orb-B5 streaming (`8ca50976`).

---

## P2 — High-value Streamlit ports remaining

55 pages still backlog. Top 5 by revenue impact / data gravity:

### P2-1: Port `21_PageProfit.py` — barcode scanning station

- **Scope:** XL · **Estimate:** 3 sessions
- **Why:** Core revenue. 3373 lines. Multi-marketplace barcode scan (Amazon/eBay/Buyback), hit-list, rejection analytics. Daily-use revenue tool.
- **Strategy:** Split into 3 chunks — scanner UI, hit-lists, analytics. Parallelizable.
- **Source:** `streamlit_app/pages/21_PageProfit.py`
- **Target:** `app/(cockpit)/scan/`, `lib/scan/`.
- **Note:** Barcode component (html5-qrcode) verified in audits.

### P2-2: Port `12_Receipts.py` — receipt OCR + dual-write

- **Scope:** L · **Estimate:** 1.5 sessions
- **Why:** 2640 lines. Drives every transaction's audit trail. Camera capture + Claude Vision OCR + Drive archive + dual-write to Supabase. Colin uses daily.
- **Source:** `streamlit_app/pages/12_Receipts.py`
- **Target:** `app/(cockpit)/receipts/`, `lib/receipts/`.

### P2-3: Port `46_Arbitrage_Scanner.py` — arb deal finder

- **Scope:** M · **Estimate:** 1 session
- **Why:** Telegram-bot already runs the scan (2 PM + 8 PM MT, telegram_bot.py:1259). LepiOS UI for deal cards + Buy/Skip callbacks missing. Margin-capture revenue tool.
- **Source:** `telegram_bot.py:1259-1293`, `arb_engine/`.
- **Target:** `app/(cockpit)/deals/` or `/money`.
- **Partial work:** PR #80 has callback handler half-built.

### P2-4: Port `62_eBay.py` — eBay order sync (parity with `60_Amazon_Orders`)

- **Scope:** M · **Estimate:** 1 session
- **Why:** Amazon orders shipped (PR #94). eBay missing → multi-marketplace order reconciliation incomplete. Drives monthly business review accuracy.
- **Files:** `lib/ebay/`, `app/(cockpit)/ebay-orders/`.
- **Existing:** `tests/ebay-fees.test.ts`, `tests/ebay-listings.test.ts` already exist.

### P2-5: Port `2_Trading_Journal.py` + `3_Sports_Betting.py`

- **Scope:** M · **Estimate:** 1 session, **gated on AIPE Chunks B+C**
- **Why:** Once predictions exist, log actual trades against them. Closes the loop for trust scoring.
- **Source:** `streamlit_app/pages/2_Trading_Journal.py`, `3_Sports_Betting.py`.
- **Target:** `app/(cockpit)/trading/`, `app/(cockpit)/betting/`.

**Do NOT port** (per `audits/streamlit-full-inventory.md`):

- `20_Scout.py` (dead — `st.stop()` redirect)
- `23_Expense_Dashboard.py` (merged into 4_Monthly_Expenses, ported via PR #98)
- `37_Command_Centre.py`, `78_Automations.py`, `99_n8n_Webhook.py` (n8n bot token hardcoded — security gate required)
- `84_Agent_Swarm.py` (CrewAI not in requirements; local-dev only)
- `96_GPU_Day.py`, `98_Debug.py` (infra/dev internal)

---

## P3 — F18 enforcement campaign (the systemic gap)

**67% of shipped cockpit modules have zero metrics.** This is the biggest systemic technical debt in the project. F18 is declared mandatory but unenforced.

### P3-1: F18 audit — table of every shipped module + compliance status

- **Scope:** S · **Estimate:** 30 min
- **Status:** Done above (Strategic Destination agent report §D). Reproduce as a tracked doc.
- **Output:** `docs/f18-compliance.md` — per-module checklist.

### P3-2: F18 retrofit campaign — 26 modules

- **Scope:** XL · **Estimate:** 4–6 sessions
- **Why:** Without measurement, kill criterion (§11) is unknowable. Without benchmarks, "20% better" is unmeasurable.
- **Strategy:** Per module, ship the minimum viable:
  - **Capture:** event into `agent_events` on every read/write
  - **Benchmark:** explicit number (industry / Streamlit / Colin target)
  - **Surfacing:** widget on the module page or in `morning_digest`
- **Priority order:** (1) revenue modules first (amazon, bookkeeping, betting), (2) financial modules (life-pnl, monthly-expenses, net-worth, cash-forecast), (3) operational (diet, oura, health), (4) reference (annual-review, balance-sheet).

### P3-3: F18 CI gate — block new modules without metrics

- **Scope:** S · **Estimate:** 1h
- **Why:** Stop the bleeding before retrofitting. Any new `app/(cockpit)/X/page.tsx` must include an `agent_events` insert + a benchmark const + appear in a digest surfacing.
- **File:** `eslint.config.mjs` (custom rule) or pre-commit grep.

---

## P4 — Behavioral ingestion gaps

13 of 18 channels in `docs/vision/behavioral-ingestion-spec.md` §5 are unwired. The Twin can't surface patterns without data.

| Channel                     | Status    | Wire-up scope                                            |
| --------------------------- | --------- | -------------------------------------------------------- |
| Weather API (hourly)        | Not wired | S — `app/api/cron/weather-tick/`, `lib/weather/`.        |
| MileIQ driving data         | Not wired | M — CSV parser + Drive sync. Mileage table exists.       |
| Plaid bank balance          | Not wired | L — Plaid API + sandbox first.                           |
| Trading P&L (auto)          | Not wired | M — depends on AIPE Chunk B + broker API.                |
| Sportsbook P&L (auto)       | Not wired | L — PlayAlberta scraping (legal review needed).          |
| Mood/energy/focus prompt    | Not wired | S — daily Telegram prompt + `mood_log` table.            |
| Megan/daughter status       | Not wired | S — same pattern as mood.                                |
| Derm flare 0–3 daily        | Not wired | XS — `daily_prompt_log` row + UI tile.                   |
| Family friction events      | Not wired | S — free-form Telegram `/friction <description>`.        |
| Telegram-bot inbound corpus | Partial   | M — capture every inbound message into knowledge corpus. |
| Gmail sent folder           | Not wired | M — extend `gmail-scan` to send folder.                  |
| Outcomes inference          | Not wired | XL — passive behavior tagging engine. **Sprint 7+.**     |
| Correlation surfacing       | Not wired | L — pattern detector → Twin → digest. **Sprint 7+.**     |

**P4-1:** Mood/energy/focus daily prompt — XS, highest signal density per dollar (S — 1.5h).
**P4-2:** Weather ingestion (hourly, 1 API key) — S (1h).
**P4-3:** Bills-due Gmail extension — M (3h, leverages existing gmail-scan).

---

## P5 — Multi-window protocol hardening

PR #118 closed gap #1 (worktree enforcement + shared claim store). 4 gaps remain from the diagnosis:

### P5-1: Edit-time scope drift detection

- **Scope:** M · **Estimate:** 2–3h
- **Why:** Today, scope violations only fire at commit time. Claude can write an hour of out-of-scope code before learning. With 5 windows, 5 hours of wasted work is possible.
- **Strategy:** File-watcher hook (`scripts/window-watch.mjs`) launched alongside `window-start.mjs`. Watches the working tree; warns immediately on any out-of-scope edit.
- **Files:** `scripts/window-watch.mjs` (new), update `window-start.mjs` to launch watcher in background.

### P5-2: Migration claim race — fetch-before-claim

- **Scope:** S · **Estimate:** 45 min
- **Why:** Today PR #110 already lost a race for migration 0141 → had to renumber to 0142. `migration-claims.json` is committed but each window plans against a stale snapshot.
- **Fix:** `window-start.mjs` runs `git fetch origin main` first, then warns if local `.claude/migration-claims.json` differs from origin.
- **Files:** `scripts/window-start.mjs`.

### P5-3: Claim heartbeat orphan auto-prune

- **Scope:** S · **Estimate:** 1h
- **Why:** Dead-window claim files linger forever unless someone runs `window-status --prune`. Stale `STALE_MS=30min` threshold exists in code but no auto-runner.
- **Fix:** (a) Background heartbeat in `window-start.mjs` — every 5 min, bump `last_heartbeat`. (b) Pre-commit hook also prunes (it already does — verify it's actually running).
- **Files:** `scripts/window-start.mjs` (background timer), `.husky/pre-commit`.

### P5-4: Global-resource budget tracker

- **Scope:** L · **Estimate:** 1 session
- **Why:** Vercel cron count, FK cycles, env-var ceilings — silent resource contention. PR #114 fixed crons; same pattern needed for: env vars (Vercel's 30-secret limit), package.json deps count, Supabase RLS policy count per table.
- **Strategy:** `harness_resource_budgets` table + pre-commit `check-budgets.mjs` extending the cron-count pattern.
- **Files:** `scripts/check-budgets.mjs`, migration 0159 (next available — `migration-claims.json` shows next is 159), `.husky/pre-commit`.

---

## P6 — Night-watchman v2.1 (5 stub checks + repair)

`lib/night_watchman/` ships with 6 modules; some checks are placeholders. Per Window 2 handoff "Job C".

### P6-1: Wire `security.gitleaks_delta`

- **Scope:** S · **Estimate:** 1.5h
- **Why:** Detect new secret leaks night-over-night. Codebase already has gitleaks references (PR #88 RLS hardening).
- **Files:** `lib/night_watchman/checks/security.ts`.

### P6-2: Wire `security.dependabot_critical`

- **Scope:** S · **Estimate:** 1h
- **Why:** Stop dependabot CVEs from rotting unread.
- **Files:** GitHub API call from `lib/night_watchman/checks/security.ts`.

### P6-3: Wire `data.schema_drift`

- **Scope:** M · **Estimate:** 2h
- **Why:** Sleep through migrations that diverge from `information_schema`. Mitigates F-L3 (table-name drift).
- **Files:** `lib/night_watchman/checks/data.ts`.

### P6-4: Wire `performance.route_latency_p95`

- **Scope:** M · **Estimate:** 2h
- **Why:** Catch latency regressions. Vercel Analytics API + 7-day baseline.
- **Files:** `lib/night_watchman/checks/performance.ts`.
- **Blocker:** Requires `VERCEL_TOKEN` in `harness_config`.

### P6-5: Wire `performance.slow_query_log`

- **Scope:** M · **Estimate:** 2h
- **Why:** pg_stat_statements gives top-N slowest queries. Surface to digest.
- **Files:** `lib/night_watchman/checks/performance.ts`.
- **Blocker:** Need `pg_stat_statements` enabled on Supabase project.

### P6-6: Self-repair status page

- **Scope:** M · **Estimate:** 1 session
- **Why:** Per Window 2 handoff "Job B". The DB has `night_watchman_runs` + `night_watchman_check_results`; just needs a viewer UI.
- **Files:** `app/(cockpit)/self-repair/page.tsx`, `lib/night_watchman/queries.ts`.

---

## P7 — task_queue summary (32 queued + 7 awaiting_grounding + 2 approved)

Live state from Supabase 2026-05-07.

**P1 priority (highest, 2 approved):**

- `H1: Fix drain 403 — coordinator notification delivery broken` (`8a9dcb62`, 20min, claimed)
- `H3: Pickup ordering — FIFO guarantee within priority tier` (`9b95359e`, 45min, claimed)

**Awaiting_grounding (7) — coordinator needs Colin or Twin input:**

- `streamlit_rebuild_tax_centre` (`af44ba61`)
- `orb-A5: markdown + code blocks in chat` (`c809687c`)
- `orb-A1: streaming chat UI` (`14ec2466`)
- `orb-A2: conversations + messages schema with RLS` (`56e2e9c0`)
- `orb-B5: Ollama streaming mode` (`8ca50976`)
- `Sprint 5 button-data-invalid` (`6d4f2276`)
- `Fix coordinator drain_trigger_failed` (`b93658c2`)

**Priority 7 (`knowledge_dedupe` only) — high-value, simple:**

- `94748a6f` — knowledge_dedupe — run `dedupeKnowledge()` against current Twin corpus.

**Priority 5 cluster — Streamlit Python script ports (7 tasks):**

- `utils/__init__.py`, `diag_coverage.py`, `backfill_daily_profit.py`, `data_crawler.py`, `migrate_hubdoc.py`, `backfill_cogs.py`, `import_stock_history.py`, `smoke_test.py`, `fix_receipts_now.py`.
- These are SCRIPT ports (not pages). Lower visibility, higher data-pipeline impact. Could batch as "Sprint 6 backfill batch" — 1 session combined.

**Priority 4–3 cluster — coordinator + harness polish (~10 tasks):**

- Branch naming fix, status check constraint fix, hourly task pickup design, Chunk D v2 statement coverage, ingest health notes, F18 ceiling metric layer, builder commit_sha tracking, stall_count logging, branch pre-config, OLLAMA_TUNNEL_URL move (P0-5 above), monitoring whitelist.

**Recommendation:** Run a "task_queue grooming" session (1 hour) to:

1. Dismiss tasks superseded by today's work
2. Promote `knowledge_dedupe` (P7) and `OLLAMA_TUNNEL_URL` move (P3) to next-up
3. Batch the 9 Streamlit script ports into one PR

---

## Strategic moves (multi-week)

### S-1: F18 retrofit campaign

See P3 above. Single biggest leverage move. Until 80%+ of modules ship metrics, the kill criterion is unmeasurable.

### S-2: Behavioral ingestion buildout

See P4 above. Without ingestion, the Twin is a search engine over a stale snapshot.

### S-3: Streamlit decommission plan

Once ports cover the daily-use modules (PageProfit + Receipts + Bookkeeping + Amazon Orders), set a hard date to retire the Streamlit OS. Currently 30/105 ported (29%). Target: 60% by Sprint 8.

### S-4: Multi-user gate (Sprint 5+)

Several backlog items depend on this: `38_Paper_Trail` (audit log viewer), `70_Family` (family dashboard), `87_Coras_Future`. Already partially shipped via PR #104 (RLS roles: admin/business/personal/accountant/pending). Needs the auth UI to land.

---

## Starter prompts (paste-and-go for highest-priority items)

### Start P0-1 (unblock #104)

```
Branch: security/lockdown-phase-0-4
Worktree: create new — `git worktree add ../lepios-104-fix security/lockdown-phase-0-4`
Task: Rebase onto current main, fix the useSearchParams() Suspense wrap at /login,
      push, watch Vercel turn green. PR #104 unblocks 50 RLS policies that have
      already been applied to prod via migrations 0138/0139 — half-applied
      security state must be closed.
Acceptance: gh pr checks 104 shows green, PR auto-merges.
```

### Start P1-1 (AIPE Chunk B)

```
Worktree: c:\Users\Colin\Downloads\Claude_Code_Workspace_TEMPLATE (1)\lepios-aipe-b
Branch: feat/ai-pick-engine-chunk-b (already created)
Acceptance doc: docs/acceptance/ai-pick-engine-chunk-b-trading.md
Task: Implement Trading chunk per acceptance doc.
      Build daily 7am cron + scoring + Telegram + /trading page +
      weekly tune cron.
Scope (window-start.mjs):
  --scope "lib/trading/**"
  --scope "app/api/cron/trading-*/**"
  --scope "app/(cockpit)/trading/**"
  --scope "tests/trading/**"
  --scope ".claude/migration-claims.json"
  (no migrations expected — Chunk A schema covers it)
```

### Start P1-2 (AIPE Chunk C)

```
Worktree: c:\Users\Colin\Downloads\Claude_Code_Workspace_TEMPLATE (1)\lepios-aipe-c
Branch: feat/ai-pick-engine-chunk-c
Acceptance doc: docs/acceptance/ai-pick-engine-chunk-c-sports.md
Task: Implement Sports chunk per acceptance doc.
Scope:
  --scope "lib/sports/**"
  --scope "app/api/cron/sports-*/**"
  --scope "app/(cockpit)/sports/**"
  --scope "tests/sports/**"
```

### Start P5-1 (edit-time scope drift)

```
Worktree: new — `git worktree add ../lepios-edit-watch -b chore/window-edit-watch origin/main`
Task: Build scripts/window-watch.mjs — file-watcher that wraps a window session.
      Reads the active claim's scope. Watches the working tree. On any edit,
      checks file against scope. Out-of-scope edit → console warning immediately
      (don't block — too aggressive). Window-start.mjs launches it in
      background; window-end.mjs kills it.
Scope:
  --scope "scripts/window-*.mjs"
  --scope "scripts/lib/window-claim.mjs"
  --scope "tests/multi-window/**"
  --scope ".claude/CLAUDE.md"
```

---

## Recommended next-session shape

If Colin is back with ~3 hours: **finish PR #104 + launch AIPE Chunks B+C in parallel windows**. That's:

- This window (or new one): unblock #104 (P0-1, ~15 min) → groom task_queue (~30 min) → join the AIPE work as connective tissue.
- `lepios-aipe-b`: Chunk B build (~3h, paste P1-1 starter).
- `lepios-aipe-c`: Chunk C build (~3h, paste P1-2 starter).

End state: predictions + trades + sports running for 24h before Chunk D's calibration page goes live.

If Colin is back with ~30 min: **just run P0-1 + P0-2 + P0-3** (security unblock + Dropbox approval + seam-list expansion). Banks 3 unambiguous wins, then close.

If Colin wants the biggest swing: **F18 retrofit campaign** (P3). Multi-session, but moves the project from "shipped a lot" to "shipped + measurable" — the prerequisite for the kill criterion to mean anything.

---

## Grounding manifest

**Agent reports compiled by:**

1. Strategic destination agent — read `ARCHITECTURE.md`, `docs/vision/behavioral-ingestion-spec.md`, `docs/vision/measurement-framework.md`, `docs/gpu-day-readiness.md`, `lib/rules/registry.ts`. Output: 13 of 18 ingestion channels unwired; 26 of 39 modules F18-noncompliant.
2. Streamlit port audit — enumerated all 105 pages in `streamlit_app/pages/`; cross-referenced with LepiOS `app/(cockpit)/` and merged PRs. Output: 30 ported, 8 in flight, 55 backlog, 5 deprecate, 7 security-blocked.
3. Stuck PRs / failures agent — `gh pr list`, `git branch -vv`, `docs/claude-md/failures.md`, `docs/claude-md/successes.md`, `notes/cross-window-suggestions.md`. Output: PR #104 stuck, PR #41 awaiting click, 6 cross-window-suggestion items.
4. Harness + AIPE + multi-window agent — read 4 harness component docs, 4 AIPE acceptance docs, all `lib/night_watchman/` files. Output: harness 100%, AIPE B/C/D specs complete, 4 multi-window gaps remaining, 5 night-watchman stubs.

**Live state queries:**

- `harness_components` — DB rollup 100% across 21 components (2026-05-07).
- `task_queue` — 32 queued + 7 awaiting_grounding + 2 approved + 11 cancelled + 32 completed.
- `agent_events` 48h — 2 arms_legs HTTP errors only; production clean.
- `gh pr list --state open` — 5 PRs, 1 stuck (#104), 1 click-ready (#41).
- Recently merged 2026-05-07 — 16 PRs (#103–#118).

**Cross-checked against:**

- `MEMORY.md` index (harness_tracker.md, session_handoff.md, feature_backlog.md, multi_window_worktree_pattern.md)
- `.claude/migration-claims.json` (next free: 0159)
- `git worktree list` (4 active + this window's about-to-clean)

Compiled 2026-05-07. Refresh on next session start.
