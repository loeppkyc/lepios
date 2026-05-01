# LepiOS — Success Log (S-N series)

S-L1–S-L15 live in `CLAUDE.md §9` (canonical). This file holds entries added after S-L15.
Newest-first. Format: date · what happened · why it worked · apply when.

---

## S-N8 — Husky/libuv UV_HANDLE_CLOSING crash closed by process.exitCode pattern (2026-04-28)

- **Win:** Recurring Windows-only husky teardown crash (review-skips.md rows 234, 235, 242, 243) resolved by replacing `process.exit(N)` with `process.exitCode = N; return` in `scripts/ai-review.mjs`. Script body wrapped in `async function main()` returning exit codes, with `process.exitCode = await main()` at module top. Lets Node drain the Anthropic SDK keep-alive HTTPS sockets cleanly before shutdown instead of forcing exit while libuv handles are still closing. Verified: commit `2fa15be` itself completed end-to-end through the hook chain (lint-staged + AI reviewer PASS) without `--no-verify`.
- **Pattern:** When a Node script does async I/O (especially via fetch-based SDKs with keep-alive socket pools), avoid `process.exit()`. Set `process.exitCode` and let the event loop drain naturally. Forcing exit while libuv handles are mid-close trips `UV_HANDLE_CLOSING` on Windows specifically — Linux/macOS often tolerate the same pattern silently. Precedent already in repo: `scripts/verify-task-queue.ts:175`. Sibling-check rule applies: when fixing one script with this bug, grep the repo for other `process.exit(` calls in scripts that touch network I/O.
- **Process note:** Diagnosis was expected to land via `task_queue WHERE source='rollup_health_audit'` cron at 14:00 UTC; that source has zero rows ever and no cron registered in `vercel.json`. Followup queued under `source='diagnosis_cron_audit'` to investigate whether the routine was hallucinated or silently failed to deploy. F-L4 reminder: verify scheduled infrastructure exists end-to-end before relying on its output as a synchronization point.
- **Reference:** `scripts/ai-review.mjs`, `scripts/verify-task-queue.ts:175`, commit `2fa15be`, `docs/review-skips.md` (closing entry)

---

## S-N7 — Dual-tracker introduction: time-to-orb.md + adopted-vs-built.md (2026-04-27)

- **Win:** `docs/time-to-orb.md` — full estimate derivation (task graph, velocity assumptions, calendar math) that surfaces as one line on `docs/orb-readiness.md`. `docs/adopted-vs-built.md` — F19 baseline tracker for adopt-vs-build ratio, currently 1.9% adopted (correct for current phase). Hardware identified as critical path with a concrete deadline: order by Week 2 or the orb timeline slips.
- **Pattern:** Estimate-as-derived-metric: the full derivation (assumptions, task graph, confidence interval) lives in a dedicated file; the summary surface shows only the bottom line. When assumptions change, update the derivation file — the surface updates by reference, with no risk of drift. F19 baseline at 1.9% adopted is the right anchor for now; watch for rise to 5–8% as the orb sprint ships AI SDK + react-markdown. If the ratio stays near 1.9% after those ship, the adoption pattern didn't take and the sprint should be audited.
- **Reference:** `docs/time-to-orb.md`, `docs/adopted-vs-built.md`, `docs/orb-readiness.md`

---

## S-N6 — OSS scout absorption: 18-repo verdict matrix, 8 integration patterns (2026-04-27)

- **Win:** `docs/research/oss-scout.md` — 18-repo verdict matrix covering AI SDK, react-markdown, XTerm.js, livekit-agents, whisper.cpp, Home Assistant, and more. 8 concrete integration patterns each with a "where to wire" anchor in the LepiOS codebase. Trackers updated honestly: orb-readiness 17.5% → 27.3%; gpu-day-readiness 67% → 61.6% (denominator grew as scope was clarified — F22 behavior, not regression).
- **Pattern:** Reframe from "build" to "adopt + integrate" without losing the moat. The moat is the behavioral data pipeline and the cockpit UX — not the scaffolding. Adopting commodity infrastructure (AI SDK, react-markdown) frees capacity for the differentiating work and increases the moat. When a tracker percentage falls because the denominator grew (not because items regressed), record it honestly — suppressing a larger scope to protect a percentage is the anti-pattern F22 exists to prevent.
- **Reference:** `docs/research/oss-scout.md`, `docs/orb-readiness.md`, `docs/gpu-day-readiness.md`

---

## S-N5 — Coordinator branch-naming: two-layer defense closes F-N3 (2026-04-27)

- **Win:** Root-cause fix for the `claude/vibrant-heisenberg-*` default branch bug. `invoke-coordinator.ts` now passes `branch: getExpectedBranch(task_id)` in the Routines API fire body — the worktree starts on `harness/task-{uuid}` immediately. The `git checkout -b` guard in `coordinator.md` remains as belt-and-suspenders for manual/local sessions. Test added in `invoke-coordinator.test.ts` asserting the `branch` field matches the `harness/task-{uuid}` UUID pattern with a known task_id input.
- **Pattern:** When a fallback guard catches a failure the primary mechanism was supposed to prevent, treat the guard event as an alarm — not normal operation. Before this fix, `branch_guard_triggered` firing on every run was classified S-L3 (guard working silently). That was wrong: a guard that fires on every single run is a primary mechanism that isn't working. After the fix, any production `branch_guard_triggered` event means the primary mechanism failed for that invocation — investigate it. The silence of a guard is its success signal; noise from a guard is a bug report.
- **Reference:** `lib/harness/invoke-coordinator.ts`, `lib/harness/branch-guard.ts`, `tests/api/invoke-coordinator.test.ts`

---

## S-N4 — /business-review tax sub-line contrast fix: token semantics + F20 resolve (2026-04-27)

- **Win:** Tax sub-line was using `--color-text-disabled` (#7e7c96) at 0.65rem — contrast 4.57:1 against `--color-surface` (#12131f), plus an F20 violation (inline `style` attribute). Fix: replaced `style={{ fontFamily, fontSize, color }}` with `className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]"` — upgrades to `--color-text-muted` (#9896b0) at 6.44:1 contrast. Same fix applied to two sibling sub-lines in the same component (pending indicator, payout placeholder) per the sibling rule.
- **Pattern:** (1) Token semantics: `--color-text-disabled` is for inactive/non-interactive UI; `--color-text-muted` is for de-emphasized informational content. Sub-lines are informational — use muted, not disabled. (2) Quality bar above the floor: WCAG AA (4.5:1) passes compliance but fails real users on glare, aging monitors, and low-end displays. Target 6:1+ for text under 12px. (3) Tailwind CSS-var binding without F20 violation: `text-[var(--color-text-muted)]`, `text-[length:var(--text-nano)]`, `font-[family-name:var(--font-ui)]` — the canonical pattern when a CSS var must be applied without a pre-mapped utility class. (4) Sibling rule: when fixing an F20 violation on one element, scan the same file for identical patterns and fix in the same PR. Tonight: one logged issue → three sub-line fixes in the same component.
- **Reference:** `app/(cockpit)/business-review/_components/TodayYesterdayPanel.tsx`, `app/(cockpit)/utility/_components/UtilityBarChart.tsx` (pattern source: line 22)

---

## S-N3 — /utility route shipped autonomously: first harness validation (2026-04-27)

- **What:** `52_Utility_Tracker.py` (141 lines, Tier 3) ported to `/utility` route via full coordinator→builder pipeline. Phase 1a–1d study, acceptance doc, builder build, PR #32, merge, deploy — zero Colin-authored code.
- **Metrics:** 0 Colin code interventions; 1 approval click (acceptance doc review via Telegram).
- **Why it worked:** Tier 3 module — standalone, no complex domain rules, no SP-API or financial data. Low grounding surface. Source content embedded in task metadata (S-N1 pattern), so coordinator completed Phase 1a from metadata without needing Streamlit OS mounted.
- **Apply when:** Tier 3 modules (utility, profile, archiver, standalone tools) are the right first targets for fully-autonomous harness validation. Confirm: no financial aggregation, no Keepa/SP-API, no user-facing money fields.

---

## S-N2 — Coordinator autonomous skip decision on n8n_webhook (2026-04-27)

- **What:** Coordinator read n8n_webhook source, identified the module was NEVER LIVE in Streamlit (vestigial scaffolding), found 5/11 endpoints have native LepiOS equivalents, applied F17 gate (behavioral ingestion justification), and recommended Direction C (skip) — without escalating analysis to Colin.
- **Outcome:** Colin confirmed skip in one Telegram approval click. 0 builder hours consumed on a dead module.
- **Why it worked:** Phase 1a study surface was unambiguous — git history showed the page was never deployed. F17 gate clearly failed. Coordinator had enough signal to recommend confidently.
- **Apply when:** Phase 1a study revealing a module was never live, or is entirely superseded by existing LepiOS infrastructure, is a valid skip signal. Coordinator recommends; Colin approves. This is judgment the coordinator is allowed to exercise — F17 gate is objective.

---

## S-N1 — source_content embed pattern: unblocks cloud-sandbox coordinator for Streamlit access (2026-04-27)

- **What:** Instead of coordinator trying to read `../streamlit_app/pages/*.py` at runtime (path unavailable in cloud sandbox), task metadata embeds the file content at task-queue-row creation time. Coordinator reads `metadata.source_content` and proceeds with full Phase 1a study.
- **Proven on:** `ec1d00c7` (n8n_webhook) — coordinator completed Phase 1a–1c from embedded content, produced study doc and skip recommendation without any Streamlit OS filesystem access.
- **Apply when:** Any coordinator task requiring Streamlit source access that may run in cloud/remote context. Embed `file_content` in `task_queue.metadata` at task generation time. Cost: ~10–80KB per task row (acceptable). Benefit: cloud-safe, no environment dependency.
