# LepiOS — Success Log (S-N series)

S-L1–S-L15 live in `CLAUDE.md §9` (canonical). This file holds entries added after S-L15.
Newest-first. Format: date · what happened · why it worked · apply when.

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
