# GPU Day Readiness Tracker

**Update protocol:** Update on every window close that touches a line item. Recompute total. Bump "Last updated."

**Enforcement (F22):** When a PR merges that touches a tracked line item, the merging window MUST update this tracker before reporting completion. Coordinator must grep PR titles/bodies for line item keywords (drain, tunnel, BUMP, F18 surfacing, branch-naming, SQL audit, Ollama ship, grounding doc, env vars) and refuse to mark a task complete if the tracker hasn't been bumped.

---

## Total Readiness: 67.0 / 100

---

## A — Ollama Pipeline (25 pts)

_The GPU Day enabler. Without this category, the upgrade has nothing to run on._

| #   | Line item                                                             | Weight | Pct  | Contribution | Notes                                                                |
| --- | --------------------------------------------------------------------- | ------ | ---- | ------------ | -------------------------------------------------------------------- |
| A1  | Ollama installed + 7B model running                                   | 2      | 100% | 2.00         | `qwen2.5-coder:7b` confirmed at 8.14 tok/s                           |
| A2  | Cline installed + wired (VS Code)                                     | 5      | 100% | 5.00         | `.clinerules` present; first task attempted                          |
| A3  | Smoke test passed + tok/s recorded                                    | 3      | 100% | 3.00         | F18 table: 66.5s / 379 tok / 8.14 tok/s (2026-04-27)                 |
| A4  | First real ship via Ollama                                            | 5      | 25%  | 1.25         | `tests/api/status.test.ts` generated but untracked/not committed yet |
| A5  | Triage rubric written + F18 metrics active                            | 4      | 100% | 4.00         | `docs/ollama-triage.md` complete with decision tree + route list     |
| A6  | `gpu-day-checklist.md` written                                        | 3      | 100% | 3.00         | `docs/gpu-day-checklist.md` — full 6-step upgrade path               |
| A7  | GPU swap path documented (model upgrade, config delta, speed targets) | 3      | 100% | 3.00         | 7B→14B config diff table, CUDA verification steps, tok/s targets     |
|     | **Category total**                                                    | **25** |      | **21.25**    |                                                                      |

---

## B — Harness Reliability (30 pts)

_Without reliable drain + tunnel, autonomous ships are deaf-and-dumb post-GPU._

| #   | Line item                                                             | Weight | Pct  | Contribution | Notes                                                                                                                                   |
| --- | --------------------------------------------------------------------- | ------ | ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Drain pipeline reliable (task `2b05123b` shipped)                     | 8      | 100% | 8.00         | PR #35 shipped — Stage 2 `pending_drain_triggers` pattern complete                                                                      |
| B2  | F18 surfacing gap closed (task `434ac58a`)                            | 5      | 100% | 5.00         | PR #35 shipped                                                                                                                          |
| B3  | BUMP parser fix (task `90a47e2e`)                                     | 5      | 100% | 5.00         | PR #35 shipped                                                                                                                          |
| B4  | Tunnel reliability — cloudflared as Windows service (task `d82411e1`) | 8      | 0%   | 0.00         | `OLLAMA_TUNNEL_URL` not set in Vercel; Ollama healthy locally but never reachable from production; cloudflared not installed as service |
| B5  | Coordinator branch-naming bug fixed                                   | 2      | 85%  | 1.70         | F-N3 documented; `coordinator.md` updated (staged in git) with pre-git task_id guard; `branch_guard_triggered` events logging           |
| B6  | Direct SQL audit gap resolved (task `305a9528`)                       | 2      | 0%   | 0.00         | Not started                                                                                                                             |
|     | **Category total**                                                    | **30** |      | **19.70**    |                                                                                                                                         |

---

## C — Doctrine + Docs (15 pts)

| #   | Line item                                  | Weight | Pct  | Contribution | Notes                                                                                                                                     |
| --- | ------------------------------------------ | ------ | ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | CLAUDE.md §8 capabilities hardened         | 2      | 100% | 2.00         | §8 comprehensive — agents, endpoints, MCP tools, skills, runtime config                                                                   |
| C2  | `failures.md` + `successes.md` backfilled  | 2      | 100% | 2.00         | F-N1–F-N4 and S-N1–S-N3 in `docs/claude-md/`                                                                                              |
| C3  | Safety Agent doctrine resolved (W1 Task 1) | 4      | 0%   | 0.00         | CLAUDE.md §8 says "Target: Sprint 5+" — no doc, no decision, not queued                                                                   |
| C4  | Chart strategy decided (W4)                | 3      | 100% | 3.00         | `docs/decisions/chart-library-strategy.md` — shadcn/ui Chart (Recharts). AmazonDailyChart + UtilityBarChart migrated. PR open 2026-04-27. |
| C5  | Status page spec'd or shipped (W1 Task 2)  | 4      | 0%   | 0.00         | Referenced as "W1 Task 2" but no spec, no queue entry, no build                                                                           |
|     | **Category total**                         | **15** |      | **7.00**     |                                                                                                                                           |

---

## D — Staged Batch Readiness (20 pts)

_4 of 6 already won._

| #   | Line item                                   | Weight | Pct  | Contribution | Notes                                                                                                              |
| --- | ------------------------------------------- | ------ | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| D1  | Keepa Intel grounding doc                   | 4      | 100% | 4.00         | `docs/sprint-5/grounding/keepa-intel.md` confirmed                                                                 |
| D2  | Goals grounding doc                         | 4      | 100% | 4.00         | `docs/sprint-5/grounding/goals.md` confirmed                                                                       |
| D3  | Oura Health grounding doc                   | 4      | 100% | 4.00         | `docs/sprint-5/grounding/oura-health.md` confirmed                                                                 |
| D4  | Scanner Phone grounding doc                 | 4      | 100% | 4.00         | `docs/sprint-5/grounding/scanner-phone.md` confirmed                                                               |
| D5  | Inventory grounding doc                     | 2      | 0%   | 0.00         | Next batch — explicitly not started                                                                                |
| D6  | Local_AI / Retail_Monitor decision resolved | 2      | 50%  | 1.00         | Both held with documented reasoning in `docs/sprint-5/next-autonomous-batch-2026-04-28.md`; decisions not yet made |
|     | **Category total**                          | **20** |      | **17.00**    |                                                                                                                    |

---

## E — Environment + Secrets (10 pts)

| #   | Line item                                          | Weight | Pct | Contribution | Notes                                                                                                    |
| --- | -------------------------------------------------- | ------ | --- | ------------ | -------------------------------------------------------------------------------------------------------- |
| E1  | `KEEPA_API_KEY` verified in Vercel                 | 4      | 50% | 2.00         | Sprint 3 PageProfit shipped (implies key was live), but no recent verification; give it benefit of doubt |
| E2  | `OURA_ACCESS_TOKEN` in `harness_config`            | 3      | 0%  | 0.00         | Oura study doc explicitly flags this as a prereq not yet done                                            |
| E3  | Staged-batch env vars audited (Dropbox, n8n, etc.) | 3      | 0%  | 0.00         | No audit doc found; design decisions pending for Dropbox + Profile modules                               |
|     | **Category total**                                 | **10** |     | **2.00**     |                                                                                                          |

---

## Summary

| Category                | Weight  | Earned    | %         |
| ----------------------- | ------- | --------- | --------- |
| A — Ollama Pipeline     | 25      | 21.25     | 85%       |
| B — Harness Reliability | 30      | 19.70     | 66%       |
| C — Doctrine + Docs     | 15      | 7.00      | 47%       |
| D — Staged Batch        | 20      | 17.00     | 85%       |
| E — Env + Secrets       | 10      | 2.00      | 20%       |
| **Total**               | **100** | **66.95** | **67.0%** |

---

## Top 3 Highest-Leverage Items

| Rank    | Item                                                         | Weight | Gap  | Leverage |
| ------- | ------------------------------------------------------------ | ------ | ---- | -------- |
| 1       | B4 — Cloudflared tunnel as Windows service (task `d82411e1`) | 8      | 100% | 8.0      |
| 2 (tie) | C3 — Safety Agent doctrine resolved                          | 4      | 100% | 4.0      |
| 2 (tie) | C5 — Status page spec'd or shipped                           | 4      | 100% | 4.0      |
| 4       | A4 — First real ship via Ollama                              | 5      | 75%  | 3.75     |

B4 alone adds **8 points** — moves readiness from 64.0% to 72.0%. C3 + C5 together add another 8.

---

## Gaps Found in Audit (Not Yet Queued)

These items appear in readiness criteria but have no corresponding task in `task_queue`:

| Gap                                     | Category | Action needed                                                                        |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Safety Agent doctrine                   | C3       | Queue a decision task — "resolved" or "deferred indefinitely with written rationale" |
| ~~Chart strategy decision~~             | ~~C4~~   | ~~Closed 2026-04-27~~                                                                |
| Status page (W1 Task 2)                 | C5       | Spec or queue as a named task — currently has no existence in any queue              |
| `OURA_ACCESS_TOKEN` in `harness_config` | E2       | Add to `harness_config` before Oura module is handed to coordinator                  |
| Staged-batch env vars audit             | E3       | Run `/env-audit` before next batch fires                                             |
| Inventory grounding doc                 | D5       | Queue as coordinator pre-work for Inventory module (Rank 2)                          |

---

## Last Updated

2026-04-27 (W4) — C4 chart strategy → 100%. shadcn/ui Chart (Recharts) adopted. `docs/decisions/chart-library-strategy.md` written. AmazonDailyChart + UtilityBarChart migrated. Total: 64.0% → 67.0%.  
2026-04-27 11:31 MDT / 17:31 UTC — updated after PR #35 merge (B1/B2/B3 → 100%)  
Previously: 2026-04-27 ~10:00 MDT (initial write same session)

**Next highest-leverage item:** B4 — cloudflared tunnel as Windows service. Blocks all Ollama production traffic. Runs ngrok in 5 min to unblock immediately; named Cloudflare tunnel takes 30–60 min but survives reboots. See `docs/ollama-tunnel-diagnosis-2026-04-27.md §7` for exact steps.
