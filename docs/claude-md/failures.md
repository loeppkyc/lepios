# LepiOS — Failure Log

**Auto-generated from `failures_log` table.** Last data change: 2026-05-09T03:27:49.596511+00:00.
Source of truth: `failures_log` table. Edit there (cockpit `/failures` form or via `POST /api/failures/log`).

F-L1–F-L15 live in `CLAUDE.md §9` (canonical hand-written entries kept in prose).
F-N entries below are auto-rendered from the table.

---
## Open (3)

## F-N18 — Single-letter option replies (a/b/c) not handled — webhook_no_match for multi-option escalations (2026-05-09)

- **What:** Coordinator escalated scanner subdir-detection grounding fail with 3 options (a/b/c). Colin replied "a" via Telegram at 03:22 UTC. Webhook received the message (HTTP 200, logged telegram_webhook POST received) but logged webhook_no_match — no handler matched.
- **Expected:** Single-letter reply "a" to a multi-option awaiting_grounding escalation should set metadata.chosen_option and transition task_queue to queued, re-triggering coordinator.
- **Actual:** Text handler in PR #160 only matches "approve"/"approved" and "reject"/"rejected". Single-letter "a", "b", "c" fell through all handlers to webhook_no_match log.
- **Root cause:** PR #160 text handler checks: lc === "approve" || lc === "approved" || lc.startsWith("approve "). The letter "a" satisfies none of these. No fallback for multi-option single-letter responses. Gap is structural: every new escalation pattern (option selection, numeric replies, confirmation codes) needs its own handler branch.
- **Fix/workaround:** _Open_
- **Lesson:** Any new coordinator escalation pattern that expects a reply must enumerate the exact reply strings it accepts and add a webhook handler for each. Single-letter (a/b/c) option replies are a common coordinator pattern and must be handled generically: if task has awaiting_grounding status and metadata contains an options array, match reply against option keys and apply.
- **Severity:** high

---

## F-N17 — Telegram approval handlers missing for awaiting_grounding / acceptance_doc_ready tasks (2026-05-09)

- **What:** Coordinator escalated task 3dcf9706 (scanner_fix_subdir_detection) to awaiting_grounding. Colin sent inline button click ~02:12 UTC and text "Approved..." at 02:12:58 UTC. Both webhook POSTs returned 200 but task stayed at awaiting_grounding until manual DB UPDATE.
- **Expected:** Inline button or text "Approved" should transition task from awaiting_grounding to approved and delegate to builder.
- **Actual:** Both messages received (HTTP 200). Button click triggered answerCallbackQuery ack but fell through all 5 callback parsers. Text reply handler only queries status = awaiting_review — missed awaiting_grounding and acceptance_doc_ready.
- **Root cause:** (1) None of 5 callback parsers (thumbs, gate, improve, purpose_review, safety) handle task_queue approval transitions. (2) Text-reply handler only queries status = awaiting_review; missing awaiting_grounding and acceptance_doc_ready.
- **Fix/workaround:** _Open_
- **Lesson:** Every new escalation status added to task_queue must be paired with a webhook handler — both a callback_query parser (inline buttons) and a text-reply branch. Missing handlers return 200 silently, invisible without Vercel log inspection.
- **Severity:** high

---

## F-N13 — Puppeteer E2E verification of /failures page blocked by auth gate — no signed-in session available in build session (2026-05-08)

- **What:** Phase 1c spec required puppeteer verification against /failures: load page, sort by severity, submit manual entry form, click promote-to-test, verify outcomes. Page uses requireUser() auth gate which redirects to /login without a signed-in Supabase session. Build session has no cached cookies and no test-mode auth bypass. Vercel preview URL inherits the same auth requirement. Result: puppeteer would only verify the redirect, not the full UI flow.
- **Root cause:** Three structural gaps: (1) cockpit pages have no test-mode auth bypass, (2) puppeteer integration has no cached test-user session, (3) Vercel preview URLs require the same Supabase auth as prod (no preview-only bypass token). Each gap is reasonable on its own; in combination they make autonomous UI verification impossible from within a build session.
- **Fix/workaround:** (none — verification deferred to T-002 v2)
- **Lesson:** Exactly what T-002 v2 (Safety Agent E2E requirement) is designed to solve: Safety Agent runs puppeteer with a signed-in test user against the surface URL specified in done_state, with E2E pass required before merge. Until T-002 v2 ships, accept that build sessions cannot autonomously verify auth-gated UI; manual user testing is the only path. Track as: 'post-merge live verification by Colin' in PR test plan.
- **Severity:** medium

---

## Recurring (1)

## F-N10 — F-N8 RECURRENCE — concurrent Claude session contaminated working tree during T-006 Phase 1c build (2026-05-08)

- **What:** During Phase 1c build (T-006 cockpit page), a parallel Claude session checked out branch audit/safety-agent-mapping while I was actively working on harness/phase-1c-failures-cockpit. The branch switch dragged unfamiliar staged file docs/lepios/safety-agent-audit.md into my working tree. window-check-edits caught the out-of-scope edit; pre-commit gate would have blocked the commit. My in-flight Phase 1c work was preserved via lint-staged auto-stash and recovered after switching back to the correct branch.
- **Root cause:** Same as F-N8: parallel Claude sessions sharing the same git working tree. F-N8 lessons (pre-commit branch invariant, isolated worktrees) are still aspirational — branch guard runs on coordinator-initiated git ops only, not developer commits. Worktree isolation hasn't been adopted as default workflow yet.
- **Fix/workaround:** recovered via git stash pop + git checkout (manual)
- **Lesson:** F-N8 prescriptions still need shipping: (1) pre-commit branch invariant assertion, (2) pre-commit index invariant assertion, (3) parallel Claude sessions MUST use isolated git worktree checkouts (one worktree per session). The worktree fix is structural; the pre-commit invariants are the cheap defensive layer. Track: branch_drift_detected + unintended_staged_files in agent_events.
- **Severity:** high

---

## Fixed (last 30 days) (12)

## F-N5 — /api/bookkeeping/* shipped publicly accessible for ~5 hours (2026-05-05)

- **What:** Five new bookkeeping API routes (reconcile GET, reconcile/approve POST, reconcile/reject POST, qb-export GET, qb-export/mark POST) used createServiceClient for DB writes but never checked auth.getUser(). Root middleware excludes /api/* (API routes self-gate). Anyone hitting the URL could read needs_review queue, read all unexported JEs, write JEs via approve, mark JEs as exported. Live in production from c4c9e9c until a3425d9 (~5 hours).
- **Root cause:** New API routes were copied from existing patterns that used the SSR/anon client (RLS-gated by default). Switching to service_role for write capability removed the implicit RLS gate without adding an explicit auth gate. No checklist or lint rule caught it. The bookkeeping tests verified shape + business logic but not the security envelope.
- **Fix/workaround:** commit a3425d9 (inline auth.getUser check + 401 smoke tests)
- **Lesson:** Any new /api/* route that uses createServiceClient must (a) call auth.getUser() for user-facing routes OR (b) use requireCronSecret(request) for cron-style routes. Worth a lint rule (no-restricted-syntax) plus 401 test case in same commit.
- **Severity:** critical

---

## F-N14 — F-N1 RECURRENCE — Phase 1b markdown export writeFile() fails in Vercel serverless (read-only filesystem) (2026-05-08)

- **What:** Phase 1b shipped lib/failures/export-markdown.ts with writeFile(MD_PATH, content) where MD_PATH is docs/claude-md/failures.md inside the repo tree. Local dev exported successfully; prod fails with EROFS: read-only file system, open '/var/task/docs/claude-md/failures.md'. The night-tick integration correctly catches the error and logs to agent_events with status=error, but the markdown file never updates from the table in production. F19 loop is broken in prod: failures_log table updates → markdown does NOT auto-render → CLAUDE.md component #4 stays stale → next Claude session loads outdated context.
- **Root cause:** Same failure class as F-N1 (settings.json fix ignored in cloud sandbox): cloud-safe fixes must use DB-resident config or external API calls, not filesystem writes. writeFile to a repo path inside a Vercel serverless function ALWAYS fails because /var/task is read-only. F-N1 lesson was about config files; this generalizes to any filesystem write. The local-dev test passed because the script ran via tsx + dotenv against the actual filesystem.
- **Fix/workaround:** 3c8330c2c0e0b1dd7d6432cd3f4763b7e194e2cc
- **Lesson:** use GitHub API commits for any cron-driven content updates; never writeFile to repo paths in serverless (Vercel /var/task is read-only). Mirror the F22-bearer-auth pattern in lib/harness/self-repair/pr-opener.ts. Idempotency requires deterministic content (no Date.now() in render output). Live verified 2026-05-08: PR #148 merged → commit 3c8330c on prod → night-tick triggered → failures.md committed as c94133d on main → second invocation returned skipped:true (no duplicate commit). agent_events row failures_log.export_markdown shows status=success.
- **Severity:** high

---

## F-N9 — F-L11 recurrence: 19th cron in vercel.json silently broke deploy pipeline for ~50 minutes (2026-05-07)

- **What:** PR #109 (chore: self-repair v2 wire-up) added a 19th cron to vercel.json (/api/cron/night_watchman_scan at */30 4-13 * * * — both over the count ceiling AND sub-hourly). Vercel Hobby plan silently rejected the entire config at validation, before any build ran. PRs #109, #110, #111 all merged with Vercel: failure GitHub status checks. Production stayed pinned to last successful commit bb8b4a8 (PR #107) for ~50 min.
- **Root cause:** Same failure class as F-L11. CLAUDE.md §9 documents F-L11 with the lesson "Any cron addition must be validated against Vercel Hobby limits before merge" — but no automated check existed, so the discipline relied on human memory across windows. The Hobby cron count had crept up to exactly 18 without anyone noticing.
- **Fix/workaround:** PR #112 hotfix removed cron; pre-commit guard scripts/check-vercel-cron-count.mjs ships with MAX_CRONS=18
- **Lesson:** Same-session prevention: pre-commit script counts vercel.json crons + blocks sub-hourly schedules. Production-deploy verification still manual — after merging anything that touches vercel.json or adds API routes, list_deployments to confirm. Raise ceiling intentionally (Pro plan upgrade) — never bypass guard.
- **Severity:** high

---

## F-N7 — Bookkeeping reconcile/approve API uses status=approved which violates pending_transactions_status_check (2026-05-06)

- **What:** app/api/bookkeeping/reconcile/approve/route.ts writes status: 'approved' to pending_transactions after creating a journal entry. The CHECK constraint pending_transactions_status_check only allows pending, auto_approved, needs_review, rejected, manual_je, duplicate. The route would 500 with a constraint violation on every approve attempt; the journal entry would be created but the pending_transactions update would fail, leaving an orphan JE.
- **Root cause:** API code and DB constraint drifted independently. No test exercises the full approve flow against the real schema (the bookkeeping-reconcile-approve.test.ts tests use mocks).
- **Fix/workaround:** one-character API fix + manual SQL for in-flight items (status=manual_je)
- **Lesson:** Add a Vitest integration test that runs the approve handler against a temp Supabase project (or BEGIN/ROLLBACK wrapper). Mock-only tests verified shape but not the constraint envelope.
- **Severity:** high

---

## F-N8 — Concurrent-session contaminated working tree shipped Payouts UI without backend (2026-05-06)

- **What:** PR #86 (advisor backstop monitor) was opened from a branch I had just created (harness/advisor-backstop-monitor), but the squash-merge silently included unrelated Payouts UI changes — PayoutsPage.tsx with NotesCell references to s2.notes, plus a PATCH call to a route that did not exist yet. Live in production from bab3d5a until 7b842ba (~10 minutes). Migration 0132 (amazon_settlements.notes) had to be applied manually via Supabase MCP.
- **Root cause:** Concurrent Claude sessions sharing the same git working tree. Parallel autonomous session checked out its own branch, leaving the working tree on a different branch than the one I had created. lint-staged pre-commit git stash backup masked the drift. Subsequent git add captured the contaminated index.
- **Fix/workaround:** PR #87 superseded by PR #88 squash; manual migration apply
- **Lesson:** Pre-commit branch invariant (assert git branch --show-current matches expected). Pre-commit index invariant (staged files match git add list). Long-term: use isolated git worktree per parallel Claude session. Migration apply discipline: PR body checklist for migrations applied to prod.
- **Severity:** high

---

## F-N4 — 74 silent embed failures: cloudflared tunnel unreliable over batch (2026-04-27)

- **What:** Twin corpus ingest via Ollama returned 74 failures silently. Those chunks have no embeddings. cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Root cause:** cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Fix/workaround:** FTS fallback (S-L4 pattern)
- **Lesson:** Any batch job must log per-chunk success/failure to agent_events or a dedicated table. Silent failures in a batch = unknown coverage, not zero failures.
- **Severity:** high

---

## F-N15 — GitHub push protection blocks tests with literal Stripe/AWS/JWT token shapes (2026-05-08)

- **What:** First push of T-002 Sub-phase A was rejected by GitHub secret scanning. The test fixtures contained literal `sk_live_X...` and `sk_test_X...` strings designed only to satisfy the secret detector regex. GitHub's static scanner sees the shape, not the meaning, and blocks the push.
- **Expected:** Test asserts on regex-matching fixtures; push succeeds because the fixtures are obviously not real keys.
- **Actual:** Push declined due to repository rule violations: "Stripe API Key" and "Stripe Test API Secret Key" detected in tests/harness/safety/v2/secret-signal.test.ts:32, 37, 81.
- **Root cause:** GitHub push protection (different from secret scanning post-merge alerts) runs a static regex scan and blocks any push containing token-shaped strings, regardless of whether they're real. Test fixtures that match production detector regex are indistinguishable from leaked keys to the scanner.
- **Fix/workaround:** c156474
- **Lesson:** When writing tests that assert against secret-detection regex, build token fixtures at runtime via string concatenation (e.g. `['sk', 'live', 'X'.repeat(24)].join('_')`). Never put a literal token shape in source — even fake ones. Apply also to AWS / Supabase / JWT / GitHub PAT shapes.
- **Severity:** medium

---

## F-N1 — H1 Fix A (settings.json allowlist) ignored in cloud sandbox (2026-04-27)

- **What:** Added bash tool allow-permissions to project .claude/settings.json to fix H1 drain (drain trigger was blocked by sandbox). Drain still failed after the fix. The settings.json edit had no effect because Claude Code remote agents/cloud routines do not load project-level settings.json — only global user settings apply in that context.
- **Root cause:** Claude Code remote agents/cloud routines do not load project-level settings.json. Only global user settings apply in that context.
- **Fix/workaround:** task 2b05123b (H1-B Stage 2 pending_drain_triggers pattern)
- **Lesson:** Any settings.json fix targeting remote/cloud agent behavior is ineffective. Check execution environment (local dev vs. cloud routine) before applying. Cloud-safe fixes must use DB-resident config or harness API calls, not filesystem settings.
- **Severity:** medium

---

## F-N3 — Coordinator default branch name triggered branch guard on every session start (2026-04-27)

- **What:** Coordinator sessions auto-named branches claude/vibrant-heisenberg-* (Claude default) instead of harness/task-{uuid}. Branch guard check ran after git operations; if task_id absent from invocation context, no expected branch name could be constructed.
- **Root cause:** Branch guard check ran AFTER git operations; if task_id absent from invocation context, no expected branch name could be constructed.
- **Fix/workaround:** commit 5695edb (coordinator.md §Branch Naming requires task_id check before any git op)
- **Lesson:** Any coordinator invocation missing task_id must STOP immediately — log branch_guard_triggered, reason=missing_task_id and exit. Do not proceed with a generated branch name.
- **Severity:** medium

---

## F-N11 — Supabase query chain bug — .eq() after .limit() invalid (2026-05-08)

- **What:** lib/failures/list.ts initial implementation chained .order(...).limit(200) BEFORE applying .eq() filters. Supabase JS client returns a thenable from .limit() that is no longer extendable with .eq() — calling .eq() on it threw TypeError: query.eq is not a function. Caught by failing test before commit.
- **Root cause:** Misunderstanding of Supabase JS chain ordering. Filters (.eq, .in, .gte, etc.) must be added before terminal modifiers (.limit, .single, .maybeSingle, .order can come either side). Tests caught it because the mock builder returned a Promise from .limit() exactly like prod does.
- **Fix/workaround:** commit on harness/phase-1c-failures-cockpit (lib/failures/list.ts restructure)
- **Lesson:** Apply filters first, terminal modifiers last. Codify in a Supabase chain order helper or lint rule if this recurs.
- **Severity:** low

---

## F-N12 — zod v4 z.record() signature changed — single-arg version errors at parse time (2026-05-08)

- **What:** app/api/failures/promote/route.ts used z.record(z.unknown()) for the pattern_signature field. Schema build succeeded but parse errored: TypeError: Cannot read properties of undefined (reading _zod). Caught by failing test before commit.
- **Root cause:** zod v4 changed z.record to require BOTH key and value schemas: z.record(z.string(), z.unknown()). Single-arg form silently accepts but returns a broken schema.
- **Fix/workaround:** commit on harness/phase-1c-failures-cockpit (route.ts schema fix)
- **Lesson:** When upgrading zod across major versions, search for z.record( usages and add explicit key schema. Consider a codemod or lint rule. zod v4 release notes flag this.
- **Severity:** low

---

## F-N2 — BUMP directive parser missed squash-merge body (2026-04-27)

- **What:** "bumps harness:slug to N%" directive was present in PR body but component % did not update post-merge. Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Root cause:** Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Fix/workaround:** Manual SQL UPDATE harness_components; F-L13 queued to automate
- **Lesson:** Test directive parser against squash-merge commit body format. Verify parser reads from the correct field (PR description vs merge commit body) before relying on it in production.
- **Severity:** low
