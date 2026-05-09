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

## 2026-05-07 — Telegram webhook /halt command routing

- Spotted by: `feat/self-repair-night-watchman-v2`
- Files involved: `app/api/telegram/webhook/route.ts` (out of scope), `app/api/self-repair/halt/route.ts` (in scope, shipped)
- Why noted: the night-watchman ships `POST /api/self-repair/halt` as the killswitch backing endpoint. The spec wanted a Telegram `/halt` chat command — that requires adding a parser branch in the webhook route to call the halt endpoint when Colin types `/halt` in Telegram. Webhook route is out of this PR's scope.
- Suggested action: small PR scoped to `app/api/telegram/webhook/route.ts`. Recognize `/halt [reason]` and `/resume` commands sent by Colin's chat ID; POST to the halt endpoint with appropriate body. ~30 lines.

---

## 2026-05-07 — security_score_history table dependency for security window

- Spotted by: `feat/self-repair-night-watchman-v2`
- Files involved: future `lib/security/score-history.ts` (security-window scope), `lib/night_watchman/checks/security.ts` (already in repo, has unregistered slot)
- Why noted: the night-watchman spec called for a `security.security_score_drop` check that reads from a `security_score_history` table. That table doesn't exist yet — it's owned by the security window. Q1 resolution was to skip the check in v2 and re-add once the table lands.
- Suggested action: when the security window builds `security_score_history`, register the missing check at `lib/night_watchman/checks/security.ts`. Wire-up is a 30-line addition; the persistence + escalate plumbing is already in place.

---

## 2026-05-07 — night_watchman_digest cron should eventually merge into morning_digest

- Spotted by: `feat/self-repair-night-watchman-v2`
- Files involved: `lib/orchestrator/digest.ts` (out of scope), future `app/api/cron/night_watchman_digest/route.ts`
- Why noted: Q6 resolution was to ship a separate night_watchman_digest cron at 07:30 MT (13:30 UTC) instead of editing the existing morning_digest. v2 ships only the scan cron — the separate digest cron is itself a v2.1 follow-up since the morning_digest merge is the cleaner long-term home.
- Suggested action: in v2.1, either (a) build the standalone digest cron at `app/api/cron/night_watchman_digest/route.ts` rendering via `renderDailyRollup()` from `lib/telegram/templates.ts`, OR (b) extend `lib/orchestrator/digest.ts` to append a night-watchman section using the same template helper. (b) is lower long-term cost; (a) is in-scope for night-watchman.

---

## 2026-05-07 — harness_components auto-bump on night_watchman repair_success

- Spotted by: `feat/self-repair-night-watchman-v2`
- Files involved: `lib/harness/rollup.ts` (out of scope), `lib/night_watchman/persistence.ts` (in scope)
- Why noted: Q5 resolution was to emit `agent_events { domain: 'night_watchman', action: 'repair_success' }` rather than write directly to `harness_components`. The night-watchman now emits these events but the existing rollup doesn't yet listen for `night_watchman.repair_success`. Auto-bump won't happen until rollup is taught the new signal.
- Suggested action: small PR scoped to `lib/harness/rollup.ts` to add `night_watchman.repair_success` to the auto-bump trigger list. ~10 lines.

---

## 2026-05-07 — Night-watchman v2.1 follow-up checks

- Spotted by: `feat/self-repair-night-watchman-v2`
- Files involved: `lib/night_watchman/checks/security.ts`, `lib/night_watchman/checks/data.ts`, `lib/night_watchman/checks/performance.ts`, `lib/night_watchman/repairs/sandbox-gated.ts`
- Why noted: five check slots ship as `skipped` placeholders in v2 and one repair tier has no eligible surfaces. They're visible in the registry so the slot shows in /self-repair status grid, but they always return `skipped` until the wiring lands.
- Suggested action: v2.1 wires (in priority order):
  1. `data.schema_drift` — store pg_catalog hash baseline in `harness_config`, compare on each run.
  2. `security.gitleaks` — read latest GitHub Actions run via GitHub REST API + `GITHUB_TOKEN` (harness_config or vault).
  3. `security.dependabot_critical` — GitHub Dependabot API.
  4. `performance.route_latency_p95` — Vercel Analytics API.
  5. `performance.slow_query_log` — Supabase logs API + `pg_stat_statements`.
  6. Sandbox-gated repair surfaces — pick first eligible (e.g. cron-handler retry-loop tightening) and wire `attemptSandboxRepair()` to draft + sandbox + PR pipeline.

---

## 2026-05-09 — Should /coordinator and /autonomous merge into one page?

- Spotted by: `fix/coordinator-harness-state`
- Files involved: `app/(dashboard)/coordinator/page.tsx`, `app/(dashboard)/autonomous/page.tsx`
- Why noted: Colin asked about unifying these. /autonomous already has a "Coordinator" tile that duplicates /coordinator's loop-state display, so there is real overlap.

**What each page does:**

- `/coordinator` — task management view: queue depth, loop state, live queue list, recent completions. Answers "what is the harness doing right now?"
- `/autonomous` — ops/analytics view: 30-day success rate, safety flag trends, error type bars, knowledge health, Ollama status, coordinator tile. Answers "how healthy is the system?"

**Recommendation: don't merge, but do these two smaller things instead:**

1. **Remove the Coordinator tile from /autonomous** — it now lives at full fidelity on /coordinator with the 4-state display and `stateChangedSub`. The mini-tile on /autonomous is redundant; a text link "→ Coordinator queue" is enough context.

2. **Add cross-links** — `/coordinator` header links to `/autonomous`; `/autonomous` scorecard links to `/coordinator`. Costs 2 lines each.

**Why not merge:**
 the pages have different primary use cases. /coordinator is a live task console (you look at it when the harness fires or stalls). /autonomous is a trend dashboard (you look at it to evaluate scoring health over time). Merged into one page, the long chart section buries the live queue that's the reason you opened /coordinator in the first place. A tabbed layout could work but adds client-side state to two server components — not worth it.

- Suggested action: PR to (a) remove Coordinator tile from /autonomous, replace with a `→ View queue` link, and (b) add `← Autonomous health` link in /coordinator header. ~10 lines total, no migration.

---
