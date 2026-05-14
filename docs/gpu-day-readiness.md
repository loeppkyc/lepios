# GPU Day Readiness Tracker

**Update protocol:** Update on every window close that touches a line item. Recompute total. Bump "Last updated."

**Enforcement (F22):** When a PR merges that touches a tracked line item, the merging window MUST update this tracker before reporting completion. Coordinator must grep PR titles/bodies for line item keywords (drain, tunnel, BUMP, F18 surfacing, branch-naming, SQL audit, Ollama ship, grounding doc, env vars) and refuse to mark a task complete if the tracker hasn't been bumped.

---

## Total Readiness: 94.7 / 100

---

## A — Ollama Pipeline (25 pts)

_The GPU Day enabler. Without this category, the upgrade has nothing to run on._

| #   | Line item                                                             | Weight | Pct  | Contribution | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------- | ------ | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Ollama installed + 7B model running                                   | 2      | 100% | 2.00         | `qwen2.5-coder:7b` confirmed at 8.14 tok/s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A2  | Cline installed + wired (VS Code)                                     | 5      | 80%  | 4.00         | Cline installed, Ollama wired. **`.clinerules` + `memory-bank/` created 2026-05-14** (were phantom entries — files now exist at repo root). First real task pending.                                                                                                                                                                                                                                                                                                                                                                        |
| A3  | Smoke test passed + tok/s recorded                                    | 3      | 100% | 3.00         | F18 table: 66.5s / 379 tok / 8.14 tok/s (2026-04-27)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A4  | First real ship via Ollama                                            | 5      | 70%  | 3.50         | local-AI dashboard shipped MID batch 2 (page.tsx 59 LOC + LocalAIShell 150+ LOC, live); /api/twin/ask + safety-arbitrate live with 410 LOC tests + 7 callers; lib/ollama/client.ts (518 LOC) + circuit breaker (126 LOC) in prod; safety LLM review in deploy gate. **Held at 70%:** active HTTP 530s on ollama.embed in every overnight cron (2026-05-09/10 06:xx UTC); ollama.generate failed at 19:01 immediately after health success at 18:59. FTS fallback working as designed — degraded-mode functional but inference not reliable. |
| A5  | Triage rubric written + F18 metrics active                            | 4      | 100% | 4.00         | **Written 2026-05-14.** `docs/ollama-triage.md` — decision tree, tier table, known good/bad tasks, escalation thresholds, F18 metrics table, AI dispatcher integration notes.                                                                                                                                                                                                                                                                                                                                                               |
| A6  | `gpu-day-checklist.md` written                                        | 3      | 100% | 3.00         | **Written 2026-05-14.** `docs/gpu-day-checklist.md` — 7-phase day-of checklist: hardware verify, model pull, baseline speed, config update, smoke test, triage rubric update, tracker update. Go/no-go criteria + rollback.                                                                                                                                                                                                                                                                                                                 |
| A7  | GPU swap path documented (model upgrade, config delta, speed targets) | 3      | 100% | 3.00         | 7B→14B config diff table, CUDA verification steps, tok/s targets                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|     | **Category total**                                                    | **25** |      | **22.50**    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## B — Harness Reliability (30 pts)

_Without reliable drain + tunnel, autonomous ships are deaf-and-dumb post-GPU._

| #   | Line item                                                             | Weight | Pct  | Contribution | Notes                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ------ | ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Drain pipeline reliable (task `2b05123b` shipped)                     | 8      | 100% | 8.00         | PR #35 shipped — Stage 2 `pending_drain_triggers` pattern complete                                                                                                                                                                                        |
| B2  | F18 surfacing gap closed (task `434ac58a`)                            | 5      | 100% | 5.00         | PR #35 shipped                                                                                                                                                                                                                                            |
| B3  | BUMP parser fix (task `90a47e2e`)                                     | 5      | 100% | 5.00         | PR #35 shipped                                                                                                                                                                                                                                            |
| B4  | Tunnel reliability — cloudflared as Windows service (task `d82411e1`) | 8      | 100% | 8.00         | **Shipped 2026-05-04.** cloudflared v2025.8.1 installed as AUTO_START Windows service. `OLLAMA_TUNNEL_URL=https://ollama.loeppky.xyz` already set in Vercel. Acceptance test: 10/10 embed requests @ 194ms avg, 0 failures. F18 logged. Survives reboots. |
| B5  | Coordinator branch-naming bug fixed                                   | 2      | 85%  | 1.70         | F-N3 documented; `coordinator.md` updated (staged in git) with pre-git task_id guard; `branch_guard_triggered` events logging                                                                                                                             |
| B6  | Direct SQL audit gap resolved (task `305a9528`)                       | 2      | 100% | 2.00         | **Resolved 2026-05-05.** Decision: accept as designed. `docs/decisions/sql-direct-write-backdoor.md`. Task `305a9528` marked completed in `task_queue`. SQL is a privileged Colin-only backdoor; F18 surfacing covers agent operations only.              |
|     | **Category total**                                                    | **30** |      | **29.70**    |                                                                                                                                                                                                                                                           |

---

## C — Doctrine + Docs (15 pts)

| #   | Line item                                  | Weight | Pct  | Contribution | Notes                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | ------ | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | CLAUDE.md §8 capabilities hardened         | 2      | 100% | 2.00         | §8 comprehensive — agents, endpoints, MCP tools, skills, runtime config                                                                                                                                                                                |
| C2  | `failures.md` + `successes.md` backfilled  | 2      | 100% | 2.00         | F-N1–F-N4 and S-N1–S-N3 in `docs/claude-md/`                                                                                                                                                                                                           |
| C3  | Safety Agent doctrine resolved (W1 Task 1) | 4      | 100% | 4.00         | **Resolved 2026-05-05.** Decision: build it. `docs/specs/safety-agent.md` shipped (3-phase build: static checks → LLM review → Telegram approval). Phase 1 queued as task `9b9bca02` in `task_queue`. CLAUDE.md §8 will be updated when Phase 1 ships. |
| C4  | Chart strategy decided (W4)                | 3      | 100% | 3.00         | `docs/decisions/chart-library-strategy.md` — shadcn/ui Chart (Recharts). AmazonDailyChart + UtilityBarChart migrated. PR open 2026-04-27.                                                                                                              |
| C5  | Status page spec'd or shipped (W1 Task 2)  | 4      | 100% | 4.00         | **Resolved 2026-05-05.** Decision: deferred indefinitely. `docs/decisions/status-page-deferred.md` — `morning_digest` already covers the surface; a webpage would duplicate at maintenance cost. Revisit triggers documented.                          |
|     | **Category total**                         | **15** |      | **15.00**    |                                                                                                                                                                                                                                                        |

---

## D — Staged Batch Readiness (20 pts)

_4 of 6 already won._

| #   | Line item                                   | Weight | Pct  | Contribution | Notes                                                                                                                                                                                                     |
| --- | ------------------------------------------- | ------ | ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Keepa Intel grounding doc                   | 4      | 100% | 4.00         | `docs/sprint-5/grounding/keepa-intel.md` confirmed                                                                                                                                                        |
| D2  | Goals grounding doc                         | 4      | 100% | 4.00         | `docs/sprint-5/grounding/goals.md` confirmed                                                                                                                                                              |
| D3  | Oura Health grounding doc                   | 4      | 100% | 4.00         | `docs/sprint-5/grounding/oura-health.md` confirmed                                                                                                                                                        |
| D4  | Scanner Phone grounding doc                 | 4      | 100% | 4.00         | `docs/sprint-5/grounding/scanner-phone.md` confirmed                                                                                                                                                      |
| D5  | Inventory grounding doc                     | 2      | 0%   | 0.00         | Next batch — explicitly not started                                                                                                                                                                       |
| D6  | Local_AI / Retail_Monitor decision resolved | 2      | 75%  | 1.50         | **Local_AI resolved:** local-AI ops dashboard shipped MID batch 2 (app/(cockpit)/local-ai/ + /api/local-ai/status live). Decision made = building it. **Retail_Monitor still pending** — no decision yet. |
|     | **Category total**                          | **20** |      | **17.50**    |                                                                                                                                                                                                           |

---

## E — Environment + Secrets (10 pts)

| #   | Line item                                          | Weight | Pct  | Contribution | Notes                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------- | ------ | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `KEEPA_API_KEY` verified in Vercel                 | 4      | 100% | 4.00         | T2 audit 2026-05-10: hit-lists page (HitListClient.tsx 483 LOC) + BsrSparkline wired into ScannerClient.tsx + lib/keepa/ (67+144+57 LOC) all confirmed live in production with callers. Key demonstrably active.                                                                                                                     |
| E2  | `OURA_ACCESS_TOKEN` in `harness_config`            | 3      | 100% | 3.00         | **Complete 2026-05-05.** `OURA_TOKEN` (key name) confirmed in `harness_config`. `/api/cron/oura-sync` triggered manually: `{"ok":true,"days":30}`. 30 rows in `oura_daily` table (Apr 5–May 4).                                                                                                                                      |
| E3  | Staged-batch env vars audited (Dropbox, n8n, etc.) | 3      | 100% | 3.00         | **Complete 2026-05-05.** `docs/env-audit-2026-05-05.md` shipped: 38 Vercel vars + 5 harness_config + 70 code refs cross-referenced. Caught **CRITICAL F-E1** (chat route hits localhost in production — `OLLAMA_BASE_URL` unset) + **F-E2** (UI label drift) — both fixed. 6 follow-up items flagged with severity and action owner. |
|     | **Category total**                                 | **10** |      | **10.00**    |                                                                                                                                                                                                                                                                                                                                      |

---

## Summary

| Category                | Weight  | Earned    | %         |
| ----------------------- | ------- | --------- | --------- |
| A — Ollama Pipeline     | 25      | 22.50     | 90%       |
| B — Harness Reliability | 30      | 29.70     | 99%       |
| C — Doctrine + Docs     | 15      | 15.00     | 100%      |
| D — Staged Batch        | 20      | 17.50     | 87.5%     |
| E — Env + Secrets       | 10      | 10.00     | 100%      |
| **Total**               | **100** | **94.70** | **94.7%** |

---

## Top Items Remaining (12.3 pts total)

| Rank | Item                                                | Weight | Gap  | Pts remaining |
| ---- | --------------------------------------------------- | ------ | ---- | ------------- |
| 1    | D5 — Inventory grounding doc                        | 2      | 100% | 2.00          |
| 2    | A4 — Fix Ollama 530s (embed + generate reliability) | 5      | 30%  | 1.50          |
| 3    | A2 — Cline fully wired (first real task shipped)    | 5      | 20%  | 1.00          |
| 4    | D6 — Retail_Monitor decision resolved               | 2      | 25%  | 0.50          |

**5.3 pts remaining.** A5 + A6 written 2026-05-14 (+7 pts).
A4 needs `powercfg /change standby-timeout-ac 0` run locally to stop overnight 530s.
A2 closes when first real Ollama coding task ships via Cline/Continue.

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

2026-05-14 MDT — **A5 + A6 written (+7 pts → 94.7%).** `docs/ollama-triage.md` (triage rubric: decision tree, tier table, known good/bad tasks, escalation thresholds, F18 metrics, AI dispatcher integration) and `docs/gpu-day-checklist.md` (7-phase day-of upgrade checklist: hardware, model pull, baseline, config, smoke test, rollback) both written from scratch. These were phantom entries reset to 0% earlier today; now 100%. **5.3 pts remain:** D5 (2 pts), A4 (1.5 pts), A2 (1 pt), D6 (0.5 pts).

Previously: 2026-05-14 MDT — **Step 6.5 tests fixed (commit 5e4e4ea).** Daytime tick code was already fully implemented. Builder fixed 20 failing test mocks + added 9 route-level tests (AC-2, AC-8). 30/30 tests passing. vercel.json cron entry already present. OLLAMA_TUNNEL_URL already set in Vercel. **To activate A4:** (1) Set `DAYTIME_TICK_ENABLED=1` in Vercel env — no redeploy needed. (2) Run `powercfg /change standby-timeout-ac 0` in admin PowerShell to stop laptop sleeping. Once 3 consecutive clean overnight ticks confirm, A4 → 90%+ (+1.5 pts).

Previously: 2026-05-14 MDT — **Phantom entry correction audit.** A2, A5, A6 were all listed 100% complete but the referenced files never existed (`.clinerules`, `docs/ollama-triage.md`, `docs/gpu-day-checklist.md`). All three corrected: `.clinerules` written, `memory-bank/` directory created (4 files: projectbrief, techContext, systemPatterns, activeContext). A5 and A6 reset to 0% pending actual doc creation. A2 bumped to 80% (infrastructure exists, first real task pending). Total: **95.7% → 87.7%** (-8.0 pts, all phantom corrections).

Previously: 2026-05-10 MDT — Task 7bb2a620 grounding complete: `OLLAMA_TUNNEL_URL` inserted into `harness_config`, PR #195 deployed to production, daytime-tick triggered → `tunnel_used: true` in response, `ollama.health` logged to `agent_events` (status=success, 10 models). A4 stays at 70% — tunnel wiring is correct but overnight 530s persist (root cause: laptop sleeping at ~midnight MDT / 06:xx UTC). **Manual fix needed:** run `powercfg /change standby-timeout-ac 0` locally to prevent sleep. Once 530s clear, A4 → 90%+ (+1.5 pts). Total unchanged: **96.0 / 100**.

Previously: 2026-05-10 MDT — B5 85%→100%: `coordinator.md` "(staged in git)" note was stale — file confirmed fully committed with complete branch-naming guard (task_id check + stray-branch deletion + pre-write drift re-verify). B category now 100%. Total: **95.7% → 96.0%** (+0.3 pts).

Previously: 2026-05-10 MDT — T5 deeper sweep: A4 25%→70% (local-AI dashboard + twin/knowledge live with 11+ callers, but active HTTP 530s on ollama.embed in overnight crons and ollama.generate failing after health success — inference unreliable, architecture shipped). D6 50%→75% (Local_AI resolved by dashboard ship; Retail_Monitor still pending). E1 50%→100% (Keepa hit-lists + BSR sparkline confirmed live in T2 audit). Total: 91.0% → **95.7%** (+4.7 pts).

Previously: 2026-05-05 MDT — Decision sweep with Colin: B6 → 100% (SQL backdoor accepted), C3 → 100% (Safety Agent: build, Phase 1 queued as task `9b9bca02`), C5 → 100% (Status page deferred, morning_digest covers surface). 5 spec/decision docs written, 3 tasks queued, 1 task closed. C category now 100%. Total: 81.0% → **91.0%**.

Previously: 2026-05-05 MDT — E3 → 100%. `docs/env-audit-2026-05-05.md` shipped. **Caught CRITICAL F-E1** (chat route hit localhost in prod — `OLLAMA_BASE_URL` unset) + F-E2 (UI label drift) — both fixed by setting Vercel env vars. 6 follow-ups flagged. Total: 78.0% → 81.0%.

Previously: 2026-05-05 MDT — E2 → 100%. `OURA_TOKEN` confirmed in `harness_config` (key name differs from spec but matches code). `/api/cron/oura-sync` returned `{"ok":true,"days":30}`; 30 rows in `oura_daily` (Apr 5–May 4). Total: 75.0% → 78.0%.

Previously: 2026-04-27 (W4) — C4 chart strategy → 100%. shadcn/ui Chart (Recharts) adopted. `docs/decisions/chart-library-strategy.md` written. AmazonDailyChart + UtilityBarChart migrated. Total: 64.0% → 67.0%.  
2026-04-27 11:31 MDT / 17:31 UTC — updated after PR #35 merge (B1/B2/B3 → 100%)  
Previously: 2026-04-27 ~10:00 MDT (initial write same session)
