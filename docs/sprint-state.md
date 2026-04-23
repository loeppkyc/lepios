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
active_chunk: "C"
status: "awaiting-phase2"
phase0_result: "cache_match_enabled: false — explicit override in sprint-state.md (cache_match_reason: 'Sprint 4 baseline') per Phase 0 rule 4; overrides audit-log date check; every acceptance doc escalates to Colin"
acceptance_doc_path: null
acceptance_doc_status: "not-started"
last_handoff_path: "docs/sprint-4/chunk-b-handoff.json"
awaiting: "coordinator"
kill_criterion_answer: null
opened_at: "2026-04-19T10:00:00-06:00"
last_updated_at: "2026-04-23T04:30:00-06:00"
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
chunks_complete: ["A", "B"]
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
