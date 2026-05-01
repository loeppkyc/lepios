# LepiOS — Failure Log (F-N series)

F-L1–F-L15 live in `CLAUDE.md §9` (canonical). This file holds entries added after F-L15.
Newest-first. Format: date · what happened · root cause · fix/workaround · what to do differently.

---

## F-N4 — 74 silent embed failures: cloudflared tunnel unreliable over batch (2026-04-27)

- **What:** Twin corpus ingest via Ollama returned 74 failures silently. Those chunks have no embeddings.
- **Root cause:** cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Fix/workaround:** FTS fallback covers gap for now. Proper fix: retry-with-backoff in ingest, or run ingest locally (no tunnel needed).
- **Next time:** Any batch job must log per-chunk success/failure to `agent_events` or a dedicated table. Silent failures in a batch = unknown coverage, not zero failures.

---

## F-N3 — Coordinator default branch name triggered branch guard on every session start (2026-04-27)

- **What:** Coordinator sessions auto-named branches `claude/vibrant-heisenberg-*` (Claude's default) instead of `harness/task-{uuid}`.
- **Root cause:** Branch guard check ran _after_ git operations; if `task_id` absent from invocation context, no expected branch name could be constructed.
- **Fix/workaround:** `coordinator.md` §Branch Naming now requires `task_id` presence check _before_ any git op. Checkouts to `harness/task-{task_id}` are explicit.
- **Next time:** Any coordinator invocation missing `task_id` must STOP immediately — log `branch_guard_triggered, reason=missing_task_id` and exit. Do not proceed with a generated branch name.

---

## F-N2 — BUMP directive parser missed squash-merge body (2026-04-27)

- **What:** `bumps harness:slug to N%` directive was present in PR body but component % did not update post-merge.
- **Root cause:** Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Fix/workaround:** Manual SQL `UPDATE harness_components SET weight_pct=N WHERE slug='...'`. Task F-L13 queued to automate this.
- **Next time:** Test directive parser against squash-merge commit body format. Verify parser reads from the correct field (PR description vs. merge commit body) before relying on it in production.

---

## F-N1 — H1 Fix A (settings.json allowlist) ignored in cloud sandbox (2026-04-27)

- **What:** Added bash tool allow-permissions to project `.claude/settings.json` to fix H1 drain (drain trigger was blocked by sandbox). Drain still failed after the fix.
- **Root cause:** Claude Code remote agents/cloud routines do not load project-level `settings.json`. Only global user settings apply in that context.
- **Fix/workaround:** H1-B Stage 2 — replace curl-based drain trigger with Supabase-native `pending_drain_triggers` table pattern (task `2b05123b`, now queued at priority=1).
- **Next time:** Any settings.json fix targeting remote/cloud agent behavior is ineffective. Check execution environment (local dev vs. cloud routine) before applying. Cloud-safe fixes must use DB-resident config or harness API calls, not filesystem settings.
