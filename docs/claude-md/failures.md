# LepiOS — Failure Log

**Auto-generated from `failures_log` table.** Last data change: 2026-05-09T13:50:05.755526+00:00.
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

## Fixed (last 30 days) (19)

## F-N5 — /api/bookkeeping/* shipped publicly accessible for ~5 hours (2026-05-05)

- **What:** Five new bookkeeping API routes (reconcile GET, reconcile/approve POST, reconcile/reject POST, qb-export GET, qb-export/mark POST) used createServiceClient for DB writes but never checked auth.getUser(). Root middleware excludes /api/* (API routes self-gate). Anyone hitting the URL could read needs_review queue, read all unexported JEs, write JEs via approve, mark JEs as exported. Live in production from c4c9e9c until a3425d9 (~5 hours).
- **Root cause:** New API routes were copied from existing patterns that used the SSR/anon client (RLS-gated by default). Switching to service_role for write capability removed the implicit RLS gate without adding an explicit auth gate. No checklist or lint rule caught it. The bookkeeping tests verified shape + business logic but not the security envelope.
- **Fix/workaround:** commit a3425d9 (inline auth.getUser check + 401 smoke tests)
- **Lesson:** Any new /api/* route that uses createServiceClient must (a) call auth.getUser() for user-facing routes OR (b) use requireCronSecret(request) for cron-style routes. Worth a lint rule (no-restricted-syntax) plus 401 test case in same commit.
- **Severity:** critical

---

## F-N29 — Vercel Hobby daily-only crons break heartbeat DMS and autonomous coordinator loop (2026-05-09)

- **What:** LAST_HEARTBEAT_AT was only updated when a Vercel cron fired (max once/day on Hobby plan). Dead-man switch threshold is 15 min, so health/lease returned stale constantly. task-pickup and notifications-drain-tick were also daily-only, breaking the continuous coordinator loop.
- **Expected:** Heartbeat updates every minute; task-pickup and drain fire every 5 minutes to keep the autonomous loop alive.
- **Actual:** All three high-frequency paths were gated behind Vercel Hobby daily-only crons. The harness appeared healthy in isolation but was functionally dead between daily ticks.
- **Root cause:** Vercel Hobby plan hard-limits all cron jobs to daily schedule regardless of configuration. Sub-15-min triggers require either Vercel Pro or a DB-side scheduler.
- **Fix/workaround:** d732a57
- **Lesson:** DB-side pg_cron is the correct mitigation for any sub-hourly scheduling need on Vercel Hobby. pg_net provides fire-and-forget HTTP calls from DB context. CRON_SECRET must be read from harness_config (not process.env) since pg functions run as postgres user, not Next.js.
- **Severity:** high

---

## F-N28 — Approval prompt fails to send via Telegram — coordinator marks task awaiting-colin-approval but inline buttons never reach user (2026-05-09)

- **What:** Coordinator completed Chunk D v2 (b362b865) — study, twin Q&A, 20% loop, and acceptance doc all done. It inserted an outbound_notifications row (7ecdddd8) with the approval inline keyboard, then tried to trigger the drain immediately via bash curl. The drain returned HTTP 403 because CRON_SECRET is not available in the coordinator sandbox bash environment. Coordinator logged drain_trigger_failed + coordinator_await_timeout and planned to "poll on next invocation." No next invocation was scheduled. Task sat at awaiting_grounding with notification at attempts=0/pending. Colin had to manually insert the delegate_to_builder row (a169f782) via Supabase MCP.
- **Expected:** After coordinator inserts an outbound_notifications approval row, the notification drains within the next cron cycle (max 60s) and Colin receives the Telegram message with inline approve/reject buttons.
- **Actual:** Notification sat pending for 22+ minutes. No Telegram message delivered. Coordinator exited without scheduling a re-poll. Task stuck. Colin had no visibility into the approval being ready without checking the DB directly.
- **Root cause:** Two-part root cause: (1) Coordinator attempts immediate drain via bash curl using CRON_SECRET from env — but CRON_SECRET is not exported into the coordinator sandbox bash environment, so every immediate drain attempt returns 403. The "poll on next invocation" fallback never fires because the coordinator session ended. (2) No cockpit indicator or Telegram fallback exists to surface pending approval requests when the primary notification channel silently fails. Variant of F-N17 (awaiting_grounding handler missing) and F-N22/23 (message construction failures) — but this instance is drain-403, not handler gap.
- **Fix/workaround:** F-N28-fix-A (PR #213) — removed all bash drain calls from coordinator.md; coordinator saves `pending_notification_id` to task metadata and transitions task to `awaiting_approval`, then exits immediately (no polling). New `/api/harness/coordinator-resume` route is called by the Telegram webhook on response_received — it writes `pending_notification_response` to metadata and transitions task back to `queued` (priority 1), triggering immediate pickup. Coordinator startup check reads `pending_notification_response` and resumes from Phase 4 Step 5.
- **Lesson:** Two fixes required: (1) coordinator should not attempt immediate drain via bash; it should rely on the cron cycle and log the notification_row_id it is waiting on, then on the NEXT invocation check if the row has been responded to before proceeding — this avoids the 403 path entirely. (2) cockpit /autonomous page should display any pending outbound_notifications rows that have requires_response=true and attempts=0 as a visible alert ("N approvals waiting") so Colin sees them without Telegram. Every unsent approval must have a DB-visible fallback.
- **Severity:** high

---

## F-N21 — setHalted writes to non-existent SELF_REPAIR_HALTED key — silent no-op via /api/self-repair/halt (2026-05-09)

- **What:** setHalted() called .update().eq(key, SELF_REPAIR_HALTED) but that key does not exist in harness_config. Superseded by HARNESS_HALTED in migration 0163. Supabase JS UPDATE matched 0 rows, returned no error, and the route returned ok:true.
- **Expected:** HARNESS_HALTED flips to true in harness_config; caller gets ok:true and the repair loop stops
- **Actual:** UPDATE matched 0 rows (wrong key name), no error raised, route returned ok:true — harness never actually halted. Every call to the killswitch endpoint was silently discarded.
- **Root cause:** setHalted() used the wrong config key. SELF_REPAIR_HALTED was the original night_watchman design key; HARNESS_HALTED is the key seeded by migration 0163 when the coordinator harness was wired up. The function was never updated to match.
- **Fix/workaround:** 51c61b5799aad3b6a4741bd12687096505683dab
- **Lesson:** Any single-key .update() that returns 0 rows should throw, not silently succeed. Add count:exact to .update() and guard count !== 1 with a hard error. Companion to F-N20: wrong key name is another form of silent no-op — both are invisible to callers without a row-count guard.
- **Severity:** high

---

## F-N20 — Silent grant gap on service_role writes — harness_config UPDATE always failed (2026-05-09)

- **What:** harness_config had RLS enabled but service_role was only granted SELECT. Every app-side write via createServiceClient() (halt, resume, HARNESS_CONTINUOUS_RUN_ID update) was silently denied with permission denied. The halt command surfaced it via Telegram DB error. No alert was ever raised — writes failed silently since the table was created in migration 0029.
- **Expected:** createServiceClient() writes to harness_config succeed. /halt sets HARNESS_HALTED=true. /resume clears it. startContinuousRun() saves run ID to HARNESS_CONTINUOUS_RUN_ID.
- **Actual:** All write operations on harness_config returned PostgreSQL error 42501 (permission denied) for the authenticator role. Postgres log showed the denial. Supabase advisors flagged rls_enabled_no_policy but no alert fired — gap only discovered when Colin attempted /halt and received a Telegram DB error message.
- **Root cause:** Migration 0029_harness_config.sql had the comment: "Service role bypasses RLS by default — no explicit policy needed." TRUE for RLS row-level policies; FALSE for PostgreSQL GRANT enforcement. service_role bypasses RLS but still requires GRANT INSERT/UPDATE/DELETE at the table level. No GRANT statements were included, so Supabase applied only a minimal SELECT grant.
- **Fix/workaround:** 8c80bcf
- **Lesson:** service_role bypasses RLS policies but NOT PostgreSQL GRANT enforcement. Every new table migration must include GRANT INSERT, UPDATE, DELETE ON table TO service_role (unless intentionally AD7 restricted). All service client write calls must check error.code 42501 and alert — silent write failures hide this class of bug for months.
- **Severity:** high

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

## F-N26 — Heartbeat scoped to single cron path — system appeared stale despite being alive (2026-05-09)

- **What:** LAST_HEARTBEAT_AT in harness_config was only written by runNightTick() (8 AM UTC cron). All 16 other cron routes and harness paths (daytime-tick, task-pickup, morning-digest, self-repair-tick, etc.) made no heartbeat write. The /api/health/lease dead-mans-switch read LAST_HEARTBEAT_AT and returned status=stale for all 23+ hours between night runs, even when the system was actively processing tasks.
- **Expected:** Cockpit heartbeat tile shows green (status=alive, age_seconds<900) whenever any cron or harness path has fired in the last 15 minutes.
- **Actual:** Cockpit showed stale all day. /api/health/lease returned status=stale even when task-pickup, morning-digest, and other crons were actively running. The only green window was within 15 min of the 8 AM night_tick.
- **Root cause:** Heartbeat write was inlined in runNightTick() as a single-site implementation rather than a shared utility. No other path imported or called any heartbeat write function. The DMS was only as alive as the one cron that happened to own the write.
- **Fix/workaround:** _Open_
- **Lesson:** Factor the heartbeat upsert into a shared utility (lib/orchestrator/heartbeat.ts). Call it from every recurring cron route (fire-and-forget, non-blocking) and from lib-level tick paths (throws-loud). Any new cron route must include import + void upsertHeartbeat().catch(() => {}) immediately after the auth check.
- **Severity:** medium

---

## F-N27 — ACTIVE/HALTED binary masked stall failures — STALLED indistinguishable from IDLE at glance level (2026-05-09)

- **What:** Coordinator queue tile displayed ACTIVE when HARNESS_HALTED=false, regardless of whether tasks were actually progressing. A stalled harness (queued>0, running=0, not halted) was visually indistinguishable from a healthy idle harness. /api/health/lease returned 200 alive for both.
- **Expected:** Cockpit and dead-man's-switch should distinguish IDLE (queue empty, healthy) from STALLED (tasks queued but no worker processing them). STALLED should surface as a warning tile and 503 on the lease endpoint.
- **Actual:** Binary ACTIVE/HALTED model only checked HARNESS_HALTED flag. A STALLED harness — tasks in queue, zero workers, kill switch off — showed as ACTIVE. External monitoring saw the system as healthy while work was stuck.
- **Root cause:** ACTIVE was defined as NOT halted, not as loop_working. HALTED is an explicit operator kill-switch; STALLED is an emergent condition needing detection: queued>0 AND running=0 AND not halted.
- **Fix/workaround:** _Open_
- **Lesson:** Any binary health indicator on a queue-based system needs at least 4 states: RUNNING (processing), IDLE (empty, healthy), STALLED (work blocked), HALTED (operator kill). The dead-man's-switch endpoint should reflect computed state, not just heartbeat age.
- **Severity:** medium

---

## F-N25 — Harness loop has no liveness signal — crashed night_tick invisible until manual check (2026-05-09)

- **What:** night_tick cron runs nightly but wrote no heartbeat timestamp anywhere. A failed cron invocation, Vercel function timeout, or DB write error left the harness silently dead with no surfacing path. Colin had no way to know the loop had stopped without checking Vercel logs or agent_events manually.
- **Expected:** Any loop failure surfaces within 15 minutes via /api/health/lease returning 503 and cockpit tile turning red
- **Actual:** No heartbeat mechanism existed. Loop death was invisible. No dead-man's-switch, no stale-detection endpoint, no cockpit indicator.
- **Root cause:** Harness was designed with checks and agent_events logging but no liveness timestamp. The dead-man's-switch pattern (write a timestamp each run, alert if stale) was never implemented alongside the loop itself.
- **Fix/workaround:** e80fe14
- **Lesson:** Every autonomous loop must write a liveness timestamp on each successful run. The timestamp must be readable by a public health endpoint and surfaced in the cockpit. Threshold: 15m stale = dead. The heartbeat write must throw on failure (F-N21 lesson: count:exact guard) — a silent heartbeat write failure defeats the entire DMS purpose.
- **Severity:** medium

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
