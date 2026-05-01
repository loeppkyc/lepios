# ============================================================

# harness-e2e — throwaway plumbing test (parallel track)

# First-ever coordinator→builder→deploy gate loop exercise.

# NOT Sprint 4 work.

# ============================================================

harness_e2e:
sprint_id: "harness-e2e"
active_chunk: null
status: "closed"
kill_criterion: "npm test passes with tests/harness/version.test.ts included and green"
kill_criterion_answer: "yes — Colin ran grounding checkpoint 2026-04-22, returned pass"
throwaway: true
opened_at: "2026-04-22T13:55:00-06:00"
closed_at: "2026-04-22T15:30:00-06:00"
last_updated_at: "2026-04-22T15:30:00-06:00"
chunks_planned: ["v0-test"]
chunks_complete: ["v0-test"]
chunks_escalated: ["v0-test"]
close_doc_path: "docs/harness-e2e/close.md"
cache_match_enabled: false
cache_match_reason: "first run — no audit log reviewed (last_reviewed_by_colin_at: null)"
audit_reminder: "Next sprint will run cache-match-disabled until Colin updates last_reviewed_by_colin_at in docs/handoffs/auto-proceed-log.md"

# ============================================================

# Sprint 4 — Business Review Trust Layer (paused)

# ============================================================

# Sprint 4 intake ratified 2026-04-19, paused 2026-04-19 before

# any chunks executed. Autonomous harness work ongoing in parallel

# — see CLAUDE.md §1 and docs/feedback-loop-scoring.md.

active_sprint: 4
active_chunk: "D"
active_chunk_acceptance_doc: "docs/sprint-4/chunk-d-acceptance.md"
status: "awaiting-grounding"
chunk_d_build_complete_at: "2026-04-23T21:21:00Z"
chunk_d_tests: "793 passing, 0 failing, 12 new"
chunk_d_commits: ["7f8b1f8 (.env.example)", "dd4126e (implementation)", "d2b1176 (page wiring)"]
phase0_result: "cache_match_enabled: false — explicit override in sprint-state.md (cache_match_reason: 'Sprint 4 baseline') per Phase 0 rule 4; overrides audit-log date check; every acceptance doc escalates to Colin"
last_chunk_completed: "C"
last_chunk_grounding: "passed-with-limitation"
last_chunk_limitation: "SP-API Orders strips ItemPrice and OrderTotal from Pending orders >1 day old (B2B/net-30). Revenue gap vs SC for those orders is expected; resolves in Sprint 5 Finances integration."
chunk_d_approval: "colin-explicit — task_queue 9bf44f91-1fcf-4ca4-b050-ed2f5f0bce56 created with status=ready-for-builder and prerequisites_verified_at=2026-04-23T20:00:00Z"
kill_criterion_answer: null
opened_at: "2026-04-19T10:00:00-06:00"
last_updated_at: "2026-04-23T21:25:00-06:00"
resumed_at: "2026-04-23T15:00:00-06:00"
resume_reason: "Component #3 Remote Invocation shipped (commit bebac8e). Clean unattended run verified: task 90f952dc claimed autonomously, session session_01Y4Ca2VMWjFF9WYhrkqxFYV spawned without human step. Resume trigger met."
plan_written_at: "2026-04-19T12:00:00-06:00"

# Cache-match governance (set by coordinator Phase 0)

cache_match_enabled: false
cache_match_reason: "Sprint 4 baseline"

# Sprint metadata (set at intake, read-only after)

brief_path: "docs/sprint-4/brief.md"
plan_path: "docs/sprint-4/plan.md"
kill_criterion: "Every visible number on LepiOS Business Review matches its source system (Seller Central, Dropbox statement folder) to the penny, with zero approximations carried forward from the Streamlit prototype."

# Progress

chunks_planned: ["A", "B", "C", "D", "E"]
chunks_complete: ["A", "B", "C"]
chunks_escalated: []
chunks_rolled_back: []

# Resume trigger: harness components #5 (task pickup) and #2

# (Telegram thumbs) deployed and running clean for 3+ days.

# At that point the harness starts assisting LepiOS development

# — the whole personal OS system, being rebuilt on Next.js from

# the Loeppky Streamlit prototype shell and designed to grow

# from there. Sprint 4 Business Review Trust Layer is one slice

# of LepiOS, not the destination. Harness components #4 (deploy

# gate), #6 (attribution), and Step 6.5 (Ollama daytime tick)

# are deferred until a real LepiOS need surfaces them. Do not

# build more harness for its own sake. LepiOS shipping bigger

# and better is the success metric.

# ============================================================

# Sprint 5 — Harness Expansion (parallel track, concurrent with Sprint 4)

# ============================================================

sprint_5:
sprint_id: "sprint-5"
status: "in-build"
cache_match_enabled: false
cache_match_reason: "Sprint 4 baseline carries forward; every acceptance doc escalates to Colin"
opened_at: "2026-04-24T00:00:00Z"
last_updated_at: "2026-04-27T00:40:00Z"

chunks_planned:

- "attribution"
- "20-percent-better-engine"
- "gmail-scanner"
- "ollama-100"
- "streamlit-inventory"
- "task-pickup-100"
- "purpose-review"
- "purpose-review-correctness"
- "coordinator-env"
- "stall-alert"
- "notification-drain-dedup"

chunks_complete: []
chunks_awaiting_grounding:

- "attribution"
- "20-percent-better-engine"
- "gmail-scanner"
- "ollama-100"
- "streamlit-inventory"
- "purpose-review"
  chunks_awaiting_grounding_correctness:
- "purpose-review-correctness"
  chunks_awaiting_grounding_coordinator_env:
- "coordinator-env"
  chunks_not_started:
- "task-pickup-100"

utility_tracker_chunk:
  status: "awaiting-colin-approval"
  task_id: "8b3d7030-a873-431a-b82f-6dbd4ceda83d"
  study_doc: "docs/sprint-5/utility-tracker-streamlit-study.md"
  acceptance_doc: "docs/sprint-5/utility-tracker-acceptance.md"
  source_module: "pages/52_Utility_Tracker.py"
  started_at: "2026-04-27T04:17:00Z"
  acceptance_doc_ready_at: "2026-04-27T04:25:00Z"
  chunks_awaiting_grounding_stall_alert:
- "stall-alert"

active_chunk: "utility-tracker"
active_chunk_acceptance_doc: "docs/sprint-5/notification-drain-dedup-acceptance.md"
active_chunk_task_id: "c622d367-704d-4838-83bf-15a196c8c074"
active_chunk_status: "awaiting-grounding"
active_chunk_colin_approved_at: "2026-04-26T00:08:12Z"
active_chunk_delegated_to_builder_at: "2026-04-26T01:16:00Z"
active_chunk_build_complete_at: "2026-04-26T01:21:00Z"
active_chunk_commit: "ea4f826"
active_chunk_tests: "600 passing, 8 pre-existing failing (next/server env issue)"
last_updated_at: "2026-04-26T01:22:00Z"

prior_active_chunk: "notification-drain-dedup"
prior_active_chunk_acceptance_doc: "docs/sprint-5/notification-drain-dedup-acceptance.md"
prior_active_chunk_task_id: "c622d367-704d-4838-83bf-15a196c8c074"
prior_active_chunk_status: "awaiting-grounding"
prior_active_chunk_colin_approved_at: "2026-04-26T00:08:12Z"
prior_active_chunk_delegated_to_builder_at: "2026-04-26T01:16:00Z"
prior_active_chunk_build_complete_at: "2026-04-26T01:21:00Z"
prior_active_chunk_commit: "ea4f826"
prior_active_chunk_tests: "600 passing, 8 pre-existing failing (next/server env issue)"

h3_prior_active_chunk: "stall-alert"
h3_prior_active_chunk_acceptance_doc: "docs/sprint-5/stall-alert-acceptance.md"
h3_prior_active_chunk_task_id: "40b1aa4b-c969-4d94-93f7-49ce29f3fc26"
prior_active_chunk_status: "awaiting-grounding"
prior_active_chunk_colin_approved_at: "2026-04-25T23:21:57Z"
prior_active_chunk_delegated_to_builder_at: "2026-04-26T00:40:00Z"
prior_active_chunk_build_complete_at: "2026-04-26T00:50:00Z"
prior_active_chunk_commit: "59e43fe0"
prior_active_chunk_tests: "946 passing, 1 pre-existing failing (task-pickup cron schedule)"

stall_alert_chunk:
status: "awaiting-grounding"
acceptance_doc: "docs/sprint-5/stall-alert-acceptance.md"
colin_approved_at: "2026-04-25T23:21:57Z"
coordinator_task_id: "40b1aa4b-c969-4d94-93f7-49ce29f3fc26"
delegated_to_builder_at: "2026-04-26T00:40:00Z"
build_complete_at: "2026-04-26T00:50:00Z"
commit: "59e43fe0"
tests: "946 passing, 1 pre-existing failing (task-pickup cron schedule)"
file_path_note: "builder used lib/orchestrator/digest.ts (not app/api/cron/morning-digest/route.ts) — route delegates to lib, verify at grounding"
grounding_checkpoints:

- "UPDATE task_queue SET last_heartbeat_at = now() - interval '35 minutes' WHERE status = 'running' LIMIT 1"
- "curl -s GET https://lepios-one.vercel.app/api/cron/task-pickup -H 'Authorization: Bearer {CRON_SECRET}'"
- "SELECT id, status, payload->>'text' FROM outbound_notifications ORDER BY created_at DESC LIMIT 3 — expect T1 alert row"
- "SELECT meta FROM agent_events WHERE action='stall_alert_sent' ORDER BY occurred_at DESC LIMIT 1 — expect trigger+correlation_id"
- "Trigger pickup again immediately — confirm no second notification row for same task_id (dedup)"

coordinator_env_chunk:
status: "awaiting-grounding"
acceptance_doc: "docs/sprint-5/coordinator-env-acceptance.md"
study_doc: "docs/sprint-5/coordinator-env-study.md"
colin_approved_at: "2026-04-25T23:05:19Z"
task_id: "87bc8578-6eb8-4f84-b522-00c4804a2398"
delegated_to_builder_at: "2026-04-25T23:25:00Z"
build_complete_at: "2026-04-25T23:35:34Z"
commit: "b7ecf50"
tests: "935 passing, 1 pre-existing failing (task-pickup cron schedule)"
grounding_checkpoints: - "Apply migration 0029_harness_config.sql to production Supabase" - "UPDATE harness_config SET value = '<actual-cron-secret>' WHERE key = 'CRON_SECRET'" - "UPDATE harness_config SET value = '<actual-chat-id>' WHERE key = 'TELEGRAM_CHAT_ID'" - "Verify: agent_events heartbeat row with status='success' on next coordinator run" - "Verify: outbound_notifications chat_id non-null on coordinator-generated rows"

notification_drain_dedup_chunk:
status: "awaiting-grounding"
acceptance_doc: "docs/sprint-5/notification-drain-dedup-acceptance.md"
study_doc: "docs/sprint-5/notification-drain-dedup-study.md"
colin_approved_at: "2026-04-26T00:08:12Z"
coordinator_task_id: "c622d367-704d-4838-83bf-15a196c8c074"
delegated_to_builder_at: "2026-04-26T01:16:00Z"
build_complete_at: "2026-04-26T01:21:00Z"
commit: "ea4f826"
tests: "600 passing, 8 pre-existing failing (next/server env, not caused by this chunk)"
grounding_checkpoints:
  - "INSERT duplicate correlation_id into outbound_notifications — confirm unique-violation error (23505)"
  - "Confirm /api/harness/notifications-drain cron appears in Vercel Cron Jobs tab after deploy to main"
  - "SELECT meta FROM agent_events WHERE action='notification_delivered' ORDER BY occurred_at DESC LIMIT 3 — expect delivery_latency_ms > 0"

# Grounding checkpoints still pending for completed-build chunks

# (all require Colin to apply migrations and verify live behaviour):

# - attribution: migration 0020 + live entity_attribution rows

# - 20-percent-better-engine: task_queue constraint migration + live improvement proposals

# - gmail-scanner: env vars (GOOGLE\_\*) + migration 0022 + manual cron trigger

# - ollama-100: timeout/circuit-breaker verification + morning digest Ollama line

# - streamlit-inventory: migration 0023 + populate/embed scripts + smoke query pass rate

# - purpose-review: migration 0026 (NOT yet applied to prod) + live Telegram callback test

# ============================================================

# Hardening tasks (post-first-autonomous-loop postmortem 2026-04-27)

# ============================================================

hardening_h1:
  hardening_id: "H1"
  task_id: "8a9dcb62-bcca-4e1f-8381-f502a165d3ae"
  source_label: "postmortem_915d1fee"
  status: "awaiting_grounding"
  description: "Fix coordinator drain 403 — notification delivery broken"
  study_doc: "docs/sprint-5/drain-403-study.md"
  acceptance_doc: "docs/sprint-5/drain-403-acceptance.md"
  root_causes:
    - "host_not_in_allowlist: lepios-one.vercel.app blocked in coordinator bash"
    - "cron_secret_unset: CRON_SECRET not in bash env (no .env.local)"
    - "parse_mode_bug: Markdown parse_mode fails on arbitrary text"
  notification_row_id: "5708c92d-1210-45f5-b64e-8c0852620139"
  awaiting_colin_approval_for: "acceptance doc — 3 open questions, see acceptance doc"
  branch: "harness/task-8a9dcb62-bcca-4e1f-8381-f502a165d3ae"
  commit: "b617167"
  opened_at: "2026-04-27T00:26:00Z"
  last_updated_at: "2026-04-27T00:40:00Z"

hardening_h3:
  hardening_id: "H3"
  task_id: "9b95359e-828d-46d9-8514-1a1ff16f4c31"
  source_label: "postmortem_915d1fee"
  status: "awaiting_grounding"
  description: "Pickup ordering — FIFO guarantee + coordinator-busy unclaim"
  study_doc: "docs/sprint-5/h3-pickup-ordering-study.md"
  acceptance_doc: "docs/sprint-5/h3-pickup-ordering-acceptance.md"
  audit_finding: "FIFO ordering is correct — root cause is 429 serialization + daily cron. Part A=immediate unclaim on 429. Part B=hourly cron (Colin approved)."
  root_causes:
    - "429_limbo: fireCoordinator 429 leaves task in claimed state for 15-min stale window, burning retry_count"
    - "daily_cron: task-pickup runs once day (0 0 * * *), max 24h claim latency"
  part_a_status: "shipped — pickup-runner.ts immediately unclears task on 429, no retry_count burn, Telegram alert fires"
  part_b_status: "shipped — vercel.json cron changed to 0 * * * * (hourly, Colin approved Hobby slot usage)"
  branch: "harness/task-9b95359e-828d-46d9-8514-1a1ff16f4c31"
  pr: "33"
  opened_at: "2026-04-27T00:00:00Z"
  last_updated_at: "2026-04-27T00:14:00Z"

# ============================================================
# Dropbox Archiver — Streamlit port (sprint-5 parallel track)
# task_id: 8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47
# ============================================================

dropbox_archiver_chunk:
  status: "awaiting-colin-approval"
  task_id: "8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47"
  source_module: "pages/97_Dropbox_Archiver.py"
  study_doc: "docs/sprint-5/dropbox-archiver-streamlit-study.md"
  acceptance_doc: "docs/sprint-5/dropbox-archiver-acceptance.md"
  branch: "harness/task-8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47"
  scope: "Hybrid A+D — Dropbox stats tile (used GB, quota, pct, root count, oldest folder) + copy-to-clipboard command reference for Stage 2/3"
  pending_colin_questions:
    - "Q1: Drive letter default for Stage 3 transfer command? (coordinator assumed D per Streamlit hardcode)"
    - "Q2: Other protected Dropbox folders besides /Hubdoc/Uploads?"
    - "Q3: (optional) Frequency of use — informs whether to add last-run tracker"
    - "Q4: Preferred default cutoff: 90 days? (coordinator used Streamlit default)"
  twin_status: "unreachable from build env — all questions to Colin"
  opened_at: "2026-05-01T00:00:00Z"
  last_updated_at: "2026-05-01T00:00:00Z"
